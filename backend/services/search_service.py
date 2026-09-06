"""校务知识检索：语义检索（Qdrant）+ 关键词检索融合，freshness 优先。"""
from sqlalchemy import and_, or_, select

from models import KnowledgeObject

STOP_WORDS = [
    "什么", "怎么", "如何", "多少", "哪里", "哪", "时候", "时间", "进行", "吗", "呢",
    "请问", "？", "?", "的", "了", "是", "要", "需要", "可以", "能", "会", "想", "应该",
]


def _extract_keywords(query: str) -> str:
    """去掉问句结构词，提取最长的关键词片段。"""
    q = query.strip().rstrip("？?。.")
    for w in STOP_WORDS:
        q = q.replace(w, " ")
    parts = [p for p in q.split() if len(p) >= 2]
    return max(parts, key=len) if parts else q.strip().replace(" ", "")


async def _ilike_search(db, keyword: str, top_k: int, include_expired: bool):
    pattern = f"%{keyword}%"
    clause = or_(
        KnowledgeObject.title.ilike(pattern),
        KnowledgeObject.summary.ilike(pattern),
    )
    if not include_expired:
        clause = and_(clause, KnowledgeObject.status == "PUBLISHED")
    result = await db.execute(
        select(KnowledgeObject)
        .where(clause)
        .order_by(KnowledgeObject.created_at.desc())
        .limit(top_k)
    )
    return list(result.scalars().all())


async def _keyword_search(db, query: str, top_k: int, include_expired: bool):
    kos = await _ilike_search(db, query.strip(), top_k, include_expired)
    if kos:
        return kos
    kw = _extract_keywords(query)
    if kw and kw != query.strip():
        kos = await _ilike_search(db, kw, top_k, include_expired)
        if kos:
            return kos
    return []


async def _semantic_search(query: str, top_k: int) -> list[str]:
    """语义检索，返回 KO id 列表；失败返回空（降级）。"""
    try:
        from agents.embedding import embed_texts
        from services.vector_service import search as qdrant_search

        embs = await embed_texts([query])
        if not embs:
            return []
        return await qdrant_search(embs[0], top_k)
    except Exception:
        return []


async def search_knowledge(
    db, query: str, top_k: int = 5, include_expired: bool = False
) -> list[KnowledgeObject]:
    """混合检索：语义优先 + 关键词补充 + 兜底最新 PUBLISHED。"""
    # 1. 语义检索
    semantic_ids = await _semantic_search(query, top_k)
    semantic_kos = []
    for kid in semantic_ids:
        ko = await db.get(KnowledgeObject, kid)
        if ko and (include_expired or ko.status == "PUBLISHED"):
            semantic_kos.append(ko)

    # 2. 关键词检索
    keyword_kos = await _keyword_search(db, query, top_k, include_expired)

    # 3. 融合去重（语义优先）
    seen = set()
    merged = []
    for ko in semantic_kos + keyword_kos:
        if ko.id not in seen:
            seen.add(ko.id)
            merged.append(ko)

    if merged:
        return merged[:top_k]

    # 4. 兜底：最新 PUBLISHED（让 LLM 判断是否足够回答）
    q = select(KnowledgeObject).order_by(KnowledgeObject.created_at.desc()).limit(top_k)
    if not include_expired:
        q = q.where(KnowledgeObject.status == "PUBLISHED")
    result = await db.execute(q)
    return list(result.scalars().all())

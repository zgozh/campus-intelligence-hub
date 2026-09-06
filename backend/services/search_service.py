"""校务知识检索（EPIC 8）：关键词检索 + freshness 优先。"""
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


async def search_knowledge(
    db, query: str, top_k: int = 5, include_expired: bool = False
) -> list[KnowledgeObject]:
    """关键词检索：先完整 query，再关键词片段，最后兜底最新 PUBLISHED。"""
    # 1. 完整 query
    kos = await _ilike_search(db, query.strip(), top_k, include_expired)
    if kos:
        return kos

    # 2. 提取关键词片段
    kw = _extract_keywords(query)
    if kw and kw != query.strip():
        kos = await _ilike_search(db, kw, top_k, include_expired)
        if kos:
            return kos

    # 3. 兜底：最新 PUBLISHED（让 LLM 判断是否足够回答）
    q = select(KnowledgeObject).order_by(KnowledgeObject.created_at.desc()).limit(top_k)
    if not include_expired:
        q = q.where(KnowledgeObject.status == "PUBLISHED")
    result = await db.execute(q)
    return list(result.scalars().all())

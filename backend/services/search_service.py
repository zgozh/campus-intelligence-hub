"""校务知识检索（spec §21）：语义 + 关键词 + 权威度 + 新鲜度 + 时效融合评分。

score = w_sem*semantic + w_lex*lexical + w_auth*authority + w_fresh*freshness + w_rec*recency
权重配置于 config.RETRIEVAL_WEIGHTS；authority 由来源配置（config.AUTHORITY_TIERS / Source.authority）。
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import and_, or_, select

from config import RETRIEVAL_WEIGHTS
from models import KnowledgeObject

logger = logging.getLogger(__name__)

STOP_WORDS = [
    "什么", "怎么", "如何", "多少", "哪里", "哪", "时候", "时间", "进行", "吗", "呢",
    "请问", "？", "?", "的", "了", "是", "要", "需要", "可以", "能", "会", "想", "应该",
]

_FRESHNESS_SCORE = {"Fresh": 1.0, "Aging": 0.6, "Stale": 0.2, "Unknown": 0.5}


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
    """语义检索，返回 KO id 列表（按相似度排序）；失败返回空（降级）。"""
    try:
        from agents.embedding import embed_texts
        from services.vector_service import search as qdrant_search

        embs = await embed_texts([query])
        if not embs:
            return []
        return await qdrant_search(embs[0], top_k)
    except Exception:
        return []


def _freshness_score(ko) -> float:
    return _FRESHNESS_SCORE.get(ko.freshness_level or "Unknown", 0.5)


def _recency_score(ko) -> float:
    """时间衰减：90 天内线性从 1.0 降到 0。"""
    ref = ko.last_verified_at or ko.updated_at or ko.created_at
    if not ref:
        return 0.5
    try:
        days = (datetime.now(timezone.utc) - ref).days
    except Exception:
        return 0.5
    if days < 0:
        days = 0
    return max(0.0, 1.0 - days / 90.0)


async def search_knowledge(
    db, query: str, top_k: int = 5, include_expired: bool = False
) -> list[KnowledgeObject]:
    """混合融合评分检索：语义+关键词候选集 → 加权融合 → 排序取 top_k。"""
    w = RETRIEVAL_WEIGHTS

    semantic_ids = await _semantic_search(query, top_k * 2)
    semantic_kos: list[KnowledgeObject] = []
    for kid in semantic_ids:
        ko = await db.get(KnowledgeObject, kid)
        if ko and (include_expired or ko.status == "PUBLISHED"):
            semantic_kos.append(ko)
    keyword_kos = await _keyword_search(db, query, top_k * 2, include_expired)
    keyword_ids = {k.id for k in keyword_kos}

    scored: dict[str, tuple[KnowledgeObject, float]] = {}

    def _add(ko: KnowledgeObject, sem_rank: int | None, lex: bool):
        if ko.id in scored:
            return
        sem = 0.0
        if sem_rank is not None:
            sem = max(0.3, 1.0 - sem_rank * 0.1)
        lexv = 0.8 if lex else 0.0
        score = (
            w["semantic"] * sem
            + w["lexical"] * lexv
            + w["authority"] * (ko.authority or 0.8)
            + w["freshness"] * _freshness_score(ko)
            + w["recency"] * _recency_score(ko)
        )
        scored[ko.id] = (ko, score)

    for i, ko in enumerate(semantic_kos):
        _add(ko, sem_rank=i, lex=ko.id in keyword_ids)
    for ko in keyword_kos:
        if ko.id not in scored:
            _add(ko, sem_rank=None, lex=True)

    if not scored:
        # 兜底：最新 PUBLISHED
        q = select(KnowledgeObject).order_by(KnowledgeObject.created_at.desc()).limit(top_k)
        if not include_expired:
            q = q.where(KnowledgeObject.status == "PUBLISHED")
        return list((await db.execute(q)).scalars().all())

    ranked = sorted(scored.values(), key=lambda x: x[1], reverse=True)
    logger.debug("融合检索 top：%s", [(ko.title[:20], round(s, 3)) for ko, s in ranked[:top_k]])
    return [ko for ko, _s in ranked[:top_k]]

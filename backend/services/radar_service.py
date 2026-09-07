"""知识雷达（EPIC 10）：运营统计（新增/待审/冲突/将过期/来源异常/活跃度）。"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from models import ChangeEvent, Conflict, KnowledgeObject, RawDocument, ReviewTask, Source

logger = logging.getLogger(__name__)


async def radar_stats(db) -> dict:
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today = now.strftime("%Y-%m-%d")
    week_later = (now + timedelta(days=7)).strftime("%Y-%m-%d")

    new_today = await db.scalar(
        select(func.count(KnowledgeObject.id)).where(
            KnowledgeObject.created_at >= today_start
        )
    )
    review_pending = await db.scalar(
        select(func.count(ReviewTask.id)).where(ReviewTask.status == "pending")
    )
    conflict_open = await db.scalar(
        select(func.count(Conflict.id)).where(Conflict.status == "open")
    )
    expiring = await db.scalar(
        select(func.count(KnowledgeObject.id)).where(
            KnowledgeObject.status == "PUBLISHED",
            KnowledgeObject.effective_to.isnot(None),
            KnowledgeObject.effective_to >= today,
            KnowledgeObject.effective_to <= week_later,
        )
    )
    source_error = await db.scalar(
        select(func.count(Source.id)).where(Source.status == "error")
    )
    total_ko = await db.scalar(select(func.count(KnowledgeObject.id)))
    published = await db.scalar(
        select(func.count(KnowledgeObject.id)).where(
            KnowledgeObject.status == "PUBLISHED"
        )
    )
    expired = await db.scalar(
        select(func.count(KnowledgeObject.id)).where(
            KnowledgeObject.status == "EXPIRED"
        )
    )

    # 来源活跃度（按 source_site 分组）
    rows = await db.execute(
        select(RawDocument.source_site, func.count(RawDocument.id)).group_by(
            RawDocument.source_site
        )
    )
    source_activity = [
        {"name": (r[0] or "未知"), "count": r[1]} for r in rows
    ]

    return {
        "new_today": new_today or 0,
        "review_pending": review_pending or 0,
        "conflict_open": conflict_open or 0,
        "expiring": expiring or 0,
        "source_error": source_error or 0,
        "total_ko": total_ko or 0,
        "published": published or 0,
        "expired": expired or 0,
        "source_activity": source_activity,
    }


async def knowledge_health(db) -> dict:
    """Knowledge Health 综合评测（spec §25）：覆盖/新鲜度/冲突率/审核积压/来源健康 + 公开公式。

    health_score = 100 - 待审*2 - 冲突*3 - 陈旧占比*40 - 来源异常占比*30 - 过期占比*20（clamp 0~100）
    """
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today = now.strftime("%Y-%m-%d")

    total_ko = await db.scalar(select(func.count(KnowledgeObject.id))) or 0
    published = await db.scalar(
        select(func.count(KnowledgeObject.id)).where(KnowledgeObject.status == "PUBLISHED")
    ) or 0
    expired = await db.scalar(
        select(func.count(KnowledgeObject.id)).where(KnowledgeObject.status == "EXPIRED")
    ) or 0
    review_pending = await db.scalar(
        select(func.count(ReviewTask.id)).where(ReviewTask.status == "pending")
    ) or 0
    conflict_open = await db.scalar(
        select(func.count(Conflict.id)).where(Conflict.status == "open")
    ) or 0
    new_today = await db.scalar(
        select(func.count(KnowledgeObject.id)).where(KnowledgeObject.created_at >= today_start)
    ) or 0
    changed_today = await db.scalar(
        select(func.count(ChangeEvent.id)).where(ChangeEvent.detected_at >= today_start)
    ) or 0
    total_sources = await db.scalar(select(func.count(Source.id))) or 0
    source_error = await db.scalar(
        select(func.count(Source.id)).where(Source.status == "error")
    ) or 0

    # freshness 分布
    freshness_counts = {"Fresh": 0, "Aging": 0, "Stale": 0, "Unknown": 0}
    rows = await db.execute(
        select(KnowledgeObject.freshness_level, func.count(KnowledgeObject.id)).group_by(
            KnowledgeObject.freshness_level
        )
    )
    for level, cnt in rows:
        freshness_counts[level or "Unknown"] = freshness_counts.get(level or "Unknown", 0) + cnt

    stale_count = freshness_counts.get("Stale", 0) + expired
    stale_ratio = stale_count / total_ko if total_ko else 0.0
    expired_ratio = expired / total_ko if total_ko else 0.0
    src_err_ratio = source_error / total_sources if total_sources else 0.0

    health = (
        100
        - review_pending * 2
        - conflict_open * 3
        - stale_ratio * 40
        - src_err_ratio * 30
        - expired_ratio * 20
    )
    health_score = round(max(0.0, min(100.0, health)), 1)

    return {
        "health_score": health_score,
        "formula": "100 - 待审*2 - 冲突*3 - 陈旧占比*40 - 来源异常占比*30 - 过期占比*20",
        "today": {
            "new": new_today,
            "changed": changed_today,
            "conflicts": conflict_open,
            "review": review_pending,
        },
        "coverage": {"total": total_ko, "published": published, "expired": expired},
        "freshness": freshness_counts,
        "conflict_rate": round(conflict_open / total_ko, 3) if total_ko else 0,
        "review_backlog": review_pending,
        "source_health": {"total": total_sources, "error": source_error, "ok": total_sources - source_error},
    }

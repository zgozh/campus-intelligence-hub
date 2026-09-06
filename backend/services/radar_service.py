"""知识雷达（EPIC 10）：运营统计（新增/待审/冲突/将过期/来源异常/活跃度）。"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from models import Conflict, KnowledgeObject, RawDocument, ReviewTask, Source

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

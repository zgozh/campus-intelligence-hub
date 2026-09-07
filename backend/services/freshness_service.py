"""时效引擎（spec §15）：Freshness 分级(Fresh/Aging/Stale/Unknown) + 过期检测。

分级规则：
- effective_to < 今天 → 过期（PUBLISHED 转 EXPIRED，level=Stale）
- 有 effective_to：距截止 <=7天→Fresh / <=30天→Aging / 否则 Stale
- 无 effective_to：按 last_verified_at 距今 <=7天→Fresh / <=30天→Aging / 否则 Stale
- 无任何时间依据 → Unknown
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from models import KnowledgeObject

logger = logging.getLogger(__name__)


def _compute_freshness(ko) -> tuple[str, float]:
    """按 effective_to / last_verified_at 判定 (level, score)。"""
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    if ko.effective_to and ko.effective_to < today_str:
        return "Stale", 0.2

    if ko.effective_to:
        try:
            days = (
                datetime.strptime(ko.effective_to, "%Y-%m-%d")
                - now.replace(tzinfo=None)
            ).days
        except Exception:
            days = 90
        if days <= 7:
            return "Fresh", 1.0
        if days <= 30:
            return "Aging", 0.6
        return "Stale", 0.3

    ref = ko.last_verified_at or ko.updated_at or ko.created_at
    if ref:
        try:
            age_days = (now - ref).days
        except Exception:
            age_days = 0
        if age_days <= 7:
            return "Fresh", 1.0
        if age_days <= 30:
            return "Aging", 0.6
        if age_days <= 90:
            return "Stale", 0.3
        return "Stale", 0.2
    return "Unknown", 0.5


async def refresh_freshness(db) -> dict:
    """刷新所有 KO 的过期状态与 Freshness 分级。返回统计。"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    expired = 0
    counts = {"Fresh": 0, "Aging": 0, "Stale": 0, "Unknown": 0}
    result = await db.execute(select(KnowledgeObject))
    for ko in result.scalars().all():
        if ko.status == "PUBLISHED" and ko.effective_to and ko.effective_to < today:
            ko.status = "EXPIRED"
            ko.freshness_level = "Stale"
            expired += 1
            counts["Stale"] += 1
            continue
        level, _score = _compute_freshness(ko)
        ko.freshness_level = level
        counts[level] = counts.get(level, 0) + 1
    await db.commit()
    logger.info("时效刷新完成：expired=%d counts=%s", expired, counts)
    return {"expired": expired, "freshness": counts}

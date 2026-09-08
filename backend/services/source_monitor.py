"""数据源监控（自动化）：对每个数据源给出「最近采集时间 / 近 7 天新增内容数 / 最新内容标题」。

确定性实现（不依赖 LLM），用于监控"数据源有没有新消息/新通知"，支撑自动化巡检与异常提示。
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from models import RawDocument, Source

logger = logging.getLogger(__name__)

RECENT_DAYS = 7
TITLE_LIMIT = 5


async def monitor_sources(db, recent_days: int = RECENT_DAYS) -> dict:
    """返回每个数据源的监控快照。"""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=recent_days)

    sources = (await db.execute(select(Source).order_by(Source.created_at.desc()))).scalars().all()
    items = []
    for src in sources:
        recent_count = await db.scalar(
            select(func.count(RawDocument.id)).where(
                RawDocument.source_id == src.id,
                RawDocument.created_at >= since,
            )
        )
        recent_rows = await db.execute(
            select(RawDocument.title)
            .where(RawDocument.source_id == src.id, RawDocument.created_at >= since)
            .order_by(RawDocument.created_at.desc())
            .limit(TITLE_LIMIT)
        )
        titles = [str(t) for (t,) in recent_rows.all() if t]
        items.append(
            {
                "source_id": src.id,
                "name": src.name,
                "source_type": src.source_type,
                "base_url": src.base_url,
                "status": src.status,
                "last_crawled_at": src.last_crawled_at.isoformat() if src.last_crawled_at else None,
                "recent_days": recent_days,
                "new_count": int(recent_count or 0),
                "recent_titles": titles,
            }
        )
    total_new = sum(i["new_count"] for i in items)
    return {"items": items, "recent_days": recent_days, "total_new": total_new, "sources": len(items)}

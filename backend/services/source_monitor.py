"""数据源监控（自动化）：对每个数据源给出「最近尝试/最近成功采集时间 / 近 7 天新增内容数 / 最新内容标题」。

确定性实现（不依赖 LLM），用于监控"数据源有没有新消息/新通知"，支撑自动化巡检与异常提示。

语义约定（REFACTOR_PLAN_V2 T7 / P3）：
- `last_success_at` 是**展示主字段**（最近一次采集成功完成的时间），`last_crawled_at` 是最近一次尝试（开始）时间；
- 两者均由 `collection_service.run_collection` 统一维护，端点/闭环/调度三条链路自动一致；
- 顶层 `refreshed_at` 是本次快照的服务端时间，供前端给出"已更新"的确定反馈。
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from models import RawDocument, Source

logger = logging.getLogger(__name__)

RECENT_DAYS = 7
TITLE_LIMIT = 5
# 标题聚合的扫描上限：避免超大数据源把一次快照查询拉爆（按时间倒序截断）
TITLE_SCAN_LIMIT = 1000


def _iso(value: datetime | None) -> str | None:
    """带时区 ISO 8601；naive 时间（SQLite 测试库）按 UTC 补齐，避免前端时区漂移。"""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


async def monitor_sources(db, recent_days: int = RECENT_DAYS) -> dict:
    """返回每个数据源的监控快照（单次聚合查询，避免逐源 N+1）。"""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=recent_days)

    sources = (await db.execute(select(Source).order_by(Source.created_at.desc()))).scalars().all()

    # ① 一次 group-by 拿到所有源的近 N 天新增计数
    count_rows = await db.execute(
        select(RawDocument.source_id, func.count(RawDocument.id))
        .where(RawDocument.created_at >= since)
        .group_by(RawDocument.source_id)
    )
    counts: dict[str, int] = {sid: int(cnt or 0) for sid, cnt in count_rows.all()}

    # ② 一次子查询拿到所有源的近期标题（按时间倒序截断），再在内存中每源取前 N 条
    title_rows = await db.execute(
        select(RawDocument.source_id, RawDocument.title)
        .where(RawDocument.created_at >= since)
        .order_by(RawDocument.created_at.desc())
        .limit(TITLE_SCAN_LIMIT)
    )
    titles_by_source: dict[str, list[str]] = {}
    for sid, title in title_rows.all():
        if not title:
            continue
        bucket = titles_by_source.setdefault(str(sid), [])
        if len(bucket) < TITLE_LIMIT:
            bucket.append(str(title))

    items = []
    for src in sources:
        items.append(
            {
                "source_id": src.id,
                "name": src.name,
                "source_type": src.source_type,
                "base_url": src.base_url,
                "status": src.status,
                "last_crawled_at": _iso(src.last_crawled_at),  # 最近尝试（开始）时间
                "last_success_at": _iso(src.last_success_at),  # ★ 最近成功完成时间（展示主字段）
                "last_error": getattr(src, "last_error", None),
                "recent_days": recent_days,
                "new_count": counts.get(src.id, 0),
                "recent_titles": titles_by_source.get(src.id, []),
            }
        )

    total_new = sum(i["new_count"] for i in items)
    return {
        "items": items,
        "recent_days": recent_days,
        "total_new": total_new,
        "sources": len(items),
        "refreshed_at": _iso(now),  # ★ 快照时间：前端刷新反馈依据
    }

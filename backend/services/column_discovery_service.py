"""栏目动态发现（REFACTOR_PLAN_V2 T6）：给出某个数据源"真实可用"的内容栏目。

背景（用户实测缺陷）：前端栏目下拉是硬编码的 4 项常量，与适配器实际能产出的
`column` 取值不对齐——选了筛不出数据，或干脆没有可选项。

发现策略（同一取值空间，保证"能选"与"能筛到"一致）：
1. 历史分布：`RawDocument.column` 的 group-by 真实计数（可信、带 count）；
2. 适配器声明：`SiteAdapter.declared_columns` + `default_column`（补 count=0 的候选，
   origin 标记为 adapter，前端可据此说明"尚未采集到内容"）。
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from models import RawDocument, Source

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 300

# 进程内缓存：{source_id: (expires_at, payload)}
_cache: dict[str, tuple[datetime, dict]] = {}


def invalidate(source_id: str) -> None:
    """让某数据源的栏目缓存失效（采集完成后调用）。"""
    _cache.pop(source_id, None)


def clear_cache() -> None:
    """清空全部缓存（测试/运维用）。"""
    _cache.clear()


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _pick_adapter(source: Source):
    """复用采集链路同一套适配器选择逻辑（避免两处规则漂移）。"""
    try:
        from services.collection_service import _pick_adapter as pick
    except Exception:  # pragma: no cover - 理论上不会发生
        return None
    try:
        return pick(source)
    except Exception as e:  # noqa: BLE001 - 适配器选择失败不应让栏目接口 500
        logger.warning("栏目发现：适配器选择失败 %s", e)
        return None


async def _history_columns(db, source_id: str) -> dict[str, int]:
    rows = await db.execute(
        select(RawDocument.column, func.count(RawDocument.id))
        .where(RawDocument.source_id == source_id)
        .group_by(RawDocument.column)
        .order_by(func.count(RawDocument.id).desc())
    )
    counts: dict[str, int] = {}
    for column, count in rows.all():
        value = (column or "").strip()
        if not value:
            continue  # 空串与 NULL 不入结果
        counts[value] = int(count or 0)
    return counts


async def discover_columns(db, source: Source, refresh: bool = False) -> dict:
    """返回该数据源的栏目清单（含计数与来源标记）。"""
    now = datetime.now(timezone.utc)
    cached = _cache.get(source.id)
    if cached and not refresh and cached[0] > now:
        return {**cached[1], "cached": True}

    history = await _history_columns(db, source.id)
    adapter = _pick_adapter(source)
    declared = adapter.declared_column_names() if adapter is not None else []
    default_column = getattr(adapter, "default_column", None) if adapter is not None else None

    columns: list[dict] = []
    for value, count in history.items():
        columns.append(
            {"value": value, "label": f"{value} ({count})", "count": count, "origin": "history"}
        )
    for name in declared:
        if name in history:
            continue
        columns.append({"value": name, "label": f"{name} (0)", "count": 0, "origin": "adapter"})

    # 默认栏目永远可选（保证"全部内容之外至少有一个真实可筛的值"）
    if default_column and all(c["value"] != default_column for c in columns):
        columns.append(
            {
                "value": default_column,
                "label": f"{default_column} (0)",
                "count": 0,
                "origin": "adapter",
            }
        )

    payload = {
        "source_id": source.id,
        "columns": columns,
        "generated_at": _iso(now),
        "cached": False,
    }
    _cache[source.id] = (now + timedelta(seconds=CACHE_TTL_SECONDS), payload)
    return payload

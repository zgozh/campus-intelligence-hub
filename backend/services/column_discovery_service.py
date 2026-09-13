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
# 跨源并集缓存：{缓存键: (expires_at, payload)}，键 = 排序后的 source_ids 或 "all"
_multi_cache: dict[str, tuple[datetime, dict]] = {}


def _multi_key(source_ids: list[str] | None) -> str:
    return "all" if not source_ids else ",".join(sorted(source_ids))


def invalidate(source_id: str) -> None:
    """让某数据源的栏目缓存失效（采集完成后调用）。

    跨源并集缓存按"涉及该源的键"精确失效；键由 source_ids 排序拼接而成，
    因此含该源的键一定包含该 id 子串（"all" 键也一并失效，代价可忽略）。
    """
    _cache.pop(source_id, None)
    for key in list(_multi_cache.keys()):
        if key == "all" or source_id in key.split(","):
            _multi_cache.pop(key, None)


def clear_cache() -> None:
    """清空全部缓存（测试/运维用）。"""
    _cache.clear()
    _multi_cache.clear()


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


async def discover_columns_multi(
    db, source_ids: list[str] | None = None, refresh: bool = False
) -> dict:
    """跨源栏目并集（REFACTOR_PLAN_V2_2 B2）。

    用途：闭环/采集面板可多选数据源，此时需要"所选源合起来有哪些栏目可选"。
    - 同名栏目**合并计数**，并给出每源分布 `sources: [{source_id, count}]`；
    - 适配器声明的栏目（count=0）作为补充候选，避免"历史还没采到就无可选项"；
    - `source_ids` 为空 = 全部 active 源；
    - 一次 group-by 完成统计（不逐源查询）。
    过滤语义：多源采集带 column 时对各源分别做等值过滤，栏目只存在于部分源时其它源自然筛空（预期行为）。
    """
    now = datetime.now(timezone.utc)
    key = _multi_key(source_ids)
    cached = _multi_cache.get(key)
    if cached and not refresh and cached[0] > now:
        return {**cached[1], "cached": True}

    query = select(Source)
    if source_ids:
        query = query.where(Source.id.in_(source_ids))
    else:
        query = query.where(Source.status == "active")
    sources = (await db.execute(query)).scalars().all()

    aggregated: dict[str, dict] = {}
    if sources:
        rows = await db.execute(
            select(RawDocument.source_id, RawDocument.column, func.count(RawDocument.id))
            .where(RawDocument.source_id.in_([s.id for s in sources]))
            .group_by(RawDocument.source_id, RawDocument.column)
        )
        for source_id, column, count in rows.all():
            value = (column or "").strip()
            if not value:
                continue  # 空串与 NULL 不入结果
            entry = aggregated.setdefault(value, {"count": 0, "sources": []})
            entry["count"] += int(count or 0)
            entry["sources"].append({"source_id": source_id, "count": int(count or 0)})

    # 适配器声明补 0（仅当该栏目整体尚未出现，避免噪音）
    for source in sources:
        adapter = _pick_adapter(source)
        if adapter is None:
            continue
        for name in adapter.declared_column_names():
            aggregated.setdefault(name, {"count": 0, "sources": []})

    columns = [
        {
            "value": value,
            "label": f"{value} ({entry['count']})",
            "count": entry["count"],
            "origin": "history" if entry["count"] > 0 else "adapter",
            "sources": sorted(entry["sources"], key=lambda item: -item["count"]),
        }
        for value, entry in aggregated.items()
    ]
    columns.sort(key=lambda item: (-item["count"], item["value"]))

    payload = {
        "columns": columns,
        "source_count": len(sources),
        "source_ids": [s.id for s in sources],
        "generated_at": _iso(now),
        "cached": False,
    }
    _multi_cache[key] = (now + timedelta(seconds=CACHE_TTL_SECONDS), payload)
    return payload


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

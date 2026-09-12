"""运行记录服务（REFACTOR_PLAN_V2 T2）：闭环/长任务运行的生命周期与回放。

职责：
- 创建运行（参数快照）、推进状态、结算耗时、协作式取消；
- 互斥判断（同一类型同一时刻只允许一个 running，避免重复点击造成并发闭环）；
- 按 run_id 把 run_records + decision_logs 物化回放为**与实时 SSE 同构**的事件序列。

回放与实时同构的定义：实时事件 `stage_decision` 的 data 字段 == 回放 events 中同一事件的字段
（仅多一个 `event` 名称字段），前端因此可以用同一个 reducer 处理两条路径。
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from models import DecisionLog, RunRecord

logger = logging.getLogger(__name__)

# 运行类型
TYPE_CLOSED_LOOP = "closed_loop"

# 超过该时长仍为 running 的运行视为"崩溃未收尾"，自动关闭，避免互斥锁永久阻塞后续运行
STALE_RUN_MINUTES = 30

# Agent 名 → (阶段 key, 阶段中文名)；与 agent_orchestrator 的三层 Agent 一一对应
STAGE_BY_AGENT: dict[str, tuple[str, str]] = {
    "采集 Agent": ("collection", "实时采集"),
    "知识治理 Agent": ("governance", "知识治理"),
    "问答/运营 Agent": ("operation", "问答与运营"),
}
STAGE_ORDER: tuple[str, ...] = ("collection", "governance", "operation")
STAGE_TITLE: dict[str, str] = {key: title for key, title in STAGE_BY_AGENT.values()}


def new_run_id() -> str:
    """运行 ID：与既有 DecisionLog.run_id 形态保持一致（12 位十六进制）。"""
    return uuid.uuid4().hex[:12]


def stage_of(agent: str | None) -> tuple[str, str]:
    """按 Agent 名解析阶段；未知 Agent 归入 operation 阶段（保持回放不丢事件）。"""
    return STAGE_BY_AGENT.get(agent or "", ("operation", "问答与运营"))


def _iso(value: datetime | None) -> str | None:
    """ISO 8601 输出；naive 时间（SQLite 测试库）按 UTC 补齐时区，避免前端时区漂移。"""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def serialize_run(run: RunRecord) -> dict:
    """运行记录的对外表示（契约 §5.1 runs 响应）。"""
    return {
        "run_id": run.run_id,
        "type": run.type,
        "status": run.status,
        "params": run.params or {},
        "summary": run.summary,
        "error": run.error,
        "cancel_requested": bool(run.cancel_requested),
        "started_at": _iso(run.started_at),
        "finished_at": _iso(run.finished_at),
        "duration_ms": run.duration_ms,
    }


def _aware(value: datetime | None) -> datetime | None:
    """统一为带时区时间（SQLite 测试库返回 naive，按 UTC 解释）。"""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


async def _close_stale_runs(db, run_type: str) -> int:
    """把超时未收尾的 running 运行标记为 error，防止互斥锁永久阻塞。

    注意：不能只处理 `started_at` 非空的运行——运行记录若在"已创建但未开始"的状态下
    因进程重启/异常退出而残留（started_at 为 NULL），也会永久占用互斥锁，导致后续
    所有闭环请求一直返回 409。因此以 `started_at or created_at` 作为兜底计时基准。
    """
    threshold = _now() - timedelta(minutes=STALE_RUN_MINUTES)
    rows = (
        await db.execute(
            select(RunRecord).where(
                RunRecord.type == run_type,
                RunRecord.status == "running",
            )
        )
    ).scalars().all()

    closed = 0
    for run in rows:
        reference = _aware(run.started_at) or _aware(run.created_at)
        if reference is None or reference >= threshold:
            continue
        run.status = "error"
        run.error = "运行超时未收尾，已自动关闭（可能因进程重启中断）"
        run.finished_at = _now()
        started = _aware(run.started_at)
        if started:
            run.duration_ms = max(0, int((run.finished_at - started).total_seconds() * 1000))
        closed += 1
        logger.warning("自动关闭超时运行 %s（started_at=%s）", run.run_id, run.started_at)
    if closed:
        await db.commit()
    return closed


async def create_run(db, type: str, params: dict | None) -> RunRecord:
    """创建一次运行（status=running，记录参数快照）。"""
    run = RunRecord(
        run_id=new_run_id(),
        type=type,
        status="running",
        params=params or {},
        cancel_requested=False,
        started_at=_now(),
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


async def finish_run(
    db, run_id: str, status: str, summary: str | None, error: str | None = None
) -> None:
    """结算运行：写状态/摘要/结束时间，并计算总耗时。"""
    run = await db.get(RunRecord, run_id)
    if run is None:
        logger.warning("finish_run: 运行不存在 %s", run_id)
        return
    run.status = status
    run.summary = summary
    run.error = error
    run.finished_at = _now()
    if run.started_at:
        started = run.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        run.duration_ms = max(0, int((run.finished_at - started).total_seconds() * 1000))
    await db.commit()


async def request_cancel(db, run_id: str) -> bool:
    """请求取消（协作式）：编排器在阶段之间检查该标志。返回运行是否存在。"""
    run = await db.get(RunRecord, run_id)
    if run is None:
        return False
    run.cancel_requested = True
    await db.commit()
    return True


async def is_cancel_requested(db, run_id: str) -> bool:
    run = await db.get(RunRecord, run_id)
    return bool(run and run.cancel_requested)


async def get_running_run(db, type: str) -> RunRecord | None:
    """当前进行中的运行（用于互斥）；顺带关闭超时运行。"""
    await _close_stale_runs(db, type)
    return (
        await db.execute(
            select(RunRecord)
            .where(RunRecord.type == type, RunRecord.status == "running")
            .order_by(RunRecord.created_at.desc())
            .limit(1)
        )
    ).scalars().first()


async def list_runs(db, type: str, limit: int = 10) -> dict:
    """运行历史列表（契约 §5.1）。"""
    rows = (
        await db.execute(
            select(RunRecord)
            .where(RunRecord.type == type)
            .order_by(RunRecord.created_at.desc())
            .limit(max(1, min(limit, 50)))
        )
    ).scalars().all()
    total = await db.scalar(
        select(func.count(RunRecord.run_id)).where(RunRecord.type == type)
    )
    return {"runs": [serialize_run(r) for r in rows], "total": int(total or 0)}


def _decision_event(dec: DecisionLog) -> dict:
    """决策行 → stage_decision 事件（字段与实时流完全一致）。"""
    stage, _title = stage_of(dec.agent)
    return {
        "event": "stage_decision",
        "run_id": dec.run_id,
        "stage": stage,
        "agent": dec.agent,
        "decision": dec.decision,
        "detail": dec.detail,
        "status": dec.status,
        "finished_at": _iso(dec.finished_at or dec.created_at),
        "duration_ms": dec.duration_ms,
    }


def _stage_status(decisions: list[DecisionLog]) -> str:
    """阶段状态归并：error > partial > skip（全为 skip）> ok。"""
    statuses = {d.status for d in decisions}
    if "error" in statuses:
        return "error"
    if "partial" in statuses:
        return "partial"
    if statuses and statuses <= {"skip"}:
        return "skip"
    return "ok"


async def materialize_run_events(db, run_id: str) -> dict:
    """回放：run_records + decision_logs → 与实时流同构的事件序列（契约 §5.1）。"""
    run = await db.get(RunRecord, run_id)
    if run is None:
        return {}

    decisions = (
        await db.execute(select(DecisionLog).where(DecisionLog.run_id == run_id))
    ).scalars().all()
    # 顺序必须与实时事件一致：以 finished_at（微秒精度、编排器显式写入）为准。
    # 注意不能用 created_at 排序——SQLite 的 CURRENT_TIMESTAMP 只到秒，同秒内的决策会退化成
    # 按 uuid 主键排序（随机），导致"回放顺序 ≠ 实时顺序"。
    decisions.sort(key=lambda d: (d.finished_at or d.created_at, d.id))

    # 按固定阶段顺序重建 stage_started / stage_decision / stage_finished
    by_stage: dict[str, list[DecisionLog]] = {key: [] for key in STAGE_ORDER}
    for dec in decisions:
        stage, _title = stage_of(dec.agent)
        by_stage.setdefault(stage, []).append(dec)

    events: list[dict] = [
        {"event": "run_started", "run_id": run.run_id, "started_at": _iso(run.started_at), "config": run.params or {}}
    ]
    ordered_stages = [k for k in STAGE_ORDER if by_stage.get(k)]
    for index, stage in enumerate(ordered_stages):
        items = by_stage[stage]
        first_at = _iso(items[0].finished_at or items[0].created_at)
        events.append(
            {
                "event": "stage_started",
                "run_id": run.run_id,
                "stage": stage,
                "name": STAGE_TITLE.get(stage, stage),
                "index": index,
                "total": len(ordered_stages),
                "started_at": first_at,
            }
        )
        for dec in items:
            events.append(_decision_event(dec))
        total_ms = sum(d.duration_ms or 0 for d in items)
        events.append(
            {
                "event": "stage_finished",
                "run_id": run.run_id,
                "stage": stage,
                "status": _stage_status(items),
                "detail": f"共 {len(items)} 项决策",
                "duration_ms": total_ms,
                "finished_at": _iso(items[-1].finished_at or items[-1].created_at),
            }
        )

    if run.status != "running":
        events.append(
            {
                "event": "run_finished",
                "run_id": run.run_id,
                "status": run.status,
                "summary": run.summary,
                "finished_at": _iso(run.finished_at),
                "duration_ms": run.duration_ms,
            }
        )

    return {**serialize_run(run), "events": events}

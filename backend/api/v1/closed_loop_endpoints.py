"""闭环运行 API（REFACTOR_PLAN_V2 T4）：SSE 实时流 + 运行历史 + 回放 + 取消。

与既有同步端点 `POST /api/v1/closed-loop/run`（source_endpoints.py）并存：
- 新链路（前端"一键运行闭环"）：`POST /api/v1/closed-loop/stream`，逐事件推送，前端增量渲染；
- 旧链路（脚本/测试/向后兼容）：`POST /api/v1/closed-loop/run` 原样保留，一行未改。

事件协议（字段冻结，见 REFACTOR_PLAN_V2 §5.1）：
run_started → N × (stage_started → M × stage_decision → stage_finished) → run_finished
心跳 heartbeat 每 10s 无事件时穿插；回放接口返回与实时**同构**的事件序列。
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from api.endpoints.auth import get_current_admin
from database import get_db

# 注意：这里必须用模块级引用（database.AsyncSessionLocal）而不是 from ... import AsyncSessionLocal。
# configure_database() 会重绑定 database.AsyncSessionLocal（测试库/多库场景），import 时快照会拿到旧引擎，
# 导致执行任务把运行记录写进另一个库（表现为 finish_run: 运行不存在）。
import database
from models import AdminUser
from services import run_service
from services.agent_orchestrator import run_closed_loop
from services.config_schema_service import validate_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")

HEARTBEAT_SECONDS = 10


def sse_frame(event: str, data: dict) -> str:
    """SSE 单帧（单行 JSON，便于前端按 \\n\\n 分帧解析）。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/closed-loop/stream")
async def run_closed_loop_stream(
    payload: dict | None = Body(default=None),
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """流式执行智能运营闭环（配置体由 closed_loop Schema 校验）。"""
    try:
        config = validate_config("closed_loop", payload or {})
    except ValueError as e:
        field = str(e).split(":", 1)[0]
        raise HTTPException(status_code=422, detail=[{"field": field, "message": str(e)}])

    # 互斥：同一时刻只允许一个进行中的闭环（防止重复点击产生并发运行）
    running = await run_service.get_running_run(db, run_service.TYPE_CLOSED_LOOP)
    if running is not None:
        return JSONResponse(
            status_code=409,
            content={"detail": "已有进行中的闭环运行", "run_id": running.run_id},
        )

    run = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, config)
    run_id = run.run_id
    started_at = run.started_at.isoformat() if run.started_at else datetime.now(timezone.utc).isoformat()

    async def _execute() -> dict:
        """实际执行 + 收尾。

        刻意使用**独立会话**而非请求作用域的 db：闭环是长任务，若与请求会话共享，
        客户端断线（依赖提前回收）会让执行中途拿到已关闭的会话而失败，运行记录也会残留
        在 running（需等 30 分钟超时回收）。独立会话让执行与请求生命周期解耦。
        """
        async with database.AsyncSessionLocal() as exec_db:
            try:
                result = await run_closed_loop(exec_db, config=config, on_event=on_event, run_id=run_id)
                await run_service.finish_run(exec_db, run_id, result.get("status", "ok"), result.get("summary"))
                return result
            except Exception as e:  # noqa: BLE001 —— 未预期错误：结算为 error 并向外抛
                logger.exception("闭环运行异常 %s", run_id)
                await run_service.finish_run(exec_db, run_id, "error", None, str(e))
                raise

    queue: asyncio.Queue = asyncio.Queue()

    async def on_event(event: str, data: dict) -> None:
        await queue.put((event, data))

    async def event_generator():
        task = asyncio.create_task(_execute())
        # ★ 先发 run_started，保证首事件快速返回（不等待任何阶段完成）
        yield sse_frame(
            "run_started", {"run_id": run_id, "started_at": started_at, "config": config}
        )
        try:
            while True:
                if task.done() and queue.empty():
                    break
                try:
                    event, data = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    if task.done() and queue.empty():
                        break
                    yield sse_frame(
                        "heartbeat", {"ts": datetime.now(timezone.utc).isoformat()}
                    )
                    continue
                yield sse_frame(event, data)

            try:
                result = task.result()
                yield sse_frame(
                    "run_finished",
                    {
                        "run_id": run_id,
                        "status": result.get("status", "ok"),
                        "summary": result.get("summary"),
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                        "duration_ms": await _duration_ms(run_id),
                    },
                )
            except Exception as e:  # noqa: BLE001
                yield sse_frame(
                    "run_error",
                    {
                        "run_id": run_id,
                        "message": str(e),
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
        finally:
            if not task.done():
                # 客户端断线：执行任务继续跑完并结算运行记录（前端可凭 run_id 回放补齐）
                logger.info("闭环流客户端断开，运行 %s 继续执行", run_id)
                task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _duration_ms(run_id: str) -> int | None:
    from models import RunRecord

    async with database.AsyncSessionLocal() as db:
        record = await db.get(RunRecord, run_id)
        return record.duration_ms if record else None


@router.get("/closed-loop/runs")
async def list_closed_loop_runs(
    limit: int = 10,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """闭环运行历史（含参数快照，便于复现）。"""
    return await run_service.list_runs(db, run_service.TYPE_CLOSED_LOOP, limit=limit)


@router.get("/closed-loop/runs/{run_id}")
async def get_closed_loop_run(
    run_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """回放：把运行记录物化为与实时流同构的事件序列。"""
    payload = await run_service.materialize_run_events(db, run_id)
    if not payload:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    return payload


@router.post("/closed-loop/runs/{run_id}/cancel")
async def cancel_closed_loop_run(
    run_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """请求取消运行（协作式：编排器在两个阶段之间检查该标志）。"""
    found = await run_service.request_cancel(db, run_id)
    if not found:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    return {"run_id": run_id, "cancel_requested": True}

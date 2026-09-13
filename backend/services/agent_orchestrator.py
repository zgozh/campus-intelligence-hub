"""三层 Agent 智能运营闭环（G）：采集 Agent → 知识治理 Agent → 问答/运营 Agent 一键编排。

REFACTOR_PLAN_V2 T4 改造要点：
- **参数可配置**：由 `config_schema_service` 的 closed_loop Schema 驱动（采集范围/时间/栏目、
  治理开关、运营开关、健康度阈值），未传时按 Schema 默认值执行；
- **决策产生即落库**（修复旧实现"结束后批量落库"导致运行中拉不到任何步骤的隐藏根因），
  并带 `finished_at`/`duration_ms`，供时间线展示每步完成时刻与耗时；
- **实时事件外发**：通过 `on_event(event, payload)` 回调把 stage_started / stage_decision /
  stage_finished 推给 SSE 端点；事件字段与回放（run_service.materialize_run_events）完全同构；
- **协作式取消**：阶段之间检查 cancel_requested；
- **单阶段失败降级**：保持既有语义，任一阶段异常不中断整条闭环（且不因 LLM 无 Key 中断）。
"""
import asyncio
import logging
import time
from datetime import datetime, timezone

from sqlalchemy import select

import database
from models import CollectionJob, DecisionLog, Source
from services import run_service
from services.config_schema_service import validate_config

logger = logging.getLogger(__name__)

# 闭环各阶段的固定顺序与中文名（事件与回放共用）
STAGE_COLLECTION = "collection"
STAGE_GOVERNANCE = "governance"
STAGE_OPERATION = "operation"
STAGE_SEQUENCE = (STAGE_COLLECTION, STAGE_GOVERNANCE, STAGE_OPERATION)

# 闭环采集阶段的默认每源页数（config 未给时的兜底；Schema 默认为 1）
DEFAULT_LOOP_MAX_PAGES = 1


def _ms(started: float) -> int:
    return max(0, int((time.perf_counter() - started) * 1000))


class EventSink:
    """决策落库 + 事件外发（每个决策产生即 commit，运行中即可查询/回放）。"""

    def __init__(self, db, run_id: str, on_event=None):
        self.db = db
        self.run_id = run_id
        self.on_event = on_event
        self.by_stage: dict[str, list[dict]] = {key: [] for key in STAGE_SEQUENCE}

    async def _emit(self, event: str, payload: dict) -> None:
        if self.on_event is None:
            return
        try:
            await self.on_event(event, payload)
        except Exception:  # noqa: BLE001 —— 外发失败不影响闭环执行
            logger.debug("闭环事件外发失败（忽略）", exc_info=True)

    async def stage_started(self, stage: str, index: int, total: int) -> None:
        await self._emit(
            "stage_started",
            {
                "run_id": self.run_id,
                "stage": stage,
                "name": run_service.STAGE_TITLE.get(stage, stage),
                "index": index,
                "total": total,
                "started_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    async def decision(
        self,
        agent: str,
        decision: str,
        detail: str | None = None,
        status: str = "ok",
        duration_ms: int = 0,
        stage: str | None = None,
    ) -> dict:
        stage_key = stage or run_service.stage_of(agent)[0]
        finished_at = datetime.now(timezone.utc)
        self.db.add(
            DecisionLog(
                run_id=self.run_id,
                agent=agent,
                decision=decision,
                detail=detail,
                status=status,
                finished_at=finished_at,
                duration_ms=duration_ms,
            )
        )
        await self.db.commit()  # ★ 产生即落库
        payload = {
            "run_id": self.run_id,
            "stage": stage_key,
            "agent": agent,
            "decision": decision,
            "detail": detail,
            "status": status,
            "finished_at": finished_at.isoformat(),
            "duration_ms": duration_ms,
        }
        self.by_stage.setdefault(stage_key, []).append(
            {"agent": agent, "decision": decision, "detail": detail, "status": status}
        )
        await self._emit("stage_decision", payload)
        return payload

    async def stage_finished(self, stage: str, status: str, detail: str, duration_ms: int) -> None:
        await self._emit(
            "stage_finished",
            {
                "run_id": self.run_id,
                "stage": stage,
                "status": status,
                "detail": detail,
                "duration_ms": duration_ms,
                "finished_at": datetime.now(timezone.utc).isoformat(),
            },
        )


def _collection_params(config: dict) -> dict:
    """把闭环配置折算为 CollectionJob.params（与单源采集参数同源）。"""
    params: dict = {
        "trigger": "closed_loop",
        "max_pages": int(config.get("max_pages") or DEFAULT_LOOP_MAX_PAGES),
    }
    for key in ("column", "since", "until"):
        value = config.get(key)
        if value:
            params[key] = value
    if config.get("only_new"):
        params["only_new"] = True
    return params


async def _stage_collection(db, config: dict, sink: EventSink) -> dict:
    """采集层：为选中的数据源建采集任务并执行（best-effort）。"""
    started = time.perf_counter()
    if not config.get("collect"):
        await sink.decision(
            "采集 Agent", "跳过实时采集", "collect=false，未访问外部源", "skip", _ms(started)
        )
        return {"name": "采集 Agent", "status": "skipped", "detail": "未开启实时采集", "jobs": 0}

    query = select(Source).where(Source.status == "active")
    source_ids = config.get("source_ids") or []
    if source_ids:
        query = query.where(Source.id.in_(source_ids))
    sources = (await db.execute(query)).scalars().all()
    if not sources:
        await sink.decision("采集 Agent", "无活跃数据源", "跳过采集", "ok", _ms(started))
        return {"name": "采集 Agent", "status": "ok", "detail": "无 active 数据源", "jobs": 0}

    from services.collection_service import run_collection

    params = _collection_params(config)
    created = ok = failed = 0
    for src in sources:
        job = CollectionJob(source_id=src.id, status="PENDING", params=dict(params))
        db.add(job)
        await db.commit()
        await db.refresh(job)
        created += 1
        try:
            await run_collection(job.id)
            refetched = await db.get(CollectionJob, job.id)
            if refetched and refetched.status in ("SUCCESS", "PARTIAL"):
                ok += 1
            else:
                failed += 1
                logger.warning(
                    "闭环采集源 %s 未成功：%s", src.name, (refetched.error_message if refetched else "unknown")
                )
        except Exception as e:  # noqa: BLE001 —— 单源失败不影响其它源
            failed += 1
            logger.warning("采集 Agent 源 %s 失败: %s", src.name, e)

    await sink.decision(
        "采集 Agent",
        f"采集 {created} 个数据源",
        f"成功 {ok} · 失败 {failed}（页数 {params['max_pages']}）",
        "ok" if failed == 0 else "partial",
        _ms(started),
    )
    return {
        "name": "采集 Agent",
        "status": "ok" if failed == 0 else "partial",
        "detail": f"运行 {created} 个数据源：成功 {ok} · 失败 {failed}",
        "jobs": created,
    }


async def _stage_knowledge(db, config: dict, sink: EventSink) -> dict:
    """知识治理层：新鲜度/冲突/审核/归档/图谱（按配置开关，跳过也留决策）。"""
    started = time.perf_counter()

    if config.get("refresh_freshness", True):
        from services.freshness_service import refresh_freshness

        t = time.perf_counter()
        fres = await refresh_freshness(db)
        await sink.decision(
            "知识治理 Agent", "新鲜度刷新", f"过期 {fres.get('expired', 0)}", "ok", _ms(t)
        )
    else:
        await sink.decision("知识治理 Agent", "新鲜度刷新", "配置已关闭", "skip", 0)

    conflict_count = 0
    if config.get("detect_conflicts", True):
        from services.conflict_service import detect_conflicts

        t = time.perf_counter()
        conflict_count = await detect_conflicts(db)
        await sink.decision(
            "知识治理 Agent", "冲突检测", f"新增 {conflict_count} 冲突", "ok", _ms(t)
        )
    else:
        await sink.decision("知识治理 Agent", "冲突检测", "配置已关闭", "skip", 0)

    from services.review_service import build_review_queue

    t = time.perf_counter()
    queued = await build_review_queue(db)
    await sink.decision("知识治理 Agent", "审核队列", f"入队 {queued}", "ok", _ms(t))

    archived = 0
    if config.get("archive_expired", True):
        from services.governance_service import archive_expired

        t = time.perf_counter()
        archived = await archive_expired(db)
        await sink.decision("知识治理 Agent", "归档过期", f"归档 {archived}", "ok", _ms(t))
    else:
        await sink.decision("知识治理 Agent", "归档过期", "配置已关闭", "skip", 0)

    kg_added = 0
    force = bool(config.get("rebuild_kg"))
    t = time.perf_counter()
    try:
        from services.kg_service import build_graph

        kg = await build_graph(db, limit=20, force=force)
        kg_added = kg.get("relations_added", 0)
        await sink.decision(
            "图谱 Agent",
            "图谱强制重建" if force else "图谱增量构建",
            f"新增关系 {kg_added}",
            "ok",
            _ms(t),
        )
    except Exception as e:  # noqa: BLE001 —— 图谱失败降级，不中断闭环
        logger.warning("知识治理 Agent 图谱构建失败（降级）: %s", e)
        await sink.decision("图谱 Agent", "图谱构建（降级）", str(e), "partial", _ms(t))

    return {
        "name": "知识治理 Agent",
        "status": "ok",
        "detail": f"冲突 {conflict_count} · 审核 {queued} · 归档过期 {archived} · 新增关系 {kg_added}",
    }


async def _stage_answer(db, config: dict, sink: EventSink) -> dict:
    """问答/运营层：日报 + AI 洞察 + 健康度（按配置开关，跳过也留决策）。

    REFACTOR_PLAN_V2_2 B3：日报与洞察**并行**执行（两者无数据依赖，各自写自己的表），
    总耗时由"两次 LLM 相加"降为"取较大者"（真机实测 16.9–18.6s → 目标 ≤15s）。
    并发写库不能共用同一个 AsyncSession，故各自使用独立会话。
    """
    started = time.perf_counter()
    should_push = bool(config.get("push_notifications", True))

    want_digest = bool(config.get("gen_digest", True))
    want_insight = bool(config.get("gen_insight", True))

    async def _digest_job() -> tuple[dict, int]:
        from services.digest_service import generate_digest

        t = time.perf_counter()
        async with database.AsyncSessionLocal() as session:
            result = await generate_digest(session, "daily")
        return result, _ms(t)

    async def _insight_job() -> tuple[dict, int]:
        from agents.insight_generator import generate_insight

        t = time.perf_counter()
        async with database.AsyncSessionLocal() as session:
            result = await generate_insight(session, persist=True)
        return result, _ms(t)

    jobs: dict[str, "asyncio.Task"] = {}
    if want_digest:
        jobs["digest"] = asyncio.create_task(_digest_job())
    if want_insight:
        jobs["insight"] = asyncio.create_task(_insight_job())

    outcomes: dict[str, object] = {}
    if jobs:
        results = await asyncio.gather(*jobs.values(), return_exceptions=True)
        for name, outcome in zip(jobs.keys(), results):
            outcomes[name] = outcome

    # ---- 日报 ----
    digest_title = ""
    if not want_digest:
        await sink.decision("问答/运营 Agent", "生成日报", "配置已关闭", "skip", 0)
    else:
        outcome = outcomes.get("digest")
        if isinstance(outcome, BaseException):
            logger.warning("闭环日报生成失败（降级）: %s", outcome)
            await sink.decision("问答/运营 Agent", "生成日报", str(outcome), "partial", 0)
        else:
            digest, duration = outcome  # type: ignore[misc]
            digest_title = digest.get("title", "")
            await sink.decision("问答/运营 Agent", "生成日报", digest_title, "ok", duration)

    # ---- 洞察 ----
    if not want_insight:
        await sink.decision("问答/运营 Agent", "生成洞察", "配置已关闭", "skip", 0)
    else:
        outcome = outcomes.get("insight")
        if isinstance(outcome, BaseException):
            logger.warning("闭环洞察生成失败（降级）: %s", outcome)
            await sink.decision("问答/运营 Agent", "生成洞察", str(outcome), "partial", 0)
        else:
            insight, duration = outcome  # type: ignore[misc]
            await sink.decision(
                "问答/运营 Agent",
                "生成洞察",
                insight.get("title") or f"insight {insight.get('id', '')}",
                "ok",
                duration,
            )
            if should_push:
                try:
                    from services.notify_service import push_notification

                    await push_notification(
                        db,
                        "insight",
                        insight.get("title") or "AI 校务洞察",
                        insight.get("content"),
                        link="/insights",
                    )
                except Exception as e:  # noqa: BLE001 —— 推送失败不影响闭环
                    logger.warning("闭环洞察推送失败（降级）: %s", e)

    from services.radar_service import knowledge_health

    t = time.perf_counter()
    health = await knowledge_health(db)
    score = health.get("health_score")
    await sink.decision("问答/运营 Agent", "计算健康度", str(score), "ok", _ms(t))

    threshold = config.get("health_threshold")
    if isinstance(threshold, int) and isinstance(score, (int, float)) and score < threshold:
        await sink.decision(
            "问答/运营 Agent",
            "健康度低于阈值",
            f"当前 {score} < 阈值 {threshold}",
            "partial",
            0,
        )
        if should_push:
            try:
                from services.notify_service import push_notification

                await push_notification(
                    db,
                    "alert",
                    f"知识健康度低于阈值（{score} < {threshold}）",
                    health.get("advice") or "建议检查过期知识、冲突与来源异常",
                    link="/notifications",
                )
            except Exception as e:  # noqa: BLE001
                logger.warning("闭环健康度告警推送失败（降级）: %s", e)

    return {
        "name": "问答/运营 Agent",
        "status": "ok",
        "detail": f"健康度 {score} · 日报 {digest_title}",
    }


async def run_closed_loop(
    db,
    collect: bool | None = None,
    config: dict | None = None,
    on_event=None,
    run_id: str | None = None,
) -> dict:
    """依次执行三层，决策产生即落库并外发事件，返回带 stage 轨迹与 run_id 的结果。

    向后兼容：既有调用 `run_closed_loop(db, collect=True)` 仍然可用（折算为 config）。
    """
    if config is None:
        payload = {} if collect is None else {"collect": bool(collect)}
        config = validate_config("closed_loop", payload)
    elif collect is not None:
        config = {**config, "collect": bool(collect)}

    run_id = run_id or run_service.new_run_id()
    sink = EventSink(db, run_id, on_event=on_event)
    stages: list[dict] = []
    status = "ok"
    total = len(STAGE_SEQUENCE)

    stage_funcs = (
        (STAGE_COLLECTION, _stage_collection),
        (STAGE_GOVERNANCE, _stage_knowledge),
        (STAGE_OPERATION, _stage_answer),
    )

    for index, (stage_key, func) in enumerate(stage_funcs):
        if await run_service.is_cancel_requested(db, run_id):
            await sink.stage_finished(stage_key, "error", "用户取消", 0)
            stages.append(
                {"name": run_service.STAGE_TITLE[stage_key], "status": "cancelled", "detail": "用户取消"}
            )
            status = "cancelled"
            continue

        await sink.stage_started(stage_key, index, total)
        stage_started = time.perf_counter()
        try:
            result = await func(db, config, sink)
            stage_status = result.get("status", "ok")
        except Exception as e:  # noqa: BLE001 —— 单阶段失败降级，继续后续阶段
            logger.exception("%s 阶段失败", stage_key)
            stage_status = "error"
            result = {
                "name": run_service.STAGE_TITLE[stage_key],
                "status": "error",
                "detail": str(e),
            }
            await sink.decision(
                run_service.STAGE_TITLE[stage_key].replace("实时采集", "采集 Agent"),
                f"{run_service.STAGE_TITLE[stage_key]}失败",
                str(e),
                "error",
                _ms(stage_started),
                stage=stage_key,
            )
        await sink.stage_finished(
            stage_key, stage_status, result.get("detail", ""), _ms(stage_started)
        )
        stages.append(
            {
                "name": result.get("name", run_service.STAGE_TITLE[stage_key]),
                "status": stage_status,
                "detail": result.get("detail", ""),
                "jobs": result.get("jobs", 0),
                "decisions": sink.by_stage.get(stage_key, []),
            }
        )
        if stage_status == "error":
            status = "partial"

    if status != "cancelled":
        ok = sum(1 for s in stages if s["status"] in ("ok", "partial", "skipped"))
        status = "ok" if ok == len(stages) and all(s["status"] != "partial" for s in stages) else "partial"

    summary = f"闭环执行完成：{len(stages)} 层，状态 {status}"
    return {
        "run_id": run_id,
        "stages": stages,
        "summary": summary,
        "status": status,
        "config": config,
        "decision_count": sum(len(v) for v in sink.by_stage.values()),
    }

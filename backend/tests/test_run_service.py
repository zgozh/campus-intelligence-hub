"""T2 run_service 测试：运行生命周期、互斥、取消、超时自愈、回放同构。

回放同构是前端"实时时间线"与"历史回放"共用同一 reducer 的前提，故对字段集做冻结断言。
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import DecisionLog, RunRecord  # noqa: E402
from services import run_service  # noqa: E402

# 实时 SSE 的 stage_decision data 契约（REFACTOR_PLAN_V2 §5.1）——回放必须逐字段一致
DECISION_EVENT_FIELDS = {
    "run_id",
    "stage",
    "agent",
    "decision",
    "detail",
    "status",
    "finished_at",
    "duration_ms",
}


async def _add_decision(session, run_id, agent, decision, status, offset_seconds, duration_ms):
    session.add(
        DecisionLog(
            run_id=run_id,
            agent=agent,
            decision=decision,
            detail=f"{decision} 详情",
            status=status,
            finished_at=datetime.now(timezone.utc) + timedelta(seconds=offset_seconds),
            duration_ms=duration_ms,
        )
    )


class TestRunLifecycle:
    async def test_create_run_sets_running_and_snapshot(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            run = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {"collect": True})
            assert run.status == "running"
            assert run.type == "closed_loop"
            assert run.params == {"collect": True}
            assert run.cancel_requested is False
            assert run.started_at is not None
            assert len(run.run_id) == 12

            payload = run_service.serialize_run(run)
            assert payload["started_at"] is not None
            assert payload["started_at"].endswith("+00:00")  # 带时区 ISO 8601
            assert payload["finished_at"] is None

    async def test_finish_run_computes_duration(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            run = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {})
            # 把开始时间前移 2 秒，确保耗时被真实计算
            run.started_at = datetime.now(timezone.utc) - timedelta(seconds=2)
            await db.commit()

            await run_service.finish_run(db, run.run_id, "ok", "闭环完成")
            await db.refresh(run)
            assert run.status == "ok"
            assert run.summary == "闭环完成"
            assert run.duration_ms is not None and run.duration_ms >= 1000

    async def test_finish_unknown_run_is_noop(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            await run_service.finish_run(db, "no_such_run", "ok", None)  # 不应抛异常

    async def test_cancel_roundtrip(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            run = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {})
            assert await run_service.is_cancel_requested(db, run.run_id) is False
            assert await run_service.request_cancel(db, run.run_id) is True
            assert await run_service.is_cancel_requested(db, run.run_id) is True
            assert await run_service.request_cancel(db, "no_such_run") is False

    async def test_get_running_run_mutex(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            run = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {})
            running = await run_service.get_running_run(db, run_service.TYPE_CLOSED_LOOP)
            assert running is not None and running.run_id == run.run_id

            await run_service.finish_run(db, run.run_id, "ok", None)
            assert await run_service.get_running_run(db, run_service.TYPE_CLOSED_LOOP) is None

    async def test_stale_running_run_is_auto_closed(self, setup_test_db):
        """崩溃未收尾的运行不能永久阻塞后续运行。"""
        async with database.AsyncSessionLocal() as db:
            run = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {})
            run.started_at = datetime.now(timezone.utc) - timedelta(
                minutes=run_service.STALE_RUN_MINUTES + 1
            )
            await db.commit()

            assert await run_service.get_running_run(db, run_service.TYPE_CLOSED_LOOP) is None
            await db.refresh(run)
            assert run.status == "error"
            assert run.finished_at is not None
            assert "自动关闭" in (run.error or "")

    async def test_running_run_without_started_at_is_also_reaped(self, setup_test_db):
        """started_at 为 NULL 的残留 running（进程重启/异常退出）同样必须被回收。

        真机事故复现：一条 started_at=NULL 的 running 行会让闭环端点永久返回 409。
        """
        async with database.AsyncSessionLocal() as db:
            stale = RunRecord(
                run_id="run_stale_null_start",
                type=run_service.TYPE_CLOSED_LOOP,
                status="running",
                params={},
            )
            db.add(stale)
            await db.commit()
            # 把 created_at 前移到超时阈值之外
            stale.created_at = datetime.now(timezone.utc) - timedelta(
                minutes=run_service.STALE_RUN_MINUTES + 5
            )
            stale.started_at = None
            await db.commit()

            assert await run_service.get_running_run(db, run_service.TYPE_CLOSED_LOOP) is None
            await db.refresh(stale)
            assert stale.status == "error"
            assert "自动关闭" in (stale.error or "")

    async def test_fresh_run_without_started_at_is_not_reaped(self, setup_test_db):
        """回收只针对超时者，不能误伤刚创建（started_at 尚未写入）的运行。"""
        async with database.AsyncSessionLocal() as db:
            fresh = RunRecord(
                run_id="run_fresh_null_start",
                type=run_service.TYPE_CLOSED_LOOP,
                status="running",
                params={},
            )
            db.add(fresh)
            await db.commit()

            running = await run_service.get_running_run(db, run_service.TYPE_CLOSED_LOOP)
            assert running is not None and running.run_id == "run_fresh_null_start"


class TestListRuns:
    async def test_list_runs_returns_history(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            first = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {"a": 1})
            await run_service.finish_run(db, first.run_id, "ok", "第一次")
            second = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {"b": 2})

            payload = await run_service.list_runs(db, run_service.TYPE_CLOSED_LOOP, limit=10)
            assert payload["total"] == 2
            assert len(payload["runs"]) == 2
            # 最近的在前
            assert payload["runs"][0]["run_id"] == second.run_id
            assert payload["runs"][0]["status"] == "running"
            assert payload["runs"][1]["summary"] == "第一次"

    async def test_list_runs_filters_by_type(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {})
            payload = await run_service.list_runs(db, "collection", limit=10)
            assert payload["total"] == 0
            assert payload["runs"] == []


class TestMaterializeRunEvents:
    async def test_replay_is_isomorphic_to_realtime(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            run = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {"collect": False})
            await _add_decision(db, run.run_id, "采集 Agent", "跳过实时采集", "skip", 0, 5)
            await _add_decision(db, run.run_id, "知识治理 Agent", "冲突检测", "partial", 1, 120)
            await _add_decision(db, run.run_id, "问答/运营 Agent", "生成日报", "ok", 2, 800)
            await db.commit()
            await run_service.finish_run(db, run.run_id, "partial", "3 项决策")

            payload = await run_service.materialize_run_events(db, run.run_id)
            assert payload["run_id"] == run.run_id
            assert payload["status"] == "partial"
            assert payload["params"] == {"collect": False}

            names = [e["event"] for e in payload["events"]]
            assert names[0] == "run_started"
            assert names[-1] == "run_finished"
            assert names.count("stage_started") == 3
            assert names.count("stage_finished") == 3
            assert names.count("stage_decision") == 3

            decisions = [e for e in payload["events"] if e["event"] == "stage_decision"]
            # ★ 字段集冻结：与实时流 data 逐字段一致（多出的 event 是事件名本身）
            for event in decisions:
                assert set(event) - {"event"} == DECISION_EVENT_FIELDS
            assert [d["agent"] for d in decisions] == ["采集 Agent", "知识治理 Agent", "问答/运营 Agent"]
            assert [d["stage"] for d in decisions] == ["collection", "governance", "operation"]
            assert decisions[1]["duration_ms"] == 120

            # 阶段状态归并：partial 阶段即为 partial
            gov = [e for e in payload["events"] if e["event"] == "stage_finished" and e["stage"] == "governance"]
            assert gov and gov[0]["status"] == "partial"
            coll = [e for e in payload["events"] if e["event"] == "stage_finished" and e["stage"] == "collection"]
            assert coll and coll[0]["status"] == "skip"

    async def test_running_run_replay_has_no_run_finished(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            run = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {})
            await _add_decision(db, run.run_id, "采集 Agent", "采集中", "ok", 0, 10)
            await db.commit()

            payload = await run_service.materialize_run_events(db, run.run_id)
            names = [e["event"] for e in payload["events"]]
            assert "run_finished" not in names
            assert "stage_decision" in names

    async def test_unknown_run_returns_empty(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            assert await run_service.materialize_run_events(db, "no_such_run") == {}


class TestStageMapping:
    def test_known_agents_map_to_stages(self):
        assert run_service.stage_of("采集 Agent")[0] == "collection"
        assert run_service.stage_of("知识治理 Agent")[0] == "governance"
        assert run_service.stage_of("问答/运营 Agent")[0] == "operation"

    def test_unknown_agent_falls_back_without_losing_event(self):
        assert run_service.stage_of("新 Agent")[0] == "operation"
        assert run_service.stage_of(None)[0] == "operation"

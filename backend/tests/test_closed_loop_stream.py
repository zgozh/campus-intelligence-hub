"""T4 闭环 SSE 流式端点测试：事件协议、配置驱动、单阶段降级、互斥、回放同构、取消。

对应用户实测缺陷：点击「一键运行闭环」后界面卡住、所有结果等全部跑完才一次性出现。
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import DecisionLog, RunRecord  # noqa: E402
from services import run_service  # noqa: E402
from services import agent_orchestrator  # noqa: E402

STREAM_URL = "/api/v1/closed-loop/stream"

# 与实时流 stage_decision data 冻结契约一致（回放必须同构）
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


def parse_sse(text: str) -> list[tuple[str, dict]]:
    """把 SSE 文本解析为 [(event, data), ...]。"""
    events: list[tuple[str, dict]] = []
    for block in text.split("\n\n"):
        name = None
        payload = None
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[len("event: "):]
            elif line.startswith("data: "):
                payload = line[len("data: "):]
        if name and payload is not None:
            events.append((name, json.loads(payload)))
    return events


async def _run_stream(client, body: dict) -> tuple[int, list[tuple[str, dict]], str]:
    resp = await client.post(STREAM_URL, json=body, timeout=180)
    events = parse_sse(resp.text) if resp.status_code == 200 else []
    return resp.status_code, events, resp.text


class TestStreamEventSequence:
    async def test_full_sequence_and_payloads(self, client, setup_test_db):
        status_code, events, _raw = await _run_stream(client, {})
        assert status_code == 200
        names = [e[0] for e in events]

        # ① 首事件必须是 run_started，且字段齐全（首事件快速返回是流式体验的前提）
        assert names[0] == "run_started"
        first = events[0][1]
        assert first["run_id"] and first["started_at"] and isinstance(first["config"], dict)

        # ② 事件序列完整：三段 stage_started / stage_finished 成对
        assert names.count("stage_started") == 3
        assert names.count("stage_finished") == 3
        assert names.count("stage_decision") >= 6
        assert names[-1] == "run_finished"
        assert events[-1][1]["status"] in ("ok", "partial")

        # ③ 阶段顺序固定
        started_stages = [e[1]["stage"] for e in events if e[0] == "stage_started"]
        assert started_stages == ["collection", "governance", "operation"]

        # ④ 每个决策都带完成时刻与耗时（时间线右侧展示依据）
        for name, data in events:
            if name != "stage_decision":
                continue
            assert set(data) == DECISION_EVENT_FIELDS
            assert data["finished_at"] and data["finished_at"].endswith("+00:00")
            assert isinstance(data["duration_ms"], int)
            assert data["status"] in ("ok", "partial", "error", "skip")

    async def test_decisions_are_committed_immediately(self, client, setup_test_db, monkeypatch):
        """D1 修复验证：运行中途（后续阶段）就已能查到前面阶段的决策落库。"""
        seen: dict = {}
        original = agent_orchestrator._stage_answer

        async def spy(db, config, sink):
            async with database.AsyncSessionLocal() as other:
                from sqlalchemy import func, select

                count = await other.scalar(
                    select(func.count(DecisionLog.id)).where(DecisionLog.run_id == sink.run_id)
                )
            seen["mid_run_count"] = int(count or 0)
            return await original(db, config, sink)

        monkeypatch.setattr(agent_orchestrator, "_stage_answer", spy)

        status_code, events, _ = await _run_stream(client, {})
        assert status_code == 200
        # 运营阶段开始时，采集+治理阶段的决策必须已经落库（旧实现要等全部结束才写）
        assert seen["mid_run_count"] >= 4

    async def test_config_switches_produce_skip_decisions(self, client, setup_test_db):
        body = {
            "collect": False,
            "refresh_freshness": False,
            "detect_conflicts": False,
            "archive_expired": False,
            "gen_digest": False,
            "gen_insight": False,
        }
        status_code, events, _ = await _run_stream(client, body)
        assert status_code == 200
        decisions = [e[1] for e in events if e[0] == "stage_decision"]
        skipped = {d["decision"] for d in decisions if d["status"] == "skip"}
        assert "跳过实时采集" in skipped
        assert "新鲜度刷新" in skipped
        assert "冲突检测" in skipped
        assert "生成日报" in skipped
        assert "生成洞察" in skipped
        # 统计类决策仍然执行（不受开关影响）
        assert any(d["decision"] == "计算健康度" for d in decisions)

    async def test_stage_failure_does_not_break_stream(self, client, setup_test_db, monkeypatch):
        async def boom(db, config, sink):
            raise RuntimeError("治理阶段故意失败")

        monkeypatch.setattr(agent_orchestrator, "_stage_knowledge", boom)

        status_code, events, _ = await _run_stream(client, {})
        assert status_code == 200
        names = [e[0] for e in events]
        assert "run_error" not in names  # 单阶段失败不整流失败
        assert names[-1] == "run_finished"

        gov_finished = [
            e[1] for e in events if e[0] == "stage_finished" and e[1]["stage"] == "governance"
        ]
        assert gov_finished and gov_finished[0]["status"] == "error"
        # 后续运营阶段仍执行
        assert any(e[0] == "stage_started" and e[1]["stage"] == "operation" for e in events)
        assert events[-1][1]["status"] == "partial"


class TestStreamGuards:
    async def test_mutex_conflict_409(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            existing = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {})
            existing_id = existing.run_id

        resp = await client.post(STREAM_URL, json={}, timeout=60)
        assert resp.status_code == 409
        body = resp.json()
        assert body["run_id"] == existing_id
        assert "进行中" in body["detail"]

    async def test_invalid_config_422(self, client, setup_test_db):
        resp = await client.post(STREAM_URL, json={"max_pages": 99}, timeout=60)
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert isinstance(detail, list)
        assert detail[0]["field"] == "max_pages"
        assert "不得大于" in detail[0]["message"]

    async def test_requires_auth(self, public_client, setup_test_db):
        resp = await public_client.post(STREAM_URL, json={})
        assert resp.status_code in (401, 403)


class TestReplayAndHistory:
    async def test_replay_is_isomorphic_to_realtime(self, client, setup_test_db):
        status_code, events, _ = await _run_stream(client, {})
        assert status_code == 200
        run_id = events[0][1]["run_id"]

        replay = await client.get(f"/api/v1/closed-loop/runs/{run_id}")
        assert replay.status_code == 200
        payload = replay.json()
        assert payload["run_id"] == run_id
        assert payload["params"] is not None

        realtime_decisions = [e[1] for e in events if e[0] == "stage_decision"]
        replay_decisions = [e for e in payload["events"] if e["event"] == "stage_decision"]
        assert len(replay_decisions) == len(realtime_decisions)
        # ★ 字段集同构：前端同一个 reducer 可处理实时与回放
        for event in replay_decisions:
            assert set(event) - {"event"} == DECISION_EVENT_FIELDS
        assert [e["decision"] for e in replay_decisions] == [
            e["decision"] for e in realtime_decisions
        ]
        # 回放序列首尾事件也存在
        replay_names = [e["event"] for e in payload["events"]]
        assert replay_names[0] == "run_started"
        assert replay_names[-1] == "run_finished"

    async def test_runs_list_contains_params_snapshot(self, client, setup_test_db):
        body = {"collect": False, "max_pages": 3, "gen_digest": False, "gen_insight": False}
        status_code, events, _ = await _run_stream(client, body)
        assert status_code == 200
        run_id = events[0][1]["run_id"]

        listing = await client.get("/api/v1/closed-loop/runs", params={"limit": 5})
        assert listing.status_code == 200
        data = listing.json()
        assert data["total"] >= 1
        target = next(r for r in data["runs"] if r["run_id"] == run_id)
        assert target["params"]["max_pages"] == 3
        assert target["params"]["gen_insight"] is False
        assert target["duration_ms"] is not None

    async def test_replay_unknown_run_404(self, client, setup_test_db):
        resp = await client.get("/api/v1/closed-loop/runs/no_such_run")
        assert resp.status_code == 404


class TestCancel:
    async def test_cancel_sets_flag(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            run = await run_service.create_run(db, run_service.TYPE_CLOSED_LOOP, {})
            run_id = run.run_id

        resp = await client.post(f"/api/v1/closed-loop/runs/{run_id}/cancel")
        assert resp.status_code == 200
        assert resp.json()["cancel_requested"] is True

        async with database.AsyncSessionLocal() as db:
            row = await db.get(RunRecord, run_id)
            assert row.cancel_requested is True

    async def test_cancel_unknown_run_404(self, client, setup_test_db):
        resp = await client.post("/api/v1/closed-loop/runs/no_such_run/cancel")
        assert resp.status_code == 404

    async def test_cancelled_run_stops_before_next_stage(self, client, setup_test_db, monkeypatch):
        """取消标志在阶段之间生效：后续阶段不再执行。"""
        executed: list[str] = []
        original = agent_orchestrator._stage_knowledge

        async def spy(db, config, sink):
            executed.append("governance")
            # 模拟用户在治理阶段结束后点了取消
            await run_service.request_cancel(db, sink.run_id)
            return await original(db, config, sink)

        monkeypatch.setattr(agent_orchestrator, "_stage_knowledge", spy)

        status_code, events, _ = await _run_stream(client, {})
        assert status_code == 200
        assert executed == ["governance"]
        assert not any(
            e[0] == "stage_started" and e[1]["stage"] == "operation" for e in events
        )
        assert events[-1][1]["status"] == "cancelled"


class TestSyncEndpointStillWorks:
    async def test_legacy_sync_endpoint_unchanged(self, client, setup_test_db):
        """向后兼容：旧同步端点必须保持可用（硬约束"只增不改"）。"""
        resp = await client.post("/api/v1/closed-loop/run", params={"collect": False}, timeout=180)
        assert resp.status_code == 200
        body = resp.json()
        assert body["run_id"]
        assert len(body["stages"]) == 3
        assert body["summary"]
        # 旧结构字段仍在
        assert body["stages"][0]["name"] == "采集 Agent"

    async def test_decisions_endpoint_still_returns_runs(self, client, setup_test_db):
        await client.post("/api/v1/closed-loop/run", params={"collect": False}, timeout=180)
        resp = await client.get("/api/v1/agents/decisions")
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1

    async def test_decision_log_rows_have_timing(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            result = await agent_orchestrator.run_closed_loop(db, collect=False)
            rows = (
                await db.execute(
                    DecisionLog.__table__.select().where(DecisionLog.run_id == result["run_id"])
                )
            ).all()
        assert rows
        for row in rows:
            assert row.finished_at is not None
            assert row.duration_ms is not None
        assert datetime.now(timezone.utc).tzinfo is not None

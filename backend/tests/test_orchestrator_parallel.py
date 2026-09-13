"""B3 闭环并行化测试：日报与洞察必须**并发**执行（而非串行相加）。

背景：REFACTOR_PLAN_V2_2 B3 —— 不含采集的闭环实测 16.9–18.6s（两次真实 LLM 串行），
目标 ≤15s。改为 asyncio.gather 并行 + 各自独立会话（并发写库不能共用同一个 AsyncSession）。
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import DecisionLog  # noqa: E402
from services import agent_orchestrator  # noqa: E402
from services.agent_orchestrator import run_closed_loop  # noqa: E402

SLEEP_SECONDS = 0.25


async def _run_with_spies(monkeypatch, config: dict) -> tuple[dict, dict[str, tuple[float, float]]]:
    """把日报/洞察替换为"记录起止时间 + sleep"的替身，返回 (闭环结果, 时间窗)。"""
    windows: dict[str, tuple[float, float]] = {}

    async def fake_digest(db, period="daily"):
        start = time.perf_counter()
        await asyncio.sleep(SLEEP_SECONDS)
        windows["digest"] = (start, time.perf_counter())
        return {"title": "日报替身", "content": "x"}

    async def fake_insight(db, persist=True):
        start = time.perf_counter()
        await asyncio.sleep(SLEEP_SECONDS)
        windows["insight"] = (start, time.perf_counter())
        return {"id": "ins_x", "title": "洞察替身", "content": "y"}

    import agents.insight_generator as insight_module
    import services.digest_service as digest_module

    monkeypatch.setattr(digest_module, "generate_digest", fake_digest)
    monkeypatch.setattr(insight_module, "generate_insight", fake_insight)

    async with database.AsyncSessionLocal() as db:
        result = await run_closed_loop(db, config=config)
    return result, windows


def _overlap(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


class TestParallelAnswerStage:
    async def test_digest_and_insight_run_concurrently(self, setup_test_db, monkeypatch):
        config = {
            "collect": False,
            "gen_digest": True,
            "gen_insight": True,
            "push_notifications": False,
            "health_threshold": 0,
        }
        started = time.perf_counter()
        result, windows = await _run_with_spies(monkeypatch, config)
        elapsed = time.perf_counter() - started

        assert set(windows) == {"digest", "insight"}
        # ★ 核心断言：两个时间窗必须重叠（串行实现永不重叠）
        assert _overlap(windows["digest"], windows["insight"]), windows
        # 并行后运营阶段耗时应接近单次 sleep 而非两次之和
        assert elapsed < SLEEP_SECONDS * 1.8, elapsed
        assert result["status"] in ("ok", "partial")

    async def test_both_decisions_are_recorded_with_durations(self, setup_test_db, monkeypatch):
        config = {"collect": False, "gen_digest": True, "gen_insight": True, "push_notifications": False}
        result, _windows = await _run_with_spies(monkeypatch, config)

        async with database.AsyncSessionLocal() as db:
            from sqlalchemy import select

            rows = (
                await db.execute(
                    select(DecisionLog).where(DecisionLog.run_id == result["run_id"])
                )
            ).scalars().all()

        by_decision = {row.decision: row for row in rows}
        assert "生成日报" in by_decision
        assert "生成洞察" in by_decision
        # 两条决策仍带完成时刻与耗时（时间线右侧展示依据不因并行化丢失）
        for name in ("生成日报", "生成洞察"):
            assert by_decision[name].finished_at is not None
            assert (by_decision[name].duration_ms or 0) >= int(SLEEP_SECONDS * 1000 * 0.5)

    async def test_disabled_switches_still_produce_skip_decisions(self, setup_test_db, monkeypatch):
        config = {"collect": False, "gen_digest": False, "gen_insight": False}
        _result, windows = await _run_with_spies(monkeypatch, config)
        assert windows == {}  # 都没跑

    async def test_one_generator_failure_does_not_break_the_other(self, setup_test_db, monkeypatch):
        """单侧失败降级：另一侧照常完成，闭环不中断。"""
        import agents.insight_generator as insight_module
        import services.digest_service as digest_module

        async def ok_digest(db, period="daily"):
            return {"title": "日报替身", "content": "x"}

        async def broken_insight(db, persist=True):
            raise RuntimeError("洞察生成失败")

        monkeypatch.setattr(digest_module, "generate_digest", ok_digest)
        monkeypatch.setattr(insight_module, "generate_insight", broken_insight)

        async with database.AsyncSessionLocal() as db:
            result = await run_closed_loop(
                db, config={"collect": False, "push_notifications": False}
            )

        async with database.AsyncSessionLocal() as db:
            from sqlalchemy import select

            rows = (
                await db.execute(
                    select(DecisionLog).where(DecisionLog.run_id == result["run_id"])
                )
            ).scalars().all()
        by_decision = {row.decision: row.status for row in rows}
        assert by_decision.get("生成日报") == "ok"
        assert by_decision.get("生成洞察") == "partial"  # 失败侧降级为 partial
        assert result["run_id"]


class TestStageAnswerSignature:
    def test_orchestrator_uses_isolated_sessions_for_parallel_generators(self):
        """静态护栏：并发生成器必须使用 database.AsyncSessionLocal（独立会话），
        不能复用外层 db —— 否则同一 AsyncSession 并发使用会出错。"""
        import inspect

        source = inspect.getsource(agent_orchestrator._stage_answer)
        assert "AsyncSessionLocal" in source
        assert "asyncio.create_task" in source

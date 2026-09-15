"""闭环采集只挑「真的能采」的源（不产出注定失败的任务卡）。

背景：移除「暂停」按钮后，源的状态不再能由界面切换，于是状态会长期停在某个值上。
而闭环采集阶段原先只按 `status == "active"` 挑源，不过滤源类型/URL ——
把 manual（无 base_url）或未支持站点（如 jwc.gzhu.edu.cn）设成 active，
闭环就会派采集任务给它、必然失败并生成红色失败卡，演示时非常难看。

本文件锁定：闭环只对「有 base_url 且有适配器」的激活源建任务；
不可采集的激活源被跳过并留下决策记录。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import CollectionJob, DecisionLog, Source  # noqa: E402
from services import agent_orchestrator, collection_service  # noqa: E402


class TestIsCollectible:
    def test_manual_source_is_not_collectible(self):
        from types import SimpleNamespace

        assert collection_service.is_collectible(SimpleNamespace(base_url=None)) is False

    def test_supported_host_is_collectible(self):
        from types import SimpleNamespace

        assert collection_service.is_collectible(
            SimpleNamespace(base_url="https://www.gzhu.edu.cn/z__l/tzgg.htm")
        )
        assert collection_service.is_collectible(SimpleNamespace(base_url="https://news.gzhu.edu.cn"))

    def test_unsupported_host_is_not_collectible(self):
        from types import SimpleNamespace

        assert collection_service.is_collectible(SimpleNamespace(base_url="https://jwc.gzhu.edu.cn")) is False


class TestClosedLoopSkipsUncollectibleSources:
    async def test_only_collectible_sources_get_jobs(self, setup_test_db, monkeypatch):
        """一个激活的手动源 + 一个激活的未支持站点 + 一个激活的可采源 + 一个暂停的可采源。

        期望：只给"可采且激活"的那一个建任务（1 个），另外两个激活但不可采的被跳过，
        暂停的源根本不进入候选。
        """
        ran_jobs: list[str] = []

        async def _fake_run_collection(job_id: str) -> None:
            ran_jobs.append(job_id)
            async with database.AsyncSessionLocal() as db:
                job = await db.get(CollectionJob, job_id)
                if job:
                    job.status = "SUCCESS"
                    await db.commit()

        monkeypatch.setattr(collection_service, "run_collection", _fake_run_collection)

        async with database.AsyncSessionLocal() as db:
            manual = Source(name="手动源", source_type="manual", base_url=None, status="active")
            unsupported = Source(
                name="未支持站点",
                source_type="list_page",
                base_url="https://jwc.gzhu.edu.cn",
                status="active",
            )
            collectible = Source(
                name="通知公告",
                source_type="list_page",
                base_url="https://www.gzhu.edu.cn/z__l/tzgg.htm",
                status="active",
            )
            paused = Source(
                name="暂停源",
                source_type="list_page",
                base_url="https://news.gzhu.edu.cn",
                status="paused",
            )
            db.add_all([manual, unsupported, collectible, paused])
            await db.commit()
            collectible_id = collectible.id
            paused_id = paused.id

            sink = agent_orchestrator.EventSink(db, "run_collectible_test")
            result = await agent_orchestrator._stage_collection(
                db, {"collect": True, "max_pages": 1}, sink
            )

            from sqlalchemy import select

            jobs = (await db.execute(select(CollectionJob))).scalars().all()
            decisions = (await db.execute(select(DecisionLog))).scalars().all()

        assert len(jobs) == 1, [(j.source_id, j.status) for j in jobs]
        assert jobs[0].source_id == collectible_id
        assert jobs[0].source_id != paused_id
        assert len(ran_jobs) == 1
        assert result["jobs"] == 1
        assert any("跳过" in (d.decision or "") for d in decisions), [
            d.decision for d in decisions
        ]

    async def test_all_uncollectible_yields_no_jobs(self, setup_test_db, monkeypatch):
        async def _never_called(job_id: str) -> None:  # pragma: no cover - 不应被调用
            raise AssertionError("不应为不可采集的源建任务")

        monkeypatch.setattr(collection_service, "run_collection", _never_called)

        async with database.AsyncSessionLocal() as db:
            db.add(Source(name="手动源", source_type="manual", base_url=None, status="active"))
            await db.commit()

            sink = agent_orchestrator.EventSink(db, "run_none_collectible")
            result = await agent_orchestrator._stage_collection(
                db, {"collect": True, "max_pages": 1}, sink
            )

            from sqlalchemy import select

            jobs = (await db.execute(select(CollectionJob))).scalars().all()

        assert jobs == []
        assert result["jobs"] == 0
        assert result["status"] == "skipped"

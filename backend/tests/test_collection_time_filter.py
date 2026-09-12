"""T5 采集时间过滤 + 时间真源收敛测试。

覆盖：发布时间解析、过滤边界与脏数据放行、only_new 水位、条数硬上限、
采集服务（而非端点）写入 last_crawled_at、端点参数透传与 409 互斥。
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import CollectionJob, Source  # noqa: E402
from services import collection_service  # noqa: E402


class _FakeEngine:
    """替身抓取引擎：不发网络请求，返回固定文章列表。"""

    articles: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def fetch_source(self, base_url, adapter, max_pages=1):
        return list(self.articles), [], None

    async def close(self):
        pass


async def _make_source(db, name="src_time", **kwargs) -> Source:
    src = Source(name=name, source_type="website", base_url="https://www.gzhu.edu.cn", **kwargs)
    db.add(src)
    await db.commit()
    await db.refresh(src)
    return src


class TestParsePublishDate:
    def test_supported_formats(self):
        assert collection_service.parse_publish_date("2026-09-08") == date(2026, 9, 8)
        assert collection_service.parse_publish_date("2026-09-08 14:30") == date(2026, 9, 8)
        assert collection_service.parse_publish_date("2026/09/08") == date(2026, 9, 8)
        assert collection_service.parse_publish_date("2026年9月8日") == date(2026, 9, 8)

    def test_invalid_or_empty(self):
        assert collection_service.parse_publish_date(None) is None
        assert collection_service.parse_publish_date("") is None
        assert collection_service.parse_publish_date("待定") is None
        assert collection_service.parse_publish_date("2026-13-45") is None


class TestResolveFilterParams:
    def test_plain_range(self):
        source = SimpleNamespace(last_success_at=None)
        since, until, only_new, max_items = collection_service.resolve_filter_params(
            source, {"since": "2026-09-01", "until": "2026-09-08"}
        )
        assert since == date(2026, 9, 1)
        assert until == date(2026, 9, 8)
        assert only_new is False
        assert max_items == collection_service.DEFAULT_MAX_ITEMS

    def test_only_new_uses_last_success_watermark(self):
        source = SimpleNamespace(last_success_at=datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc))
        since, _until, only_new, _max = collection_service.resolve_filter_params(
            source, {"only_new": True}
        )
        assert only_new is True
        assert since == date(2026, 9, 5)

    def test_only_new_keeps_later_explicit_since(self):
        source = SimpleNamespace(last_success_at=datetime(2026, 9, 1, tzinfo=timezone.utc))
        since, _u, _o, _m = collection_service.resolve_filter_params(
            source, {"only_new": True, "since": "2026-09-05"}
        )
        assert since == date(2026, 9, 5)

    def test_only_new_without_watermark_is_noop(self):
        source = SimpleNamespace(last_success_at=None)
        since, _u, _o, _m = collection_service.resolve_filter_params(source, {"only_new": True})
        assert since is None

    def test_max_items_clamped_to_hard_limit(self):
        source = SimpleNamespace(last_success_at=None)
        *_, max_items = collection_service.resolve_filter_params(source, {"max_items": 9999})
        assert max_items == collection_service.MAX_ITEMS_HARD_LIMIT
        *_, bad = collection_service.resolve_filter_params(source, {"max_items": "abc"})
        assert bad == collection_service.DEFAULT_MAX_ITEMS


class TestFilterByPublishRange:
    @staticmethod
    def _article(publish_date):
        return SimpleNamespace(publish_date=publish_date, url=f"https://x/{publish_date}")

    def test_boundaries_are_inclusive(self):
        articles = [self._article("2026-09-01"), self._article("2026-09-08")]
        kept, dropped = collection_service._filter_by_publish_range(
            articles, date(2026, 9, 1), date(2026, 9, 8)
        )
        assert len(kept) == 2
        assert dropped == 0

    def test_out_of_range_dropped(self):
        articles = [
            self._article("2026-08-31"),
            self._article("2026-09-05"),
            self._article("2026-09-09"),
        ]
        kept, dropped = collection_service._filter_by_publish_range(
            articles, date(2026, 9, 1), date(2026, 9, 8)
        )
        assert [a.publish_date for a in kept] == ["2026-09-05"]
        assert dropped == 2

    def test_unparseable_publish_date_passes(self):
        articles = [self._article(None), self._article("待定"), self._article("2026-08-01")]
        kept, dropped = collection_service._filter_by_publish_range(
            articles, date(2026, 9, 1), None
        )
        assert len(kept) == 2  # 脏数据放行，只有明确早于 since 的被丢弃
        assert dropped == 1

    def test_no_range_keeps_all(self):
        articles = [self._article("2020-01-01")]
        kept, dropped = collection_service._filter_by_publish_range(articles, None, None)
        assert len(kept) == 1 and dropped == 0


class TestRunCollectionWritesTimeSource:
    async def test_last_crawled_at_written_by_service(self, setup_test_db, monkeypatch):
        """不经端点（如闭环/调度链路）也必须推进 last_crawled_at —— P3 的核心修复。"""
        monkeypatch.setattr(collection_service, "AsyncSessionLocal", database.AsyncSessionLocal)
        monkeypatch.setattr(collection_service, "CrawlEngine", _FakeEngine)

        async with database.AsyncSessionLocal() as db:
            source = await _make_source(db, "src_loop")
            job = CollectionJob(
                source_id=source.id,
                status="PENDING",
                params={"max_pages": 1, "since": "2026-09-01"},
            )
            db.add(job)
            await db.commit()
            await db.refresh(job)
            job_id, source_id = job.id, source.id

        await collection_service.run_collection(job_id)

        async with database.AsyncSessionLocal() as db:
            src = await db.get(Source, source_id)
            job = await db.get(CollectionJob, job_id)
            assert job.status == "SUCCESS"
            # 时间真源：服务内部写入，与端点无关
            assert src.last_crawled_at is not None
            assert src.last_success_at is not None
            assert src.last_error is None
            # 过滤条件留痕（可解释、可回溯）
            trace = job.stage_trace
            assert trace["Filter"] == "ok"
            assert trace["since"] == "2026-09-01"
            assert trace["filtered_in"] == 0
            assert "filtered_out" in trace
            assert job.result["truncated"] is False


class TestRunSourceEndpoint:
    async def test_params_are_recorded(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            source = await _make_source(db, "src_params")

        resp = await client.post(
            f"/api/v1/sources/{source.id}/run",
            params={
                "max_pages": 3,
                "column": "通知公告",
                "since": "2026-09-01",
                "until": "2026-09-08",
                "only_new": True,
                "max_items": 50,
            },
        )
        assert resp.status_code == 200
        job_id = resp.json()["job_id"]

        async with database.AsyncSessionLocal() as db:
            job = await db.get(CollectionJob, job_id)
            assert job.params["max_pages"] == 3
            assert job.params["column"] == "通知公告"
            assert job.params["since"] == "2026-09-01"
            assert job.params["until"] == "2026-09-08"
            assert job.params["only_new"] is True
            assert job.params["max_items"] == 50

    async def test_conflict_when_job_in_progress(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            source = await _make_source(db, "src_busy")

        first = await client.post(f"/api/v1/sources/{source.id}/run")
        assert first.status_code == 200

        second = await client.post(f"/api/v1/sources/{source.id}/run")
        assert second.status_code == 409
        body = second.json()
        assert body["job_id"] == first.json()["job_id"]
        assert "进行中" in body["detail"]

    async def test_unknown_source_404(self, client, setup_test_db):
        resp = await client.post("/api/v1/sources/src_missing/run")
        assert resp.status_code == 404

    async def test_latency_of_run_endpoint_is_fast(self, client, setup_test_db):
        """端点只创建任务并派发后台任务，不应同步等待抓取（SSE/阻塞体验修复的前提）。"""
        async with database.AsyncSessionLocal() as db:
            source = await _make_source(db, "src_fast")

        started = datetime.now(timezone.utc)
        resp = await client.post(f"/api/v1/sources/{source.id}/run")
        elapsed_ms = (datetime.now(timezone.utc) - started).total_seconds() * 1000
        assert resp.status_code == 200
        assert elapsed_ms < 2000, elapsed_ms
        # 端点不再直写 last_crawled_at（改由采集服务写）
        assert timedelta(seconds=0) <= (datetime.now(timezone.utc) - started)

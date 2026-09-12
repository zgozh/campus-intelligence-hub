"""T7 数据源监控快照测试：语义修正（last_success_at/last_error/refreshed_at）+ 消除 N+1。

对应用户实测缺陷：「刷新监控」后"最近采集时间"仍是旧值——根因是展示字段取自
`Source.last_crawled_at`（只在手动端点任务开始前写入），而非"最近成功采集时间"。
"""
import os
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import event

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import RawDocument, Source  # noqa: E402
from services.source_monitor import monitor_sources  # noqa: E402


async def _make_source(db, name: str, **kwargs) -> Source:
    src = Source(name=name, source_type="website", base_url=f"https://{name}.example.edu.cn", **kwargs)
    db.add(src)
    await db.flush()
    return src


async def _make_doc(db, source_id: str, title: str, created_at: datetime, column: str | None = None):
    db.add(
        RawDocument(
            source_id=source_id,
            url=f"https://x.example.edu.cn/{title}",
            normalized_url=f"https://x.example.edu.cn/{title}",
            title=title,
            content="正文",
            content_hash=f"hash_{title}",
            created_at=created_at,
            column=column,
        )
    )


class TestMonitorSnapshot:
    async def test_fields_and_semantics(self, setup_test_db):
        now = datetime.now(timezone.utc)
        async with database.AsyncSessionLocal() as db:
            success_src = await _make_source(
                db,
                "src_success",
                last_crawled_at=now - timedelta(hours=2),
                last_success_at=now - timedelta(hours=1),
            )
            error_src = await _make_source(
                db,
                "src_error",
                last_crawled_at=now - timedelta(hours=3),
                last_error="站点 503",
            )
            await _make_doc(db, success_src.id, "新公告一", now - timedelta(days=1))
            await _make_doc(db, success_src.id, "新公告二", now - timedelta(days=2))
            await _make_doc(db, success_src.id, "旧公告", now - timedelta(days=30))
            await db.commit()

        async with database.AsyncSessionLocal() as db:
            snapshot = await monitor_sources(db, recent_days=7)

        assert snapshot["recent_days"] == 7
        assert snapshot["sources"] == 2
        assert snapshot["total_new"] == 2
        # ★ 快照时间必须存在且带时区，供前端"已更新"反馈
        assert snapshot["refreshed_at"] and snapshot["refreshed_at"].endswith("+00:00")

        by_id = {i["source_id"]: i for i in snapshot["items"]}
        success = by_id[success_src.id]
        # ★ 主字段是"最近成功"，且与"最近尝试"分开表达
        assert success["last_success_at"] and success["last_success_at"].endswith("+00:00")
        assert success["last_crawled_at"] and success["last_crawled_at"].endswith("+00:00")
        assert success["last_success_at"] > success["last_crawled_at"]
        assert success["last_error"] is None
        assert success["new_count"] == 2
        assert "旧公告" not in success["recent_titles"]
        assert set(success["recent_titles"]) == {"新公告一", "新公告二"}

        failed = by_id[error_src.id]
        assert failed["last_error"] == "站点 503"
        assert failed["last_success_at"] is None
        assert failed["new_count"] == 0

    async def test_title_limit_per_source(self, setup_test_db):
        now = datetime.now(timezone.utc)
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_many")
            for i in range(8):
                await _make_doc(db, src.id, f"公告{i}", now - timedelta(hours=i))
            await db.commit()

        async with database.AsyncSessionLocal() as db:
            snapshot = await monitor_sources(db)

        assert snapshot["items"][0]["new_count"] == 8
        assert len(snapshot["items"][0]["recent_titles"]) == 5

    async def test_query_count_does_not_grow_with_sources(self, setup_test_db):
        """消除 N+1：源数量增加不应线性增加 SQL 语句数。"""
        now = datetime.now(timezone.utc)

        async def build(n: int, prefix: str):
            async with database.AsyncSessionLocal() as db:
                for i in range(n):
                    src = await _make_source(db, f"{prefix}_{i}")
                    await _make_doc(db, src.id, f"{prefix}_doc_{i}", now - timedelta(days=1))
                await db.commit()

        async def count_queries() -> int:
            counter = {"n": 0}

            def _before(conn, cursor, statement, parameters, context, executemany):
                counter["n"] += 1

            sync_engine = database.engine.sync_engine
            event.listen(sync_engine, "before_cursor_execute", _before)
            try:
                async with database.AsyncSessionLocal() as db:
                    await monitor_sources(db)
            finally:
                event.remove(sync_engine, "before_cursor_execute", _before)
            return counter["n"]

        await build(1, "one")
        one_source = await count_queries()
        await build(4, "more")
        many_sources = await count_queries()

        assert many_sources <= one_source + 1, (one_source, many_sources)

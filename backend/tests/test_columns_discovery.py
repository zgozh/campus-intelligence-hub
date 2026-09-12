"""T6 栏目动态发现测试：适配器栏目推导 + 分布统计 + 缓存 + 端点。

对应用户实测缺陷：采集面板「采集内容筛选（栏目）」只有"全部内容"，没有其它类型可选。
根因是栏目写死在适配器里（每源只能产出一个值）+ 前端硬编码常量，两者与真实数据不对齐。
"""
import os
import sys
from datetime import datetime, timezone

from sqlalchemy import event

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from collectors.base import ArticleRef, SiteAdapter  # noqa: E402
from collectors.gzhu import GUZhuAdapter  # noqa: E402
from collectors.gznews import GUNewsAdapter  # noqa: E402
from models import RawDocument, Source  # noqa: E402
from services import column_discovery_service as cds  # noqa: E402


class TestAdapterColumnDerivation:
    def test_declared_column_matches_path(self):
        adapter = GUZhuAdapter()
        html = "<html><head><title>广州大学</title></head><body></body></html>"
        assert adapter.column_for_list_page(html, "https://www.gzhu.edu.cn/z__l/tzgg.htm") == "通知公告"

    def test_current_nav_wins_over_title(self):
        adapter = GUZhuAdapter()
        html = (
            "<html><body>"
            "<div class='nav'><li class='on'><a href='/x'>招标采购</a></li></div>"
            "</body></html>"
        )
        assert adapter.column_for_list_page(html, "https://www.gzhu.edu.cn/z__l/other.htm") == "招标采购"

    def test_title_with_separator_is_used(self):
        adapter = GUZhuAdapter()
        html = "<html><head><title>学术活动-广州大学</title></head><body></body></html>"
        assert adapter.column_for_list_page(html, "https://www.gzhu.edu.cn/z__l/x.htm") == "学术活动"

    def test_bare_site_name_falls_back_to_default(self):
        """避免把站点名当栏目（无分隔符 → 回退默认值）。"""
        adapter = GUZhuAdapter()
        html = "<html><head><title>广州大学</title></head><body></body></html>"
        assert adapter.column_for_list_page(html, "https://www.gzhu.edu.cn/z__l/x.htm") == "通知公告"

    def test_gznews_default_preserved(self):
        adapter = GUNewsAdapter()
        html = "<html><head><title>广州大学新闻网</title></head><body></body></html>"
        assert adapter.column_for_list_page(html, "https://news.gzhu.edu.cn/") == "新闻动态"

    def test_declared_column_names_deduped(self):
        names = GUZhuAdapter().declared_column_names()
        assert names[0] == "通知公告"
        assert len(names) == len(set(names))

    def test_parse_list_stamps_column_and_detail_reuses_it(self):
        adapter = GUZhuAdapter()
        list_html = (
            "<html><head><title>通知公告-广州大学</title></head><body><ul>"
            "<li><a href='/info/1001.htm' title='公告一'>公告一</a><span>2026-09-08</span></li>"
            "</ul></body></html>"
        )
        refs = adapter.parse_list(list_html, "https://www.gzhu.edu.cn/z__l/tzgg.htm")
        assert len(refs) == 1
        assert refs[0].column == "通知公告"

        detail = adapter.parse_detail(
            "<html><body><h1>公告一</h1><p class='date'>2026-09-08</p></body></html>", refs[0]
        )
        assert detail.column == "通知公告"

    def test_parse_detail_uses_ref_column_even_if_unusual(self):
        """栏目来源唯一：详情页不再覆盖列表页推导结果（保证筛选语义同源）。"""
        adapter = GUZhuAdapter()
        ref = ArticleRef(url="https://x/info/1.htm", title="t", publish_date="2026-09-08", column="招标采购")
        detail = adapter.parse_detail("<html><body><h1>t</h1></body></html>", ref)
        assert detail.column == "招标采购"

    def test_base_adapter_defaults(self):
        class _Bare(SiteAdapter):
            pass

        adapter = _Bare()
        assert adapter.column_for_list_page("", "https://x/") == "综合"


async def _make_source(db, name="src_col", base_url="https://www.gzhu.edu.cn"):
    src = Source(name=name, source_type="website", base_url=base_url)
    db.add(src)
    await db.commit()
    await db.refresh(src)
    return src


async def _make_doc(db, source_id: str, column: str | None, n: int = 1):
    for i in range(n):
        db.add(
            RawDocument(
                source_id=source_id,
                url=f"https://x/{column}/{i}",
                normalized_url=f"https://x/{column}/{i}",
                title=f"{column}-{i}",
                content="正文",
                content_hash=f"h_{column}_{i}",
                column=column,
                created_at=datetime.now(timezone.utc),
            )
        )


class TestDiscoverColumns:
    async def test_history_distribution_with_counts(self, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_hist")
            await _make_doc(db, src.id, "通知公告", n=3)
            await _make_doc(db, src.id, "招标采购", n=2)
            await _make_doc(db, src.id, None, n=1)
            await db.commit()

        async with database.AsyncSessionLocal() as db:
            src = await db.get(Source, src.id)
            payload = await cds.discover_columns(db, src)

        by_value = {c["value"]: c for c in payload["columns"]}
        assert by_value["通知公告"]["count"] == 3
        assert by_value["通知公告"]["origin"] == "history"
        assert by_value["通知公告"]["label"] == "通知公告 (3)"
        assert by_value["招标采购"]["count"] == 2
        assert None not in by_value and "" not in by_value  # NULL 不入结果
        assert payload["cached"] is False
        assert payload["generated_at"].endswith("+00:00")

    async def test_adapter_declared_columns_included_with_zero_count(self, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_adapter")
            await _make_doc(db, src.id, "招标采购", n=1)
            await db.commit()

        async with database.AsyncSessionLocal() as db:
            src = await db.get(Source, src.id)
            payload = await cds.discover_columns(db, src)

        values = {c["value"]: c for c in payload["columns"]}
        # 适配器声明的"通知公告"即使历史没有也要可选（用户可主动切换）
        assert values["通知公告"]["count"] == 0
        assert values["通知公告"]["origin"] == "adapter"
        assert values["招标采购"]["origin"] == "history"

    async def test_unknown_source_type_still_returns_default_column(self, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_unknown", base_url="https://other.example.com")
            await db.commit()

        async with database.AsyncSessionLocal() as db:
            src = await db.get(Source, src.id)
            payload = await cds.discover_columns(db, src)
        # 无适配器：不报错，返回空清单（前端回退"全部内容"）
        assert payload["columns"] == []

    async def test_cache_hit_avoids_second_query(self, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_cache")
            await _make_doc(db, src.id, "通知公告", n=1)
            await db.commit()
            src_id = src.id

        async with database.AsyncSessionLocal() as db:
            src = await db.get(Source, src_id)
            await cds.discover_columns(db, src)

        counter = {"n": 0}

        def _before(conn, cursor, statement, parameters, context, executemany):
            if "raw_documents" in statement.lower():
                counter["n"] += 1

        sync_engine = database.engine.sync_engine
        event.listen(sync_engine, "before_cursor_execute", _before)
        try:
            async with database.AsyncSessionLocal() as db:
                src = await db.get(Source, src_id)
                second = await cds.discover_columns(db, src)
        finally:
            event.remove(sync_engine, "before_cursor_execute", _before)

        assert second["cached"] is True
        assert counter["n"] == 0  # 命中缓存不再查库

    async def test_invalidate_forces_refresh(self, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_invalidate")
            await _make_doc(db, src.id, "通知公告", n=1)
            await db.commit()

        async with database.AsyncSessionLocal() as db:
            src = await db.get(Source, src.id)
            first = await cds.discover_columns(db, src)
            assert first["cached"] is False
            cds.invalidate(src.id)
            after = await cds.discover_columns(db, src)
            assert after["cached"] is False

    async def test_refresh_flag_bypasses_cache(self, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_refresh")
            await db.commit()

        async with database.AsyncSessionLocal() as db:
            src = await db.get(Source, src.id)
            await cds.discover_columns(db, src)
            forced = await cds.discover_columns(db, src, refresh=True)
        assert forced["cached"] is False


class TestColumnsEndpoint:
    async def test_endpoint_returns_columns(self, client, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_ep")
            await _make_doc(db, src.id, "通知公告", n=2)
            await db.commit()
            src_id = src.id

        resp = await client.get(f"/api/v1/sources/{src_id}/columns")
        assert resp.status_code == 200
        body = resp.json()
        assert body["source_id"] == src_id
        values = [c["value"] for c in body["columns"]]
        assert "通知公告" in values

    async def test_endpoint_unknown_source_404(self, client, setup_test_db):
        resp = await client.get("/api/v1/sources/src_missing/columns")
        assert resp.status_code == 404

    async def test_endpoint_requires_auth(self, public_client, setup_test_db):
        resp = await public_client.get("/api/v1/sources/src_x/columns")
        assert resp.status_code in (401, 403)

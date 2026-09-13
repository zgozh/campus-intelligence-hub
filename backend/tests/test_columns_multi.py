"""B2 跨源栏目并集测试。

背景：闭环/采集面板可多选数据源，但原接口以单源为路径参数，多选后拿不到栏目。
同时验证一个易踩的路由陷阱：`/sources/columns` 若注册在 `/sources/{source_id}` 之后，
会被动态路径吃掉（返回 404 数据源不存在）。
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import RawDocument, Source  # noqa: E402
from services import column_discovery_service as cds  # noqa: E402


async def _make_source(db, name: str, base_url: str = "https://www.gzhu.edu.cn") -> Source:
    source = Source(name=name, source_type="website", base_url=base_url)
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return source


async def _make_doc(db, source_id: str, column: str | None, n: int = 1):
    for i in range(n):
        db.add(
            RawDocument(
                source_id=source_id,
                url=f"https://x/{column}/{i}",
                normalized_url=f"https://x/{column}/{i}",
                title=f"{column}-{i}",
                content="正文",
                content_hash=f"h_{source_id}_{column}_{i}",
                column=column,
                created_at=datetime.now(timezone.utc),
            )
        )


class TestDiscoverColumnsMulti:
    async def test_merges_counts_and_reports_per_source(self, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src_a = await _make_source(db, "src_a")
            src_b = await _make_source(db, "src_b")
            await _make_doc(db, src_a.id, "通知公告", n=3)
            await _make_doc(db, src_a.id, "招标采购", n=1)
            await _make_doc(db, src_b.id, "通知公告", n=2)
            await db.commit()
            ids = [src_a.id, src_b.id]

        async with database.AsyncSessionLocal() as db:
            payload = await cds.discover_columns_multi(db, ids)

        by_value = {c["value"]: c for c in payload["columns"]}
        # 同名栏目合并计数
        assert by_value["通知公告"]["count"] == 5
        assert by_value["通知公告"]["origin"] == "history"
        # 每源分布可见
        dist = {item["source_id"]: item["count"] for item in by_value["通知公告"]["sources"]}
        assert dist == {src_a.id: 3, src_b.id: 2}
        assert by_value["招标采购"]["count"] == 1
        assert payload["source_count"] == 2
        assert set(payload["source_ids"]) == set(ids)
        # 排序：计数倒序
        assert payload["columns"][0]["value"] == "通知公告"

    async def test_adapter_declared_columns_fill_zero_entries(self, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_declared")
            await _make_doc(db, src.id, "招标采购", n=1)
            await db.commit()
            ids = [src.id]

        async with database.AsyncSessionLocal() as db:
            payload = await cds.discover_columns_multi(db, ids)

        values = {c["value"]: c for c in payload["columns"]}
        # 适配器声明但历史没有的栏目：作为候选给出（count=0）
        assert values["通知公告"]["count"] == 0
        assert values["通知公告"]["origin"] == "adapter"
        assert values["招标采购"]["origin"] == "history"

    async def test_empty_source_ids_means_all_active(self, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_all_active")
            await _make_doc(db, src.id, "通知公告", n=1)
            await db.commit()
            src_id = src.id

        async with database.AsyncSessionLocal() as db:
            payload = await cds.discover_columns_multi(db, None)

        assert payload["source_count"] >= 1
        assert src_id in payload["source_ids"]

    async def test_unknown_ids_yield_empty_but_valid_payload(self, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            payload = await cds.discover_columns_multi(db, ["src_missing"])
        assert payload["columns"] == []
        assert payload["source_count"] == 0

    async def test_cache_hit_and_invalidate(self, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_multi_cache")
            await _make_doc(db, src.id, "通知公告", n=1)
            await db.commit()
            ids = [src.id]

        async with database.AsyncSessionLocal() as db:
            first = await cds.discover_columns_multi(db, ids)
            assert first["cached"] is False
            second = await cds.discover_columns_multi(db, ids)
            assert second["cached"] is True
            # 采集完成会让该源相关缓存失效（含跨源并集）
            cds.invalidate(src.id)
            third = await cds.discover_columns_multi(db, ids)
            assert third["cached"] is False


class TestCrossSourceColumnsEndpoint:
    async def test_route_not_shadowed_by_dynamic_source_id(self, client, setup_test_db):
        """★ 路由护栏：`/sources/columns` 必须命中并集接口，而不是被 `/sources/{source_id}` 吃掉。"""
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_route")
            await _make_doc(db, src.id, "通知公告", n=2)
            await db.commit()
            src_id = src.id

        resp = await client.get("/api/v1/sources/columns", params={"source_ids": src_id})
        assert resp.status_code == 200
        body = resp.json()
        assert "columns" in body  # 不是 {"detail": "数据源不存在"}
        assert body["source_count"] == 1

    async def test_endpoint_returns_union_for_multiple_sources(self, client, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            a = await _make_source(db, "src_ep_a")
            b = await _make_source(db, "src_ep_b")
            await _make_doc(db, a.id, "通知公告", n=2)
            await _make_doc(db, b.id, "教育教学", n=1)
            await db.commit()
            ids = f"{a.id},{b.id}"

        resp = await client.get("/api/v1/sources/columns", params={"source_ids": ids})
        assert resp.status_code == 200
        values = {c["value"]: c["count"] for c in resp.json()["columns"]}
        assert values.get("通知公告") == 2
        assert values.get("教育教学") == 1

    async def test_endpoint_supports_refresh(self, client, setup_test_db):
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_ep_refresh")
            await db.commit()
            src_id = src.id

        await client.get("/api/v1/sources/columns", params={"source_ids": src_id})
        resp = await client.get(
            "/api/v1/sources/columns", params={"source_ids": src_id, "refresh": "true"}
        )
        assert resp.status_code == 200
        assert resp.json()["cached"] is False

    async def test_single_source_endpoint_still_works(self, client, setup_test_db):
        """既有单源接口行为不回归（硬约束：只增不改）。"""
        cds.clear_cache()
        async with database.AsyncSessionLocal() as db:
            src = await _make_source(db, "src_ep_single")
            await _make_doc(db, src.id, "通知公告", n=1)
            await db.commit()
            src_id = src.id

        resp = await client.get(f"/api/v1/sources/{src_id}/columns")
        assert resp.status_code == 200
        assert resp.json()["source_id"] == src_id

    async def test_requires_auth(self, public_client, setup_test_db):
        resp = await public_client.get("/api/v1/sources/columns")
        assert resp.status_code in (401, 403)

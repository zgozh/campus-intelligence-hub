"""T8 通知服务测试：link 透传、kind 过滤、全部已读幂等、异常路径。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import Notification  # noqa: E402
from services.notify_service import create_notification, push_notification  # noqa: E402


class TestNotificationModel:
    async def test_push_notification_persists_link(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            n = await push_notification(
                db, "insight", "校务知识洞察", "正文", link="/insights"
            )
            assert n.link == "/insights"
            assert n.read is False
            assert n.kind == "insight"

    async def test_link_defaults_to_none_for_existing_callers(self, setup_test_db):
        """既有调用方不传 link 也必须照常工作（向后兼容）。"""
        async with database.AsyncSessionLocal() as db:
            n = await create_notification(db, "system", "系统消息", "内容")
            await db.commit()
            assert n.link is None


class TestNotificationEndpoints:
    async def test_list_includes_link_and_kind_filter(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            await push_notification(db, "brief", "校务快讯", "正文", link="/sources")
            await push_notification(db, "insight", "校务洞察", "正文", link="/insights")

        resp = await client.get("/api/v1/notifications")
        assert resp.status_code == 200
        items = resp.json()["notifications"]
        assert {i["kind"] for i in items} >= {"brief", "insight"}
        assert any(i["link"] == "/sources" for i in items)

        filtered = await client.get("/api/v1/notifications", params={"kind": "brief"})
        assert filtered.status_code == 200
        kinds = {i["kind"] for i in filtered.json()["notifications"]}
        assert kinds == {"brief"}

    async def test_unread_only_filter(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            read_one = await push_notification(db, "system", "已读通知", "x")
            read_one.read = True
            await db.commit()
            await push_notification(db, "system", "未读通知", "y")

        resp = await client.get("/api/v1/notifications", params={"unread_only": True})
        assert resp.status_code == 200
        titles = [i["title"] for i in resp.json()["notifications"]]
        assert "未读通知" in titles
        assert "已读通知" not in titles

    async def test_read_all_is_idempotent(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            await push_notification(db, "system", "n1", "x")
            await push_notification(db, "system", "n2", "y")

        first = await client.post("/api/v1/notifications/read-all")
        assert first.status_code == 200
        assert first.json()["updated"] == 2

        second = await client.post("/api/v1/notifications/read-all")
        assert second.status_code == 200
        assert second.json()["updated"] == 0

        count = await client.get("/api/v1/notifications/unread-count")
        assert count.json()["unread"] == 0

    async def test_mark_read_and_missing_id(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            n = await push_notification(db, "system", "待读", "x")
            nid = n.id

        ok = await client.post(f"/api/v1/notifications/{nid}/read")
        assert ok.status_code == 200
        assert ok.json()["read"] is True

        missing = await client.post("/api/v1/notifications/ntf_missing/read")
        assert missing.status_code == 404

    async def test_notifications_require_auth(self, public_client):
        resp = await public_client.get("/api/v1/notifications")
        assert resp.status_code in (401, 403)

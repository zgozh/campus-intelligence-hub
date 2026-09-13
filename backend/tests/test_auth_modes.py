"""C1 鉴权两档开关测试：DEMO_RELAX_AUTH（演示放开 / 生产收紧）。

背景：`register` 在已有管理员时仍可注册普通管理员、`require_super_admin` 放行所有已登录账号，
是"展示项目"有意放开的（原代码注释即如此），但对外部署是真实风险。
本轮开关化：默认仍是演示模式（保证开箱即用），生产置 `DEMO_RELAX_AUTH=false` 收紧。
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import settings  # noqa: E402


class TestRequireSuperAdmin:
    """权限校验函数级测试（不依赖 HTTP 栈）。"""

    def test_demo_mode_allows_any_logged_in_role(self, monkeypatch):
        from api.endpoints.auth import require_super_admin

        monkeypatch.setattr(settings, "demo_relax_auth", True, raising=False)
        for role in ("super_admin", "admin", "support"):
            admin = type("A", (), {"role": role})()
            assert require_super_admin(admin) is admin

    def test_production_mode_blocks_non_super_admin(self, monkeypatch):
        from fastapi import HTTPException

        from api.endpoints.auth import require_super_admin

        monkeypatch.setattr(settings, "demo_relax_auth", False, raising=False)
        for role in ("admin", "support"):
            admin = type("A", (), {"role": role})()
            with pytest.raises(HTTPException) as exc:
                require_super_admin(admin)
            assert exc.value.status_code == 403

        super_admin = type("A", (), {"role": "super_admin"})()
        assert require_super_admin(super_admin) is super_admin


class TestRegisterMode:
    """端到端：第二次注册在两种模式下的行为。"""

    async def test_demo_mode_second_register_creates_admin(self, public_client, setup_test_db, monkeypatch):
        monkeypatch.setattr(settings, "demo_relax_auth", True, raising=False)
        first = await public_client.post(
            "/api/admin/register",
            json={"email": "c1_first@example.com", "password": "testpassword123", "name": "First"},
        )
        assert first.status_code == 200
        second = await public_client.post(
            "/api/admin/register",
            json={"email": "c1_second@example.com", "password": "testpassword123", "name": "Second"},
        )
        assert second.status_code == 200  # 演示模式：放行（原行为）

    async def test_production_mode_second_register_forbidden(self, public_client, setup_test_db, monkeypatch):
        monkeypatch.setattr(settings, "demo_relax_auth", False, raising=False)
        first = await public_client.post(
            "/api/admin/register",
            json={"email": "c1_prod_first@example.com", "password": "testpassword123", "name": "First"},
        )
        # 首个管理员（bootstrap）永远允许
        assert first.status_code == 200

        second = await public_client.post(
            "/api/admin/register",
            json={"email": "c1_prod_second@example.com", "password": "testpassword123", "name": "Second"},
        )
        assert second.status_code == 403
        assert "注册已关闭" in second.json()["detail"]

    async def test_default_mode_is_demo(self):
        """默认必须是演示模式：不影响"开箱即用、无 Key 可演示"的目标。"""
        assert settings.demo_relax_auth is True

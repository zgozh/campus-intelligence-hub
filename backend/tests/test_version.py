"""A2 构建版本可见性测试：GET /api/v1/version（公开只读、最小信息、与 APP_BUILD 同源）。

背景：本项目出现过"容器里是新代码、全新页面验证通过，但用户已打开的标签页跑旧 bundle"的
三方矛盾。版本标识可见后，前端与真机探针都能确认"跑的是哪个构建"。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.version_service import get_version_info  # noqa: E402


class TestVersionService:
    def test_reads_app_build_from_env(self, monkeypatch):
        monkeypatch.setenv("APP_BUILD", "abc123-20260913-010203")
        monkeypatch.setenv("APP_VERSION", "2.2.0")
        monkeypatch.setenv("APP_ENVIRONMENT", "production")
        info = get_version_info()
        assert info["build"] == "abc123-20260913-010203"
        assert info["version"] == "2.2.0"
        assert info["environment"] == "production"
        assert info["name"] == "campus-intelligence-hub"

    def test_falls_back_to_unknown_when_env_missing(self, monkeypatch):
        monkeypatch.delenv("APP_BUILD", raising=False)
        monkeypatch.delenv("GIT_COMMIT", raising=False)
        info = get_version_info()
        assert info["build"] == "unknown"
        assert info["commit"] == "unknown"
        assert info["version"]  # 版本号必须有默认值

    def test_does_not_leak_sensitive_config(self, monkeypatch):
        monkeypatch.setenv("APP_BUILD", "b1")
        info = get_version_info()
        # 只允许这四个字段 + name：防止未来误把配置/密钥塞进公开接口
        assert set(info) == {"name", "version", "build", "commit", "environment"}


class TestVersionEndpoint:
    async def test_public_access_without_auth(self, public_client, setup_test_db):
        resp = await public_client.get("/api/v1/version")
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "campus-intelligence-hub"
        assert "build" in body and "version" in body

    async def test_same_build_id_via_authenticated_client(self, client, setup_test_db, monkeypatch):
        monkeypatch.setenv("APP_BUILD", "test-build-xyz")
        resp = await client.get("/api/v1/version")
        assert resp.status_code == 200
        assert resp.json()["build"] == "test-build-xyz"

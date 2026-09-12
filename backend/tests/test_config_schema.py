"""T3 配置 Schema 测试：结构快照 + 入参校验 + 端点。

契约见 REFACTOR_PLAN_V2 §5.1（字段名与默认值为冻结契约，防治前后端硬编码漂移）。
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import config_schema_service as css  # noqa: E402


class TestSchemaSnapshot:
    """Schema 结构快照：字段/默认值/范围一旦漂移立即失败。"""

    def test_closed_loop_groups_and_fields(self):
        schema = css.get_schema("closed_loop")
        assert schema["name"] == "closed_loop"
        assert [g["key"] for g in schema["groups"]] == ["collect", "govern", "operate"]

        collect = {f["key"]: f for f in schema["groups"][0]["fields"]}
        assert set(collect) == {
            "collect",
            "source_ids",
            "max_pages",
            "column",
            "since",
            "until",
            "only_new",
        }
        assert collect["collect"]["default"] is False
        assert collect["max_pages"]["default"] == 1
        assert (collect["max_pages"]["min"], collect["max_pages"]["max"]) == (1, 5)
        assert collect["column"]["default"] is None
        assert collect["source_ids"]["type"] == "multi_select"
        # 采集子项必须挂在 collect=true 下联动显示
        for key in ("source_ids", "max_pages", "column", "since", "until", "only_new"):
            assert collect[key]["visible_if"] == {"collect": True}

        govern = {f["key"]: f for f in schema["groups"][1]["fields"]}
        assert govern["refresh_freshness"]["default"] is True
        assert govern["rebuild_kg"]["default"] is False

        operate = {f["key"]: f for f in schema["groups"][2]["fields"]}
        assert operate["health_threshold"]["default"] == 60
        assert (operate["health_threshold"]["min"], operate["health_threshold"]["max"]) == (0, 100)

    def test_collection_schema_has_max_items(self):
        schema = css.get_schema("collection")
        fields = {f["key"]: f for f in schema["groups"][0]["fields"]}
        assert fields["max_items"]["default"] == 200
        assert fields["max_items"]["max"] == 500

    def test_get_schema_returns_copy(self):
        schema = css.get_schema("collection")
        schema["groups"][0]["fields"][0]["default"] = 999
        assert css.get_schema("collection")["groups"][0]["fields"][0]["default"] == 1

    def test_unknown_schema_raises_key_error(self):
        with pytest.raises(KeyError):
            css.get_schema("nope")


class TestValidateConfig:
    """入参校验与归一化。"""

    def test_fills_defaults_for_missing_and_null(self):
        config = css.validate_config("closed_loop", {"collect": True, "column": None})
        assert config["collect"] is True
        assert config["column"] is None
        assert config["max_pages"] == 1
        assert config["source_ids"] == []
        assert config["refresh_freshness"] is True
        assert config["health_threshold"] == 60
        # 完整配置：字段数与 Schema 一致（保证运行快照可复现）
        assert set(config) == {
            "collect",
            "source_ids",
            "max_pages",
            "column",
            "since",
            "until",
            "only_new",
            "refresh_freshness",
            "detect_conflicts",
            "rebuild_kg",
            "archive_expired",
            "gen_digest",
            "gen_insight",
            "push_notifications",
            "health_threshold",
        }

    def test_none_payload_is_all_defaults(self):
        config = css.validate_config("closed_loop", None)
        assert config["collect"] is False
        assert config["max_pages"] == 1

    def test_ignores_unknown_fields(self):
        config = css.validate_config("collection", {"max_pages": 3, "evil": "x"})
        assert config["max_pages"] == 3
        assert "evil" not in config

    def test_int_out_of_range(self):
        with pytest.raises(ValueError, match="max_pages: 不得大于 5"):
            css.validate_config("collection", {"max_pages": 6})
        with pytest.raises(ValueError, match="max_pages: 不得小于 1"):
            css.validate_config("collection", {"max_pages": 0})
        with pytest.raises(ValueError, match="health_threshold: 不得大于 100"):
            css.validate_config("closed_loop", {"health_threshold": 101})

    def test_int_type_strictness(self):
        with pytest.raises(ValueError, match="max_pages: 应为整数"):
            css.validate_config("collection", {"max_pages": "3"})
        # bool 是 int 子类，必须被拒绝
        with pytest.raises(ValueError, match="max_pages: 应为整数"):
            css.validate_config("collection", {"max_pages": True})

    def test_boolean_type_strictness(self):
        with pytest.raises(ValueError, match="collect: 应为布尔值"):
            css.validate_config("closed_loop", {"collect": "true"})

    def test_multi_select_type(self):
        assert css.validate_config("closed_loop", {"source_ids": ["src_1"]})["source_ids"] == ["src_1"]
        with pytest.raises(ValueError, match="source_ids: 应为字符串数组"):
            css.validate_config("closed_loop", {"source_ids": "src_1"})

    def test_date_format(self):
        config = css.validate_config("collection", {"since": "2026-09-01", "until": "2026-09-08"})
        assert config["since"] == "2026-09-01"
        with pytest.raises(ValueError, match="since: 日期格式应为 YYYY-MM-DD"):
            css.validate_config("collection", {"since": "2026/09/01"})

    def test_until_before_since_rejected(self):
        with pytest.raises(ValueError, match="until: 不得早于 since"):
            css.validate_config(
                "collection", {"since": "2026-09-08", "until": "2026-09-01"}
            )


class TestConfigSchemaEndpoint:
    """端点契约：GET /api/v1/config-schema/{name}。"""

    async def test_get_closed_loop_schema(self, client):
        # 契约 URL 用连字符，内部键用下划线，两者都必须可用
        for name in ("closed-loop", "closed_loop"):
            resp = await client.get(f"/api/v1/config-schema/{name}")
            assert resp.status_code == 200, name
            body = resp.json()
            assert body["name"] == "closed_loop"
            assert len(body["groups"]) == 3

    async def test_get_collection_schema(self, client):
        resp = await client.get("/api/v1/config-schema/collection")
        assert resp.status_code == 200
        assert resp.json()["name"] == "collection"

    async def test_unknown_schema_404(self, client):
        resp = await client.get("/api/v1/config-schema/whatever")
        assert resp.status_code == 404
        assert "未知 Schema" in resp.json()["detail"]

    async def test_requires_auth(self, public_client):
        resp = await public_client.get("/api/v1/config-schema/collection")
        assert resp.status_code in (401, 403)

"""配置 Schema 服务（REFACTOR_PLAN_V2 T3）：闭环 / 采集两份参数 Schema 的声明与入参校验。

设计目标：消灭前后端硬编码漂移——前端按本 Schema 动态渲染表单，后端用同一份定义二次校验，
校验后的完整配置写入运行记录（run_records.params）作为可复现快照。

约定：
- `type` 取值限于 boolean / int / string / date / multi_select（前端一个 SchemaForm 组件即可覆盖）。
- `visible_if` 仅参与前端渲染联动，后端**不**据此裁剪字段（未勾选字段仍会被补默认值，保证配置快照完整）。
- 优先级：`only_new` 仅在 `since` 为空时生效（否则以显式 since 为准）；`until` 不得早于 `since`。
"""
import re

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

CLOSED_LOOP_SCHEMA: dict = {
    "name": "closed_loop",
    "version": 1,
    "groups": [
        {
            "key": "collect",
            "title": "实时采集",
            "fields": [
                {
                    "key": "collect",
                    "type": "boolean",
                    "default": False,
                    "label": "包含实时采集",
                    "hint": "将访问所选外部数据源",
                },
                {
                    "key": "source_ids",
                    "type": "multi_select",
                    "default": [],
                    "label": "参与数据源",
                    "options_source": "GET /api/v1/sources",
                    "visible_if": {"collect": True},
                    "hint": "空 = 全部 active 数据源",
                },
                {
                    "key": "max_pages",
                    "type": "int",
                    "default": 1,
                    "min": 1,
                    "max": 5,
                    "label": "每源抓取页数",
                    "visible_if": {"collect": True},
                },
                {
                    "key": "column",
                    "type": "string",
                    "default": None,
                    "label": "内容类型（栏目）",
                    "visible_if": {"collect": True},
                    "hint": "空 = 不限",
                },
                {
                    "key": "since",
                    "type": "date",
                    "default": None,
                    "label": "发布时间起",
                    "visible_if": {"collect": True},
                },
                {
                    "key": "until",
                    "type": "date",
                    "default": None,
                    "label": "发布时间止",
                    "visible_if": {"collect": True},
                },
                {
                    "key": "only_new",
                    "type": "boolean",
                    "default": False,
                    "label": "仅采集晚于上次成功水位的新内容",
                    "visible_if": {"collect": True},
                },
            ],
        },
        {
            "key": "govern",
            "title": "知识治理",
            "fields": [
                {"key": "refresh_freshness", "type": "boolean", "default": True, "label": "时效刷新"},
                {"key": "detect_conflicts", "type": "boolean", "default": True, "label": "冲突检测"},
                {
                    "key": "rebuild_kg",
                    "type": "boolean",
                    "default": False,
                    "label": "强制重建知识图谱",
                    "hint": "默认增量构建",
                },
                {"key": "archive_expired", "type": "boolean", "default": True, "label": "归档过期知识"},
            ],
        },
        {
            "key": "operate",
            "title": "问答与运营",
            "fields": [
                {"key": "gen_digest", "type": "boolean", "default": True, "label": "生成日报"},
                {"key": "gen_insight", "type": "boolean", "default": True, "label": "生成洞察报告"},
                {"key": "push_notifications", "type": "boolean", "default": True, "label": "推送站内通知"},
                {
                    "key": "health_threshold",
                    "type": "int",
                    "default": 60,
                    "min": 0,
                    "max": 100,
                    "label": "健康度告警阈值",
                },
            ],
        },
    ],
}

COLLECTION_SCHEMA: dict = {
    "name": "collection",
    "version": 1,
    "groups": [
        {
            "key": "collect",
            "title": "采集参数",
            "fields": [
                {
                    "key": "max_pages",
                    "type": "int",
                    "default": 1,
                    "min": 1,
                    "max": 5,
                    "label": "每源抓取页数",
                },
                {"key": "column", "type": "string", "default": None, "label": "内容类型（栏目）", "hint": "空 = 不限"},
                {"key": "since", "type": "date", "default": None, "label": "发布时间起"},
                {"key": "until", "type": "date", "default": None, "label": "发布时间止"},
                {
                    "key": "only_new",
                    "type": "boolean",
                    "default": False,
                    "label": "仅采集晚于上次成功水位的新内容",
                },
                {
                    "key": "max_items",
                    "type": "int",
                    "default": 200,
                    "min": 1,
                    "max": 500,
                    "label": "单次最多入库条数",
                    "hint": "硬上限 500",
                },
            ],
        }
    ],
}

SCHEMAS: dict[str, dict] = {
    "closed_loop": CLOSED_LOOP_SCHEMA,
    "collection": COLLECTION_SCHEMA,
}


def normalize_schema_name(name: str) -> str:
    """URL 里的 schema 名允许用连字符（契约写作 closed-loop），内部统一为下划线键。"""
    return (name or "").strip().replace("-", "_")


def get_schema(name: str) -> dict:
    """返回指定 Schema 定义（深拷贝，调用方修改不会污染声明）。"""
    key = normalize_schema_name(name)
    if key not in SCHEMAS:
        raise KeyError(name)
    # 结构简单，用 JSON 序列化做深拷贝即可（无需引入 copy 之外的能力）
    import json

    return json.loads(json.dumps(SCHEMAS[key]))


def _flat_fields(schema: dict) -> dict[str, dict]:
    fields: dict[str, dict] = {}
    for group in schema.get("groups", []):
        for field in group.get("fields", []):
            fields[field["key"]] = field
    return fields


def _check_date(field_key: str, value) -> str:
    if not isinstance(value, str) or not DATE_PATTERN.match(value):
        raise ValueError(f"{field_key}: 日期格式应为 YYYY-MM-DD")
    return value


def _coerce(spec: dict, value):
    """按 Schema 校验单个字段值；不合法抛 ValueError(f"{field}: {原因}")。"""
    key = spec["key"]
    ftype = spec["type"]

    if ftype == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"{key}: 应为布尔值")
        return value

    if ftype == "int":
        # 注意：bool 是 int 的子类，必须先排除
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{key}: 应为整数")
        low, high = spec.get("min"), spec.get("max")
        if low is not None and value < low:
            raise ValueError(f"{key}: 不得小于 {low}")
        if high is not None and value > high:
            raise ValueError(f"{key}: 不得大于 {high}")
        return value

    if ftype == "string":
        if not isinstance(value, str):
            raise ValueError(f"{key}: 应为字符串")
        return value

    if ftype == "date":
        return _check_date(key, value)

    if ftype == "multi_select":
        if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
            raise ValueError(f"{key}: 应为字符串数组")
        return value

    raise ValueError(f"{key}: 未知字段类型 {ftype}")


def validate_config(name: str, payload: dict | None) -> dict:
    """校验并归一化配置：未知字段忽略；类型/范围不符抛 ValueError；返回补全默认值的完整配置。"""
    key = normalize_schema_name(name)
    if key not in SCHEMAS:
        raise KeyError(name)
    payload = payload or {}
    if not isinstance(payload, dict):
        raise ValueError("配置体应为 JSON 对象")

    fields = _flat_fields(SCHEMAS[key])
    normalized: dict = {}
    for key, spec in fields.items():
        if key not in payload or payload[key] is None:
            normalized[key] = spec.get("default")
            continue
        normalized[key] = _coerce(spec, payload[key])

    # 跨字段一致性：until 不得早于 since（字符串按 YYYY-MM-DD 可直接比较）
    since, until = normalized.get("since"), normalized.get("until")
    if since and until and until < since:
        raise ValueError("until: 不得早于 since")

    return normalized

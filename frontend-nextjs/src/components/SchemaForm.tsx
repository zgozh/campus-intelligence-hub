"use client";

/**
 * SchemaForm —— 按后端配置 Schema（ConfigSchema.groups）动态渲染 antd 表单。
 *
 * 契约（props）：
 * - `schema`：`ConfigSchema`（`GET /api/v1/config-schema/closed-loop` 的响应），只读展示定义；
 * - `value`：当前配置对象（`ClosedLoopConfig`），作为**初始值 + 受控快照**；表单内部为编辑真源，
 *   任何一次控件变更都会立刻回调完整的 `next` 配置（父组件负责 setState，故整体仍是受控的）；
 * - `onChange(next)`：全量回传（不是增量 patch），已剔除 `undefined`（统一为 `null`，保证可 JSON 序列化）；
 * - `columnOptions`：`key === "column"` 的 string 字段候选项（栏目）；缺省时空 = 不限；
 * - `optionsByField`：各 `multi_select` 字段候选项（如 `source_ids` → 数据源列表）；缺省渲染空下拉。
 *
 * 类型映射：boolean→Switch（Form.Item valuePropName="checked"）/ int→InputNumber（min/max）/
 * string→Input（key==="column" 时用 Select）/ date→DatePicker（输出 "YYYY-MM-DD" 字符串）/
 * multi_select→Select mode="multiple"。
 *
 * visible_if 联动：用 `Form.useWatch([], form)` 监听表单全量值，父字段取值等于 `visible_if`
 * 中声明的值时该字段才渲染（不引入额外全页重渲染）。
 *
 * date 字段说明：antd DatePicker 的受控 `value` 必须是 dayjs 对象，而本项目禁止引入 dayjs，
 * 因此 date 字段使用**非受控** DatePicker，只把 onChange 的 `dateString`（"YYYY-MM-DD"）写入配置；
 * 面板内选择的日期会由 rc-picker 自行回显，但外部程序化写入的日期串不会回填到控件（当前 Schema
 * 的 since/until 默认值均为 null，实际使用不受影响）。
 *
 * YAGNI：不做通用表单引擎、不做远端 Schema 版本协商。
 */
import {
  Collapse,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import { useMemo } from "react";
import type { ConfigField, ConfigSchema, ClosedLoopConfig } from "../services/api";

const { Text } = Typography;

export interface SchemaFormOption {
  label: string;
  value: string;
}

export interface SchemaFormProps {
  schema: ConfigSchema;
  value: ClosedLoopConfig;
  onChange: (next: ClosedLoopConfig) => void;
  /** string 字段（key === "column"）的候选项；留空 = 不限 */
  columnOptions?: SchemaFormOption[];
  /** multi_select 字段候选项：field.key → options */
  optionsByField?: Record<string, SchemaFormOption[]>;
  /** 后端 422 字段级校验错误（B1）：key 为字段名，就地标注 validateStatus/help */
  fieldErrors?: { field: string; message: string }[];
}

/** 配置值归一化：去掉 undefined（antd 清空控件时产生），统一为 null */
export function normalizeConfig(next: ClosedLoopConfig): ClosedLoopConfig {
  const out: ClosedLoopConfig = {};
  Object.keys(next).forEach((key) => {
    const raw: unknown = next[key];
    out[key] = raw === undefined ? null : (raw as ClosedLoopConfig[string]);
  });
  return out;
}

/** visible_if 判定：所有声明键都严格等于当前值时才显示（无 visible_if = 始终显示） */
export function isFieldVisible(field: ConfigField, values: ClosedLoopConfig): boolean {
  const condition = field.visible_if;
  if (!condition) return true;
  return Object.keys(condition).every((key) => {
    const expected: unknown = condition[key];
    return values[key] === expected;
  });
}

/** 取字段默认值（unknown → 配置允许的联合类型） */
function toConfigValue(raw: unknown): boolean | number | string | string[] | null {
  if (typeof raw === "boolean" || typeof raw === "number" || typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string");
  }
  return null;
}

export default function SchemaForm({
  schema,
  value,
  onChange,
  columnOptions,
  optionsByField,
  fieldErrors,
}: SchemaFormProps) {
  // 字段级错误索引：{字段名: 文案}
  const errorByField = useMemo(() => {
    const map: Record<string, string> = {};
    (fieldErrors ?? []).forEach((item) => {
      if (item.field) map[item.field] = item.message;
    });
    return map;
  }, [fieldErrors]);
  const [form] = Form.useForm<ClosedLoopConfig>();
  // 监听表单全量值：visible_if 联动与「当前值」判定的唯一来源
  const watched = Form.useWatch([], form) as ClosedLoopConfig | undefined;
  // 合并：父级快照兜底（含未绑定 Form 的 date 字段），表单实时值覆盖
  const current: ClosedLoopConfig = { ...value, ...(watched ?? {}) };

  /** 表单控件变更：回传「父级快照 + 表单全量值」的并集 */
  const handleValuesChange = (
    _changed: Partial<ClosedLoopConfig>,
    all: ClosedLoopConfig,
  ): void => {
    onChange(normalizeConfig({ ...value, ...all }));
  };

  /** 非 Form 绑定控件（date）变更：手动写入配置 */
  const patchField = (key: string, fieldValue: ClosedLoopConfig[string]): void => {
    onChange(normalizeConfig({ ...value, ...(watched ?? {}), [key]: fieldValue }));
  };

  const renderControl = (field: ConfigField) => {
    switch (field.type) {
      case "boolean":
        return <Switch aria-label={field.label} />;
      case "int":
        return (
          <InputNumber
            aria-label={field.label}
            min={field.min}
            max={field.max}
            style={{ width: "100%" }}
          />
        );
      case "date":
        return (
          <DatePicker
            aria-label={field.label}
            style={{ width: "100%" }}
            placeholder="请选择日期"
            onChange={(_date, dateString) => {
              const picked = Array.isArray(dateString) ? dateString[0] : dateString;
              patchField(field.key, picked ? picked : null);
            }}
          />
        );
      case "multi_select":
        return (
          <Select
            mode="multiple"
            aria-label={field.label}
            allowClear
            placeholder="留空 = 全部"
            options={optionsByField?.[field.key] ?? []}
          />
        );
      case "string":
        if (field.key === "column") {
          return (
            <Select
              aria-label={field.label}
              allowClear
              placeholder="留空 = 不限"
              options={columnOptions ?? []}
            />
          );
        }
        return <Input aria-label={field.label} allowClear placeholder="留空 = 不限" />;
      default:
        return <Input aria-label={field.label} />;
    }
  };

  const renderField = (field: ConfigField) => {
    if (!isFieldVisible(field, current)) return null;
    const bound = field.type !== "date";
    return (
      <div key={field.key} data-testid={`schema-field-${field.key}`}>
        <Form.Item
          // date 字段由 DatePicker 非受控管理，不参与 Form 绑定
          name={bound ? field.key : undefined}
          label={field.label}
          valuePropName={field.type === "boolean" ? "checked" : "value"}
          style={{ marginBottom: field.hint ? 4 : 12 }}
          // B1：后端 422 字段级错误就地标注
          validateStatus={errorByField[field.key] ? "error" : undefined}
          help={errorByField[field.key]}
        >
          {renderControl(field)}
        </Form.Item>
        {field.hint ? (
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {field.hint}
            </Text>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={value}
      onValuesChange={handleValuesChange}
      data-testid="schema-form"
    >
      <Collapse
        defaultActiveKey={schema.groups.map((group) => group.key)}
        items={schema.groups.map((group) => ({
          key: group.key,
          label: (
            <Space size={6}>
              <Text strong>{group.title}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {group.fields.filter((field) => isFieldVisible(field, current)).length}/
                {group.fields.length} 项
              </Text>
            </Space>
          ),
          children: group.fields.map((field) => renderField(field)),
        }))}
      />
    </Form>
  );
}

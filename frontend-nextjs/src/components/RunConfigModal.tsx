"use client";

/**
 * RunConfigModal —— 闭环运行配置面板（点击「一键运行闭环」后先弹这里，确认才真正开始运行）。
 *
 * 契约（props）：
 * - `open`：是否打开；每次 `open` 由 false→true 时会重新拉取 Schema 与数据源并重置配置；
 * - `onCancel()`：点「取消」或右上角关闭；
 * - `onConfirm(config)`：点「确定并开始」，把配置对象回传父组件（**父组件负责发请求**）。
 *
 * 职责边界：本组件只负责「加载 Schema / 数据源 → 渲染 SchemaForm → 回传配置」，
 * **不发起任何运行请求**（保持纯粹、便于单测）。
 *
 * 数据来源：`api.getConfigSchema("closed-loop")`（失败 → 可见提示，不阻塞）、
 * `api.listSources()`（失败 → 提示且仅数据源多选为空，其余字段照常可用）、
 * `api.listSourceColumns(id)`（仅在**恰好选中 1 个数据源**时加载该源真实栏目作为 columnOptions；
 * 多源时各源栏目定义不一致，保持"留空 = 不限"）。
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Modal, Space, Spin, Typography } from "antd";
import SchemaForm from "./SchemaForm";
import { api } from "../services/api";
import type { CampusSource, ClosedLoopConfig, ConfigSchema } from "../services/api";

const { Text } = Typography;

export interface RunConfigModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (config: ClosedLoopConfig) => void;
  /** 422 字段级校验错误（B1）：由后端 detail[{field,message}] 映射，就地标注到对应字段 */
  fieldErrors?: { field: string; message: string }[];
}

/** Schema 默认值 → 初始配置（非法/未知默认值统一为 null） */
function buildDefaults(schema: ConfigSchema): ClosedLoopConfig {
  const config: ClosedLoopConfig = {};
  schema.groups.forEach((group) => {
    group.fields.forEach((field) => {
      const raw: unknown = field.default;
      if (typeof raw === "boolean" || typeof raw === "number" || typeof raw === "string") {
        config[field.key] = raw;
      } else if (Array.isArray(raw)) {
        config[field.key] = raw.filter((item): item is string => typeof item === "string");
      } else {
        config[field.key] = null;
      }
    });
  });
  return config;
}

function errorText(error: unknown): string {
  const message = (error as Error)?.message;
  return message ? String(message) : "未知错误";
}

export default function RunConfigModal({ open, onCancel, onConfirm, fieldErrors }: RunConfigModalProps) {
  const [schema, setSchema] = useState<ConfigSchema | null>(null);
  const [config, setConfig] = useState<ClosedLoopConfig>({});
  const [sources, setSources] = useState<CampusSource[]>([]);
  const [columnOptions, setColumnOptions] = useState<{ label: string; value: string }[]>([]);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [schemaError, setSchemaError] = useState("");
  const [sourcesError, setSourcesError] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoadingSchema(true);
    setSchema(null);
    setConfig({});
    setSchemaError("");
    setSourcesError("");
    setSources([]);

    api
      .getConfigSchema("closed-loop")
      .then((data) => {
        if (!alive) return;
        setSchema(data);
        setConfig(buildDefaults(data));
      })
      .catch((error: unknown) => {
        if (alive) setSchemaError(errorText(error));
      })
      .finally(() => {
        if (alive) setLoadingSchema(false);
      });

    api
      .listSources()
      .then((data) => {
        if (alive) setSources(data.sources || []);
      })
      .catch((error: unknown) => {
        if (alive) setSourcesError(errorText(error));
      });

    return () => {
      alive = false;
    };
  }, [open]);

  const optionsByField = useMemo<Record<string, { label: string; value: string }[]>>(
    () => ({
      source_ids: sources.map((source) => ({ label: source.name, value: source.id })),
    }),
    [sources],
  );

  // 恰好选中 1 个数据源时，栏目选项取该源的真实栏目录像（多源时栏目定义不一致 → 留空 = 不限）
  const sourceKey = Array.isArray(config.source_ids) ? config.source_ids.join(",") : "";
  useEffect(() => {
    if (!open || !sourceKey || sourceKey.includes(",")) {
      setColumnOptions([]);
      return;
    }
    let alive = true;
    api
      .listSourceColumns(sourceKey)
      .then((data) => {
        if (!alive) return;
        setColumnOptions((data.columns || []).map((item) => ({ label: item.label, value: item.value })));
      })
      .catch(() => {
        if (alive) setColumnOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [open, sourceKey]);

  // 风险提示：勾选实时采集时展示将访问的源数量与提交时会带的过滤条件
  const collect = config.collect === true;
  const selectedIds = Array.isArray(config.source_ids) ? config.source_ids : [];
  const activeSourceCount = sources.filter((source) => source.status === "active").length;
  const effectiveSourceCount = selectedIds.length > 0 ? selectedIds.length : activeSourceCount;
  const maxPages = typeof config.max_pages === "number" ? config.max_pages : 1;
  const columnText =
    typeof config.column === "string" && config.column ? config.column : "不限";
  const sinceText = typeof config.since === "string" && config.since ? config.since : "不限";
  const untilText = typeof config.until === "string" && config.until ? config.until : "不限";
  const onlyNewText = config.only_new === true ? "是" : "否";

  return (
    <Modal
      open={open}
      title="闭环运行配置"
      width={680}
      onCancel={onCancel}
      maskClosable={false}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button
          key="confirm"
          type="primary"
          disabled={!schema || loadingSchema}
          onClick={() => onConfirm(config)}
        >
          确定并开始
        </Button>,
      ]}
    >
      {/* open 为 false 时不渲染主体：重新打开即得到全新表单与全新的非受控日期控件 */}
      {open ? (
        <div>
          {loadingSchema ? (
            <Space size={8} style={{ padding: "24px 0" }}>
              <Spin size="small" />
              <Text type="secondary">正在加载配置…</Text>
            </Space>
          ) : null}

          {schemaError ? (
            <Alert
              type="error"
              showIcon
              message="配置 Schema 加载失败"
              description={`${schemaError}（无法开始运行，请稍后重试）`}
              style={{ marginBottom: 12 }}
            />
          ) : null}

          {sourcesError ? (
            <Alert
              type="warning"
              showIcon
              message="数据源列表加载失败"
              description={`${sourcesError}（数据源多选暂不可用，其余字段仍可配置）`}
              style={{ marginBottom: 12 }}
            />
          ) : null}

          {schema ? (
            <SchemaForm
              schema={schema}
              value={config}
              onChange={setConfig}
              columnOptions={columnOptions}
              optionsByField={optionsByField}
              fieldErrors={fieldErrors}
            />
          ) : null}

          {collect ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              message={`将访问 ${effectiveSourceCount} 个外部数据源（每源最多 ${maxPages} 页），可能耗时较久`}
              description={
                <Space direction="vertical" size={2}>
                  <Text style={{ fontSize: 12 }}>栏目：{columnText}</Text>
                  <Text style={{ fontSize: 12 }}>
                    时间段：{sinceText} ~ {untilText}
                  </Text>
                  <Text style={{ fontSize: 12 }}>仅采集新内容：{onlyNewText}</Text>
                </Space>
              }
            />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

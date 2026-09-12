"use client";

/**
 * DecisionTimeline —— 闭环运行决策时间线（实时流与历史回放**同构**渲染）。
 *
 * 契约（props）：
 * - `events`：与后端 SSE 事件同构的事件序列（实时=逐条追加；回放=GET /closed-loop/runs/{id} 的 events）。
 *   组件为**纯渲染**：无内部计时器、无请求；父组件每次 setState 追加事件即可看到时间线逐步生长。
 * - `running`：是否仍在运行。仅影响「已开始但未收到 stage_finished」的阶段头显示 loading 还是「未完成」。
 * - `runSummary`：运行汇总兜底（回放接口的 summary）；若事件里已有 `run_finished.summary` 则以事件为准。
 *
 * 渲染规则：
 * - `run_started` → 起始行（run_id + 开始时刻）；
 * - `stage_started` → 阶段头（`name`（如"实时采集/知识治理/问答与运营"）+ `index+1/total`）；
 * - `stage_decision` → 一个条目：左侧 agent + decision（displayTitle 40）+ detail（displayTitle 120），
 *   右侧该步完成时刻 `formatTime(finished_at)` 与耗时 `(duration_ms/1000).toFixed(1)s`；
 * - `stage_finished` → 阶段收尾行（状态 + 阶段耗时）；`run_finished` → 结尾总结（状态 + 总耗时 + summary）；
 * - `run_error` → antd Alert(type="error")；`heartbeat` → 一律忽略（不渲染成条目）；
 * - 颜色：状态 → `statusColor`（ok 绿 / partial 橙 / error 红 / skip 灰），同时体现在圆点与 Tag 上。
 */
import { useMemo } from "react";
import { Alert, Empty, Space, Spin, Tag, Timeline, Typography } from "antd";
import type { TimelineProps } from "antd";
import DashboardMarkdown from "./DashboardMarkdown";
import type { ClosedLoopEventData } from "../services/api";
import { displayTitle, formatTime, statusColor } from "../utils/format";

const { Text } = Typography;

type TimelineItem = NonNullable<TimelineProps["items"]>[number];

export interface DecisionTimelineProps {
  events: ClosedLoopEventData[];
  running?: boolean;
  runSummary?: string | null;
}

/** 阶段 key → 中文名（stage_finished 事件不带 name，需要本地映射） */
const STAGE_TITLE: Record<string, string> = {
  collection: "实时采集",
  governance: "知识治理",
  operation: "问答与运营",
};

/** 状态 → 中文文案（缺失时回退原始状态串） */
const STATUS_LABEL: Record<string, string> = {
  ok: "完成",
  partial: "部分完成",
  error: "异常",
  skip: "已跳过",
  skipped: "已跳过",
  cancelled: "已取消",
  running: "运行中",
};

/** 耗时展示：毫秒 → "x.xs"（非法/缺失返回空串） */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Timeline 圆点颜色：statusColor 的 "default" 在 Timeline 上无对应预设，回退 gray */
function dotColorOf(status: string | null | undefined): string {
  const color = statusColor(status);
  return color === "default" ? "gray" : color;
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "未知";
  return STATUS_LABEL[status] ?? status;
}

function stageTitle(stage: string | null | undefined): string {
  if (!stage) return "阶段";
  return STAGE_TITLE[stage] ?? stage;
}

/** 条目右侧：完成时刻 + 耗时（无数据则不渲染） */
function TimeMeta({
  finishedAt,
  durationMs,
}: {
  finishedAt?: string | null;
  durationMs?: number | null;
}) {
  const time = formatTime(finishedAt);
  const duration = formatDuration(durationMs);
  if (!time && !duration) return null;
  return (
    <div
      data-testid="timeline-time-meta"
      style={{ whiteSpace: "nowrap", color: "#999", fontSize: 12, marginLeft: 8 }}
    >
      {time ? <span>{time}</span> : null}
      {time && duration ? <span style={{ margin: "0 4px" }}>·</span> : null}
      {duration ? <span>{duration}</span> : null}
    </div>
  );
}

/**
 * 事件序列 → Timeline items（纯函数，便于单测与实时/回放复用）。
 * 返回 `errors`：run_error 的 message 列表，由调用方用 Alert 展示。
 */
export function buildTimelineItems(
  events: ClosedLoopEventData[],
  running = false,
  runSummary?: string | null,
): { items: TimelineItem[]; errors: string[] } {
  const items: TimelineItem[] = [];
  const errors: string[] = [];
  // 先做一遍预扫描：阶段是否已收尾决定阶段头显示 loading 还是完成态
  const finishedStages = new Set<string>();
  events.forEach((event) => {
    if (event.event === "stage_finished" && event.stage) finishedStages.add(event.stage);
  });

  events.forEach((event, index) => {
    const key = `${event.event}-${index}`;
    switch (event.event) {
      case "heartbeat":
        // 心跳不是业务步骤，一律忽略
        return;
      case "run_started": {
        items.push({
          key,
          color: "blue",
          children: (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Space size={6} wrap>
                <Text strong>运行已开始</Text>
                {event.run_id ? <Tag color="blue">{event.run_id}</Tag> : null}
              </Space>
              <TimeMeta finishedAt={event.started_at} />
            </div>
          ),
        });
        return;
      }
      case "stage_started": {
        const stageKey = event.stage ?? `stage-${index}`;
        const done = finishedStages.has(stageKey);
        const total = typeof event.total === "number" ? event.total : undefined;
        const order = typeof event.index === "number" ? event.index + 1 : undefined;
        items.push({
          key,
          color: done ? "green" : "blue",
          children: (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Space size={6} wrap>
                <Text strong>{event.name || stageTitle(event.stage)}</Text>
                {order !== undefined && total !== undefined ? (
                  <Tag color="blue">
                    {order}/{total}
                  </Tag>
                ) : null}
                {done ? null : running ? (
                  <Spin size="small" data-testid="stage-loading" />
                ) : (
                  <Tag>未完成</Tag>
                )}
              </Space>
              <TimeMeta finishedAt={event.started_at} />
            </div>
          ),
        });
        return;
      }
      case "stage_decision": {
        const color = statusColor(event.status);
        items.push({
          key,
          color: dotColorOf(event.status),
          children: (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <Space size={4} wrap>
                  <Tag color="geekblue">{event.agent || "Agent"}</Tag>
                  <Text strong>{displayTitle(event.decision, 40)}</Text>
                  <Tag color={color}>{statusLabel(event.status)}</Tag>
                </Space>
                {event.detail ? (
                  <div style={{ color: "#999", fontSize: 12 }}>{displayTitle(event.detail, 120)}</div>
                ) : null}
              </div>
              <TimeMeta finishedAt={event.finished_at} durationMs={event.duration_ms} />
            </div>
          ),
        });
        return;
      }
      case "stage_finished": {
        items.push({
          key,
          color: dotColorOf(event.status),
          children: (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Space size={4} wrap>
                <Text strong>{stageTitle(event.stage)}</Text>
                <Tag color={statusColor(event.status)}>{statusLabel(event.status)}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  阶段耗时 <span>{formatDuration(event.duration_ms) || "-"}</span>
                </Text>
                {event.detail ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {displayTitle(event.detail, 120)}
                  </Text>
                ) : null}
              </Space>
              {/* 阶段耗时已在左侧文案中给出，右侧只补完成时刻，避免同一行重复展示 */}
              <TimeMeta finishedAt={event.finished_at} />
            </div>
          ),
        });
        return;
      }
      case "run_finished": {
        const eventSummary =
          typeof event.summary === "string" && event.summary ? event.summary : null;
        const summary =
          eventSummary ?? (typeof runSummary === "string" && runSummary ? runSummary : null);
        items.push({
          key,
          color: dotColorOf(event.status),
          children: (
            <div>
              <Space size={4} wrap>
                <Text strong>运行结束</Text>
                <Tag color={statusColor(event.status)}>{statusLabel(event.status)}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  总耗时 <span>{formatDuration(event.duration_ms) || "-"}</span>
                </Text>
                {event.finished_at ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatTime(event.finished_at)}
                  </Text>
                ) : null}
              </Space>
              {summary ? (
                <div style={{ marginTop: 4 }}>
                  {/* LLM 生成的 summary 可能含 Markdown：用 DashboardMarkdown 渲染，避免裸显 ** */}
                  <DashboardMarkdown content={summary} />
                </div>
              ) : null}
            </div>
          ),
        });
        return;
      }
      case "run_error": {
        errors.push(
          typeof event.message === "string" && event.message ? event.message : "运行异常（无详情）",
        );
        return;
      }
      default:
        return;
    }
  });

  // 兜底：事件流里没有 run_finished（如中断后按运行记录补齐）时，用 runSummary 收尾
  const hasRunFinished = events.some((event) => event.event === "run_finished");
  if (!hasRunFinished && typeof runSummary === "string" && runSummary) {
    items.push({
      key: "run-summary-fallback",
      color: "gray",
      children: (
        <div>
          <Text strong>运行汇总</Text>
          <div style={{ marginTop: 4 }}>
            <DashboardMarkdown content={runSummary} />
          </div>
        </div>
      ),
    });
  }

  return { items, errors };
}

export default function DecisionTimeline({
  events,
  running = false,
  runSummary,
}: DecisionTimelineProps) {
  const { items, errors } = useMemo(
    () => buildTimelineItems(events, running, runSummary),
    [events, running, runSummary],
  );

  if (items.length === 0 && errors.length === 0) {
    return (
      <div data-testid="decision-timeline">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未开始" />
      </div>
    );
  }

  return (
    <div data-testid="decision-timeline">
      {errors.map((text, index) => (
        <Alert
          key={`run-error-${index}`}
          type="error"
          showIcon
          message="闭环运行异常"
          description={text}
          style={{ marginBottom: 12 }}
        />
      ))}
      <Timeline items={items} />
    </div>
  );
}

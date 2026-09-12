"use client";

/**
 * ClosedLoop —— 智能运营闭环（AI 智能体中心）。
 *
 * 数据流（实时）：
 *   点击「一键运行闭环」→ RunConfigModal（拉 Schema/数据源、确认配置）
 *   → 关弹窗 → api.streamClosedLoop(config, onEvent, signal) 逐事件回调
 *   → 每条事件 append 进 `events` state → DecisionTimeline 纯渲染，随事件逐步生长。
 *
 * 数据流（回放）：运行历史 Select → api.getClosedLoopRun(run_id) → 同一 `DecisionTimeline`
 *   渲染 detail.events（与实时事件同构），仅额外加「历史回放」Tag 做区分。
 *
 * 断线兜底：流异常中断（非用户 abort）且已拿到 run_id 时，调 getClosedLoopRun 补齐事件并提示；
 *   用户主动取消/离开页面（abort）不做补齐。取消运行走 api.cancelClosedLoopRun（协作式）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Timeline,
  Typography,
  message,
} from "antd";
import {
  PlayCircleOutlined,
  StopOutlined,
  DeploymentUnitOutlined,
  DatabaseOutlined,
  ApartmentOutlined,
  CheckCircleOutlined,
  BulbOutlined,
  MessageOutlined,
  StarOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import type {
  ClosedLoopConfig,
  ClosedLoopEventData,
  ClosedLoopRunDetail,
  ClosedLoopRunItem,
  DecisionRun,
} from "../services/api";
import { displayTitle, formatDateTime, formatTime, statusColor } from "../utils/format";
import DecisionTimeline, { formatDuration } from "../components/DecisionTimeline";
import RunConfigModal from "../components/RunConfigModal";

const { Title, Text } = Typography;

/** 运行/阶段/决策状态 → 中文文案 */
const STATUS_LABEL: Record<string, string> = {
  ok: "完成",
  partial: "部分完成",
  error: "异常",
  skip: "已跳过",
  skipped: "已跳过",
  cancelled: "已取消",
  running: "运行中",
  pending: "排队中",
};

// AI 智能体能力矩阵（校务中台的各个 Agent）
const AGENTS = [
  { name: "采集 Agent", icon: <DatabaseOutlined />, color: "#1677ff", desc: "数据源发现 / Crawl4AI 智能推荐 / 自动采集", path: "/sources" },
  { name: "知识治理 Agent", icon: <CheckCircleOutlined />, color: "#52c41a", desc: "冲突检测 / 审核队列 / 归档过期 / 发布流程", path: "/review" },
  { name: "图谱 Agent", icon: <ApartmentOutlined />, color: "#722ed1", desc: "LLM 三元组抽取 / 关系路径 / GraphRAG 子图", path: "/knowledge-graph" },
  { name: "洞察 Agent", icon: <BulbOutlined />, color: "#fa8c16", desc: "运营数据 → 校务洞察 / 自动日报 / 趋势风险", path: "/insights" },
  { name: "问答 Agent", icon: <MessageOutlined />, color: "#13c2c2", desc: "融合检索 + Rerank + 意图/部门路由 + 防幻觉", path: "/ask" },
  { name: "审核助手 Agent", icon: <StarOutlined />, color: "#eb2f96", desc: "AI 预审摘要 / 风险 / 推荐动作(批准/拒绝/合并)", path: "/review" },
];

/** 从事件序列推导当前阶段名（最后一个已开始但未收尾的阶段） */
function currentStageName(events: ClosedLoopEventData[]): string | null {
  const finished = new Set<string>();
  events.forEach((event) => {
    if (event.event === "stage_finished" && event.stage) finished.add(event.stage);
  });
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.event === "stage_started" && event.stage && !finished.has(event.stage)) {
      return event.name || event.stage;
    }
  }
  return null;
}

export default function ClosedLoop() {
  const navigate = useNavigate();
  const [configOpen, setConfigOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ClosedLoopEventData[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorText, setErrorText] = useState("");
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<ClosedLoopRunItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [replayRun, setReplayRun] = useState<ClosedLoopRunDetail | null>(null);
  const [tabKey, setTabKey] = useState("live");
  const [seedLoading, setSeedLoading] = useState(false);
  const [stats, setStats] = useState({ sources: 0, pending: 0, entities: 0, relations: 0, reports: 0, health: 0, objects: 0, kos: 0 });
  const [decisions, setDecisions] = useState<DecisionRun[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const sawRunErrorRef = useRef(false);

  // 组件卸载：中断进行中的流（不补齐事件）
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // 运行中每秒钟刷新「已用时」
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (startedAtRef.current > 0) setElapsedMs(Date.now() - startedAtRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const loadDecisions = useCallback(async () => {
    try {
      const data = await api.listDecisions(10);
      if (mountedRef.current) setDecisions(data.runs || []);
    } catch {
      /* 历史聚合失败不阻断主流程 */
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await api.listClosedLoopRuns(10);
      if (mountedRef.current) setHistory(data.runs || []);
    } catch {
      /* 历史列表失败不阻断主流程 */
    } finally {
      if (mountedRef.current) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    api.listSources().then((d) => setStats((s) => ({ ...s, sources: d.total }))).catch(() => {});
    api.listReviewTasks().then((d) => setStats((s) => ({ ...s, pending: d.total }))).catch(() => {});
    api.listKnowledgeGraph().then((d) => setStats((s) => ({ ...s, entities: d.entity_count, relations: d.relation_count }))).catch(() => {});
    api.listInsights(1).then((d) => setStats((s) => ({ ...s, reports: d.total }))).catch(() => {});
    api.getKnowledgeHealth().then((h) => setStats((s) => ({ ...s, health: h.health_score }))).catch(() => {});
    loadDecisions();
    refreshHistory();
  }, [loadDecisions, refreshHistory]);

  const statusOf = (name: string): string => {
    switch (name) {
      case "采集 Agent": return `数据源 ${stats.sources}`;
      case "知识治理 Agent": return `待审 ${stats.pending}`;
      case "图谱 Agent": return `${stats.entities} 实体 · ${stats.relations} 关系`;
      case "洞察 Agent": return `${stats.reports} 份报告`;
      case "问答 Agent": return `健康度 ${stats.health}`;
      case "审核助手 Agent": return `待审 ${stats.pending}`;
      default: return "";
    }
  };

  /** 409 兜底：从运行历史里找出进行中的 run_id（api.ts 冻结，错误对象只带 detail 文案） */
  const findRunningRunId = async (): Promise<string | null> => {
    try {
      const data = await api.listClosedLoopRuns(10);
      const active = (data.runs || []).find((item) => item.status === "running" || item.status === "pending");
      return active ? active.run_id : null;
    } catch {
      return null;
    }
  };

  /** 展示运行失败信息：409 特殊化，422 逐条展示 detail[].message */
  const showRunError = async (error: unknown): Promise<void> => {
    const text = (error as Error)?.message || "未知错误";
    if (text.includes("已有进行中的闭环运行")) {
      const activeId = await findRunningRunId();
      if (!mountedRef.current) return;
      setErrorText(`已有进行中的闭环运行${activeId ? `（run_id=${activeId}）` : ""}`);
      setErrorDetails([]);
      return;
    }
    if (!mountedRef.current) return;
    setErrorText("闭环运行失败");
    setErrorDetails(text.split("; ").map((line) => line.trim()).filter(Boolean));
  };

  /** 断线兜底：流异常中断时按 run_id 补齐事件（用户主动 abort 不走这里） */
  const recoverFromInterruption = async (error: unknown): Promise<void> => {
    const rid = runIdRef.current;
    if (!rid) {
      await showRunError(error);
      return;
    }
    try {
      const detail = await api.getClosedLoopRun(rid);
      if (!mountedRef.current) return;
      setEvents((detail.events || []).filter((event) => event.event !== "heartbeat"));
      setRunSummary(detail.summary ?? null);
      setNotice("连接中断，已按运行记录补齐");
    } catch {
      await showRunError(error);
    }
  };

  const startRun = async (config: ClosedLoopConfig): Promise<void> => {
    // 关闭配置面板并中断上一次未结束的流
    setConfigOpen(false);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setEvents([]);
    setRunId(null);
    runIdRef.current = null;
    setRunSummary(null);
    setErrorText("");
    setErrorDetails([]);
    setNotice("");
    setReplayRun(null);
    setTabKey("live");
    setElapsedMs(0);
    startedAtRef.current = Date.now();
    sawRunErrorRef.current = false;
    setRunning(true);

    try {
      const result = await api.streamClosedLoop(
        config,
        (event, data) => {
          // 心跳不渲染、不入 state
          if (event === "heartbeat") return;
          if (event === "run_started" && typeof data.run_id === "string") {
            runIdRef.current = data.run_id;
            setRunId(data.run_id);
          }
          // ★ 逐条追加：不等整批，时间线随事件生长
          setEvents((prev) => [...prev, data]);
          if (event === "run_finished") {
            setRunSummary(typeof data.summary === "string" ? data.summary : null);
          }
          if (event === "run_error") {
            // 运行级错误：时间线内由 DecisionTimeline 用 Alert 持久展示，这里只做即时提示
            sawRunErrorRef.current = true;
            message.error(typeof data.message === "string" ? data.message : "闭环运行异常");
          }
        },
        controller.signal,
      );
      if (result && typeof result.run_id === "string" && result.run_id) {
        runIdRef.current = result.run_id;
        setRunId(result.run_id);
      }
      if (mountedRef.current && !sawRunErrorRef.current) message.success("闭环运行完成");
    } catch (error: unknown) {
      const aborted = controller.signal.aborted || (error as Error)?.name === "AbortError";
      if (!mountedRef.current) return;
      if (!aborted) {
        await recoverFromInterruption(error);
      }
    } finally {
      // 只有"当前这次运行"才允许收尾改状态：被后一次运行 abort 掉的旧请求不得覆盖新运行
      const isCurrent = abortRef.current === controller;
      if (isCurrent) abortRef.current = null;
      if (isCurrent && mountedRef.current) {
        setRunning(false);
        if (startedAtRef.current > 0) setElapsedMs(Date.now() - startedAtRef.current);
        void refreshHistory();
        void loadDecisions();
      }
    }
  };

  const cancelRun = async (): Promise<void> => {
    const rid = runIdRef.current;
    if (!rid) {
      message.warning("尚未拿到 run_id，请稍候再试");
      return;
    }
    try {
      await api.cancelClosedLoopRun(rid);
      message.info("已请求取消，将在当前阶段结束后停止");
    } catch (error: unknown) {
      message.error(`取消失败：${(error as Error)?.message || "请稍后重试"}`);
    }
  };

  const handleReplay = async (selectedRunId: string): Promise<void> => {
    try {
      const detail = await api.getClosedLoopRun(selectedRunId);
      if (!mountedRef.current) return;
      setReplayRun(detail);
      setTabKey("live");
    } catch (error: unknown) {
      message.error(`回放加载失败：${(error as Error)?.message || "请稍后重试"}`);
    }
  };

  const backToLive = (): void => {
    setReplayRun(null);
  };

  const seed = async (): Promise<void> => {
    setSeedLoading(true);
    try {
      const r = await api.seedDemo();
      message.success(`已导入演示数据：新增 ${r.created} 条（跳过 ${r.skipped}）`);
      // 刷新统计
      api.listSources().then((d) => setStats((s) => ({ ...s, sources: d.total }))).catch(() => {});
      api.listKnowledgeObjects().then((d) => setStats((s) => ({ ...s, objects: d.total }))).catch(() => {});
    } catch (e) {
      message.error(`导入演示数据失败：${(e as Error)?.message || "请稍后重试"}`);
    } finally {
      setSeedLoading(false);
    }
  };

  const timelineEvents = useMemo<ClosedLoopEventData[]>(
    () => (replayRun ? (replayRun.events || []).filter((event) => event.event !== "heartbeat") : events),
    [replayRun, events],
  );
  const stageName = useMemo(() => currentStageName(events), [events]);
  const historyOptions = useMemo(
    () =>
      history.map((item) => ({
        value: item.run_id,
        label: `${item.run_id} · ${STATUS_LABEL[item.status] ?? item.status}${item.status === "running" ? "（进行中）" : ""} · ${formatDateTime(item.started_at) || "—"}`,
      })),
    [history],
  );

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        AI 智能体中心 <span style={{ fontWeight: 400, fontSize: 14, color: "#888" }}>三层编排 + 能力矩阵</span>
      </Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {AGENTS.map((a) => (
          <Col xs={24} sm={12} md={8} key={a.name}>
            <Card size="small">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ color: a.color, fontSize: 18 }}>{a.icon}</span>
                <Text strong>{a.name}</Text>
                <Tag color="blue" style={{ marginLeft: "auto" }}>{statusOf(a.name)}</Tag>
              </div>
              <div style={{ color: "#666", fontSize: 13, minHeight: 36 }}>{a.desc}</div>
              <Button size="small" type="link" style={{ padding: 0 }} onClick={() => navigate(a.path)}>
                进入 →
              </Button>
            </Card>
          </Col>
        ))}
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text type="secondary">
            <DeploymentUnitOutlined /> 一键运行「采集 → 知识治理 → 问答/运营」三层编排，串起发现-采集-治理-图谱-洞察-健康完整链路。
          </Text>
          <Space wrap>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={running}
              disabled={running}
              onClick={() => setConfigOpen(true)}
            >
              {running ? "运行中…" : "一键运行闭环"}
            </Button>
            {running ? (
              <Button icon={<StopOutlined />} onClick={() => void cancelRun()}>
                取消运行
              </Button>
            ) : null}
            <Button loading={seedLoading} onClick={() => void seed()}>
              导入演示数据
            </Button>
          </Space>
        </Space>
      </Card>

      {running || runId ? (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space wrap size={8}>
            {running ? <Spin size="small" /> : null}
            <Text strong>{running ? "运行中" : "最近一次运行"}</Text>
            {runId ? <Tag color="geekblue">run_id={runId}</Tag> : null}
            <Text type="secondary">已用时 {formatDuration(elapsedMs) || "0.0s"}</Text>
            <Text type="secondary">当前阶段：{running ? stageName ?? "准备中" : "已结束"}</Text>
          </Space>
        </Card>
      ) : null}

      {errorText ? (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setErrorText("")}
          message={errorText}
          description={
            errorDetails.length > 0 ? (
              <Space direction="vertical" size={2}>
                {errorDetails.map((line) => (
                  <Text key={line} style={{ fontSize: 12 }}>{line}</Text>
                ))}
              </Space>
            ) : undefined
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {notice ? (
        <Alert
          type="info"
          showIcon
          closable
          onClose={() => setNotice("")}
          message={notice}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Tabs
        activeKey={tabKey}
        onChange={setTabKey}
        items={[
          {
            key: "live",
            label: "本次实时 / 历史回放",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Card size="small" title="运行历史（可回放）">
                  <Space wrap>
                    <Select
                      style={{ minWidth: 340 }}
                      placeholder={history.length > 0 ? "选择一次历史运行进行回放" : "暂无运行历史"}
                      loading={historyLoading}
                      value={replayRun?.run_id}
                      options={historyOptions}
                      onChange={(value: string) => void handleReplay(value)}
                      notFoundContent={historyLoading ? <Spin size="small" /> : "暂无运行历史"}
                    />
                    <Button size="small" loading={historyLoading} onClick={() => void refreshHistory()}>
                      刷新
                    </Button>
                    {replayRun ? (
                      <Button size="small" onClick={backToLive}>
                        返回实时视图
                      </Button>
                    ) : null}
                  </Space>
                </Card>
                <Card
                  title={
                    <Space wrap size={6}>
                      <span>Agent 决策时间线</span>
                      {replayRun ? (
                        <Tag color="purple">历史回放</Tag>
                      ) : running ? (
                        <Tag color="processing">实时</Tag>
                      ) : null}
                    </Space>
                  }
                >
                  <DecisionTimeline
                    events={timelineEvents}
                    running={replayRun ? false : running}
                    runSummary={replayRun ? replayRun.summary : runSummary}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: "aggregate",
            label: "历史聚合",
            children: (
              <Card title="Agent 决策时间线（历史聚合）">
                {decisions.length === 0 ? (
                  <Text type="secondary">暂无历史决策记录</Text>
                ) : (
                  <Timeline
                    items={decisions.flatMap((r) =>
                      r.entries.map((e, index) => ({
                        key: `${r.run_id}-${index}`,
                        color: statusColor(e.status) === "default" ? "gray" : statusColor(e.status),
                        label: formatTime(e.finished_at ?? e.created_at) || undefined,
                        children: (
                          <div>
                            <Space wrap>
                              <Tag color="geekblue">{e.agent}</Tag>
                              <Text strong>{displayTitle(e.decision, 40)}</Text>
                              <Tag color={statusColor(e.status)}>{STATUS_LABEL[e.status] ?? e.status}</Tag>
                              {e.duration_ms !== null && e.duration_ms !== undefined ? (
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {formatDuration(e.duration_ms)}
                                </Text>
                              ) : null}
                            </Space>
                            <div style={{ color: "#999", fontSize: 12 }}>{displayTitle(e.detail, 120)}</div>
                          </div>
                        ),
                      })),
                    )}
                  />
                )}
              </Card>
            ),
          },
        ]}
      />

      <RunConfigModal
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        onConfirm={(config) => void startRun(config)}
      />
    </div>
  );
}

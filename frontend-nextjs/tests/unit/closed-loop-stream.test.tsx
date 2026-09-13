// @vitest-environment jsdom
/**
 * 闭环流式执行前端单测（REFACTOR_PLAN_V2 T12）：
 * 1) SSE 事件 → 时间线增量渲染（阶段名 / 决策文本 / HH:mm:ss 时刻 / x.xs 耗时；heartbeat 不入条目）；
 * 2) 运行配置面板：按 Schema 分组渲染 + visible_if 联动 + 风险提示；
 * 3) 点「一键运行闭环」先弹配置面板，确认后才带面板参数发起流式请求；
 * 4) 历史回放与实时共用同一个 DecisionTimeline（同构）。
 *
 * Run with: npx vitest run tests/unit/closed-loop-stream.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ClosedLoop from "../../src/views/ClosedLoop";
import { api } from "../../src/services/api";
import { formatTime } from "../../src/utils/format";
import type {
  CampusSource,
  ClosedLoopConfig,
  ClosedLoopEventData,
  ClosedLoopEventName,
  ClosedLoopRunDetail,
  ClosedLoopRunItem,
  ConfigSchema,
  KnowledgeHealth,
} from "../../src/services/api";

vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
}));

vi.mock("../../src/services/api", () => ({
  api: {
    listSources: vi.fn(),
    listReviewTasks: vi.fn(),
    listKnowledgeGraph: vi.fn(),
    listInsights: vi.fn(),
    getKnowledgeHealth: vi.fn(),
    listDecisions: vi.fn(),
    listClosedLoopRuns: vi.fn(),
    getClosedLoopRun: vi.fn(),
    cancelClosedLoopRun: vi.fn(),
    getConfigSchema: vi.fn(),
    listSourceColumns: vi.fn(),
    streamClosedLoop: vi.fn(),
    seedDemo: vi.fn(),
    listKnowledgeObjects: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const HEALTH: KnowledgeHealth = {
  health_score: 80,
  formula: "100 - 待审*2",
  today: { new: 1, changed: 0, conflicts: 0, review: 0 },
  coverage: { total: 10, published: 8, expired: 1 },
  freshness: { Fresh: 6, Aging: 2, Stale: 1, Unknown: 1 },
  conflict_rate: 0,
  review_backlog: 0,
  source_health: { total: 2, error: 0, ok: 2 },
};

/** 与后端 closed_loop Schema 同构的测试 Schema（含 collect/source_ids/max_pages/gen_insight） */
const SCHEMA: ConfigSchema = {
  name: "closed_loop",
  version: 1,
  groups: [
    {
      key: "collect",
      title: "实时采集",
      fields: [
        { key: "collect", type: "boolean", default: false, label: "包含实时采集", hint: "将访问所选外部数据源" },
        {
          key: "source_ids",
          type: "multi_select",
          default: [],
          label: "参与数据源",
          options_source: "GET /api/v1/sources",
          visible_if: { collect: true },
          hint: "空 = 全部 active 数据源",
        },
        { key: "max_pages", type: "int", default: 1, min: 1, max: 5, label: "每源抓取页数", visible_if: { collect: true } },
      ],
    },
    {
      key: "operate",
      title: "问答与运营",
      fields: [{ key: "gen_insight", type: "boolean", default: true, label: "生成洞察报告" }],
    },
  ],
};

const SOURCES: CampusSource[] = [
  { id: "src_1", name: "教务处通知", source_type: "website", status: "active", created_at: "2026-09-01T00:00:00Z" },
  { id: "src_2", name: "研究生院", source_type: "website", status: "active", created_at: "2026-09-01T00:00:00Z" },
];

const LIVE_RUN_ID = "run_live_1";
const DECISION_TIME = "2026-09-08T06:00:03Z";

/** 实时事件序列（含一条 heartbeat，用于断言心跳不渲染成条目） */
const LIVE_EVENTS: ClosedLoopEventData[] = [
  { event: "run_started", run_id: LIVE_RUN_ID, started_at: "2026-09-08T06:00:00Z" },
  { event: "stage_started", run_id: LIVE_RUN_ID, stage: "collection", name: "实时采集", index: 0, total: 3, started_at: "2026-09-08T06:00:00Z" },
  { event: "heartbeat", run_id: LIVE_RUN_ID },
  {
    event: "stage_decision",
    run_id: LIVE_RUN_ID,
    stage: "collection",
    agent: "采集 Agent",
    decision: "采集 2 个数据源共 4 条新内容",
    detail: "成功 2 · 失败 0",
    status: "ok",
    finished_at: DECISION_TIME,
    duration_ms: 1500,
  },
  { event: "stage_finished", run_id: LIVE_RUN_ID, stage: "collection", status: "ok", detail: "采集完成", duration_ms: 3200, finished_at: DECISION_TIME },
  { event: "run_finished", run_id: LIVE_RUN_ID, status: "ok", summary: "闭环完成：**3** 个阶段全部成功", finished_at: "2026-09-08T06:00:08Z", duration_ms: 8200 },
];

const HISTORY_RUN: ClosedLoopRunItem = {
  run_id: "run_old_9",
  status: "ok",
  params: { collect: false },
  summary: "历史运行完成",
  started_at: "2026-09-07T02:00:00Z",
  finished_at: "2026-09-07T02:00:12Z",
  duration_ms: 12000,
};

const REPLAY_DETAIL: ClosedLoopRunDetail = {
  ...HISTORY_RUN,
  events: [
    { event: "run_started", run_id: "run_old_9", started_at: "2026-09-07T02:00:00Z" },
    { event: "stage_started", run_id: "run_old_9", stage: "governance", name: "知识治理", index: 1, total: 3, started_at: "2026-09-07T02:00:00Z" },
    {
      event: "stage_decision",
      run_id: "run_old_9",
      stage: "governance",
      agent: "知识治理 Agent",
      decision: "回放决策：治理 3 条缺失部门",
      detail: "缺失部门 3 条已回填",
      status: "partial",
      finished_at: "2026-09-07T02:00:04Z",
      duration_ms: 2400,
    },
    { event: "stage_finished", run_id: "run_old_9", stage: "governance", status: "partial", detail: "部分回填", duration_ms: 2600, finished_at: "2026-09-07T02:00:05Z" },
    { event: "run_finished", run_id: "run_old_9", status: "ok", summary: "历史运行完成", finished_at: "2026-09-07T02:00:12Z", duration_ms: 12000 },
  ],
};

/** 点击「一键运行闭环」并等待配置面板就绪 */
async function openConfigPanel(): Promise<void> {
  fireEvent.click(screen.getByText("一键运行闭环"));
  await screen.findByTestId("schema-field-collect");
}

/**
 * 时间线作用域查询：
 * antd Modal 关闭后其最后一次渲染的内容在 jsdom 中不会卸载（leave 动画永不结束），
 * 且 SchemaForm 的分组标题与阶段名可能同名，故时间线断言统一限定在时间线容器内。
 */
function timeline() {
  return within(screen.getByTestId("decision-timeline"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.listSources.mockResolvedValue({ sources: SOURCES, total: SOURCES.length });
  mockedApi.listReviewTasks.mockResolvedValue({ tasks: [], total: 3 });
  mockedApi.listKnowledgeGraph.mockResolvedValue({ entities: [], relations: [], entity_count: 5, relation_count: 6 });
  mockedApi.listInsights.mockResolvedValue({ reports: [], total: 4 });
  mockedApi.getKnowledgeHealth.mockResolvedValue(HEALTH);
  mockedApi.listDecisions.mockResolvedValue({ runs: [], total: 0 });
  mockedApi.listClosedLoopRuns.mockResolvedValue({ runs: [], total: 0 });
  mockedApi.getConfigSchema.mockResolvedValue(SCHEMA);
  mockedApi.listSourceColumns.mockResolvedValue({ source_id: "src_1", columns: [], generated_at: "2026-09-08T00:00:00Z", cached: false });
  mockedApi.streamClosedLoop.mockResolvedValue({
    run_id: LIVE_RUN_ID,
    terminal: "run_finished",
    status: "ok",
    summary: "闭环执行完成",
  });
  mockedApi.getClosedLoopRun.mockResolvedValue(REPLAY_DETAIL);
  mockedApi.cancelClosedLoopRun.mockResolvedValue({ run_id: LIVE_RUN_ID, cancel_requested: true });
  mockedApi.seedDemo.mockResolvedValue({ created: 0, skipped: 0 });
  mockedApi.listKnowledgeObjects.mockResolvedValue({ objects: [], total: 0 });
});

describe("ClosedLoop 流式运行", () => {
  it("SSE 事件逐条驱动时间线：阶段名 / 决策文本 / HH:mm:ss 时刻 / x.xs 耗时，且 heartbeat 不成为条目", async () => {
    let releaseStream: (() => void) | null = null;
    mockedApi.streamClosedLoop.mockImplementation(
      async (
        _config: ClosedLoopConfig,
        onEvent: (event: ClosedLoopEventName, data: ClosedLoopEventData) => void,
      ) => {
        // 前两帧先到：时间线应已“生长”出阶段头
        onEvent("run_started", LIVE_EVENTS[0]);
        onEvent("stage_started", LIVE_EVENTS[1]);
        await new Promise<void>((resolve) => {
          releaseStream = resolve;
        });
        onEvent("heartbeat", LIVE_EVENTS[2]);
        onEvent("stage_decision", LIVE_EVENTS[3]);
        onEvent("stage_finished", LIVE_EVENTS[4]);
        onEvent("run_finished", LIVE_EVENTS[5]);
        return {
          run_id: LIVE_RUN_ID,
          terminal: "run_finished" as const,
          status: "ok" as const,
          summary: "闭环执行完成",
        };
      },
    );

    const { container } = render(<ClosedLoop />);
    expect(screen.getAllByText("尚未开始").length).toBeGreaterThan(0);

    await openConfigPanel();
    fireEvent.click(screen.getByText("确定并开始"));

    // ① 流未结束时：阶段头已出现（说明是增量渲染，不是等整批）
    await waitFor(() => {
      expect(timeline().getByText("实时采集")).toBeInTheDocument();
    });
    expect(timeline().queryByText("采集 2 个数据源共 4 条新内容")).toBeNull();
    expect(screen.queryByText("尚未开始")).toBeNull();

    // ② 放行剩余帧
    expect(releaseStream).not.toBeNull();
    (releaseStream as unknown as () => void)();

    // ③ 决策条目 + 右侧「完成时刻 · 耗时」
    expect(await timeline().findByText("采集 2 个数据源共 4 条新内容")).toBeInTheDocument();
    expect(timeline().getByText("成功 2 · 失败 0")).toBeInTheDocument();
    expect(timeline().getAllByText(formatTime(DECISION_TIME)).length).toBeGreaterThan(0);
    expect(timeline().getByText("1.5s")).toBeInTheDocument();
    expect(timeline().getByText("3.2s")).toBeInTheDocument();
    expect(timeline().getByText("8.2s")).toBeInTheDocument();
    // 时间戳形态 HH:mm:ss（与 formatTime 一致，避免时区耦合）
    expect(timeline().getAllByText(/^\d{2}:\d{2}:\d{2}$/).length).toBeGreaterThan(0);
    // ④ 结尾总结：Markdown 由 DashboardMarkdown 渲染，不裸显 **
    expect(timeline().getByText("运行结束")).toBeInTheDocument();
    expect(container.textContent).not.toContain("**");

    // ⑤ heartbeat 不渲染成时间线条目：6 帧事件中 5 帧是业务步骤
    await waitFor(() => {
      expect(container.querySelectorAll(".ant-timeline-item").length).toBe(5);
    });
    expect(container.textContent).not.toContain("heartbeat");
  });

  it("配置面板：按 Schema 分组渲染，勾选 collect 后 visible_if 字段才出现并给出风险提示", async () => {
    render(<ClosedLoop />);

    expect(screen.queryByTestId("schema-field-collect")).toBeNull();
    await openConfigPanel();

    // 分组标题 + 非联动字段
    expect(mockedApi.getConfigSchema).toHaveBeenCalledWith("closed-loop");
    expect(screen.getByText("实时采集")).toBeInTheDocument();
    expect(screen.getByText("问答与运营")).toBeInTheDocument();
    expect(screen.getByTestId("schema-field-collect")).toBeInTheDocument();
    expect(screen.getByTestId("schema-field-gen_insight")).toBeInTheDocument();
    // visible_if={"collect": true}：未勾选时不渲染
    expect(screen.queryByTestId("schema-field-source_ids")).toBeNull();
    expect(screen.queryByTestId("schema-field-max_pages")).toBeNull();

    fireEvent.click(within(screen.getByTestId("schema-field-collect")).getByRole("switch"));

    await waitFor(() => {
      expect(screen.getByTestId("schema-field-source_ids")).toBeInTheDocument();
    });
    expect(screen.getByTestId("schema-field-max_pages")).toBeInTheDocument();
    // 风险提示：未选数据源 = 全部 active 源（2 个），每源 1 页
    expect(await screen.findByText(/将访问 2 个外部数据源（每源最多 1 页）/)).toBeInTheDocument();
  });

  it("点「一键运行闭环」先弹配置面板，确认后 streamClosedLoop 带上面板中设定的参数", async () => {
    // 流保持挂起：便于断言"确认后进入运行态"（不依赖竞速）
    mockedApi.streamClosedLoop.mockImplementation(async () => new Promise<never>(() => {}));
    render(<ClosedLoop />);
    await openConfigPanel();

    // 面板内修改：勾选实时采集 + 每源页数 3
    fireEvent.click(within(screen.getByTestId("schema-field-collect")).getByRole("switch"));
    const pagesInput = await screen.findByRole("spinbutton");
    fireEvent.change(pagesInput, { target: { value: "3" } });

    expect(mockedApi.streamClosedLoop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("确定并开始"));

    await waitFor(() => {
      expect(mockedApi.streamClosedLoop).toHaveBeenCalledTimes(1);
    });
    const config = mockedApi.streamClosedLoop.mock.calls[0][0];
    expect(config).toMatchObject({ collect: true, max_pages: 3, gen_insight: true, source_ids: [] });
    // 面板确认后进入运行态（弹窗内容在 jsdom 中不会真正卸载，改为断言语义结果）
    expect(await screen.findByText("运行中…")).toBeInTheDocument();
    expect(screen.getByText("当前阶段：准备中")).toBeInTheDocument();
  });

  it("历史回放：选择历史运行后用同一个 DecisionTimeline 渲染（同构）", async () => {
    mockedApi.listClosedLoopRuns.mockResolvedValue({ runs: [HISTORY_RUN], total: 1 });
    const { container } = render(<ClosedLoop />);

    // 已渲染同一个时间线组件（实时视图）
    expect(await screen.findByTestId("decision-timeline")).toBeInTheDocument();

    // 打开运行历史下拉并选择历史 run（下拉在 portal 中，选项文案会同时命中 wrapper 与 content）
    fireEvent.mouseDown(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(document.querySelectorAll(".ant-select-item-option").length).toBe(1);
    });
    expect(document.querySelector(".ant-select-item-option")?.textContent).toContain("run_old_9");
    fireEvent.click(document.querySelectorAll(".ant-select-item-option")[0]);

    await waitFor(() => {
      expect(mockedApi.getClosedLoopRun).toHaveBeenCalledWith("run_old_9");
    });

    // 同一个时间线组件 + 回放标识 + 回放决策条目与耗时
    expect(await screen.findByText("历史回放")).toBeInTheDocument();
    expect(screen.getByTestId("decision-timeline")).toBeInTheDocument();
    expect(await timeline().findByText("回放决策：治理 3 条缺失部门")).toBeInTheDocument();
    expect(timeline().getByText("2.4s")).toBeInTheDocument();
    expect(timeline().getAllByText(formatTime("2026-09-07T02:00:04Z")).length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".ant-timeline-item").length).toBe(5);
  });

  it("运行中可请求取消（调 cancelClosedLoopRun，提示阶段结束后停止）", async () => {
    mockedApi.streamClosedLoop.mockImplementation(
      async (
        _config: ClosedLoopConfig,
        onEvent: (event: ClosedLoopEventName, data: ClosedLoopEventData) => void,
      ) => {
        onEvent("run_started", LIVE_EVENTS[0]);
        return new Promise<never>(() => {});
      },
    );

    render(<ClosedLoop />);
    await openConfigPanel();
    fireEvent.click(screen.getByText("确定并开始"));

    expect(await screen.findByText("运行中…")).toBeInTheDocument();
    expect(await screen.findByText(`run_id=${LIVE_RUN_ID}`)).toBeInTheDocument();

    fireEvent.click(screen.getByText("取消运行"));
    await waitFor(() => {
      expect(mockedApi.cancelClosedLoopRun).toHaveBeenCalledWith(LIVE_RUN_ID);
    });
  });

  it("流异常中断：已拿到 run_id 时按运行记录补齐事件并提示", async () => {
    const interrupted: ClosedLoopRunDetail = {
      run_id: LIVE_RUN_ID,
      status: "partial",
      params: { collect: true },
      summary: "中断前的运行记录",
      events: [
        { event: "run_started", run_id: LIVE_RUN_ID, started_at: "2026-09-08T06:00:00Z" },
        {
          event: "stage_decision",
          run_id: LIVE_RUN_ID,
          stage: "collection",
          agent: "采集 Agent",
          decision: "补齐后的采集决策",
          detail: "来自运行记录",
          status: "partial",
          finished_at: "2026-09-08T06:00:05Z",
          duration_ms: 900,
        },
      ],
    };
    mockedApi.getClosedLoopRun.mockResolvedValue(interrupted);
    mockedApi.streamClosedLoop.mockImplementation(
      async (
        _config: ClosedLoopConfig,
        onEvent: (event: ClosedLoopEventName, data: ClosedLoopEventData) => void,
      ) => {
        onEvent("run_started", LIVE_EVENTS[0]);
        throw new Error("网络中断");
      },
    );

    render(<ClosedLoop />);
    await openConfigPanel();
    fireEvent.click(screen.getByText("确定并开始"));

    expect(await screen.findByText("连接中断，已按运行记录补齐")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedApi.getClosedLoopRun).toHaveBeenCalledWith(LIVE_RUN_ID);
    });
    expect(await timeline().findByText("补齐后的采集决策")).toBeInTheDocument();
    expect(timeline().getByText("0.9s")).toBeInTheDocument();
  });

  it("409：提示已有进行中的闭环运行并带上 run_id", async () => {
    mockedApi.streamClosedLoop.mockRejectedValue(new Error("已有进行中的闭环运行"));
    mockedApi.listClosedLoopRuns.mockResolvedValue({
      runs: [{ ...HISTORY_RUN, run_id: "run_busy", status: "running" }],
      total: 1,
    });

    render(<ClosedLoop />);
    await openConfigPanel();
    fireEvent.click(screen.getByText("确定并开始"));

    expect(await screen.findByText("已有进行中的闭环运行（run_id=run_busy）")).toBeInTheDocument();
  });

  it("422：把后端 detail[].message 逐条展示给用户", async () => {
    mockedApi.streamClosedLoop.mockRejectedValue(
      new Error("max_pages: 不得大于 5; since: 格式应为 YYYY-MM-DD"),
    );

    render(<ClosedLoop />);
    await openConfigPanel();
    fireEvent.click(screen.getByText("确定并开始"));

    expect(await screen.findByText("闭环运行失败")).toBeInTheDocument();
    expect(screen.getByText("max_pages: 不得大于 5")).toBeInTheDocument();
    expect(screen.getByText("since: 格式应为 YYYY-MM-DD")).toBeInTheDocument();
  });
});

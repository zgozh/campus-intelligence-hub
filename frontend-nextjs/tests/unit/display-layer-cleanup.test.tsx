// @vitest-environment jsdom
/**
 * B6 展示层残留清零 —— 渲染护栏（REFACTOR_PLAN_V2_2 B6/T8）
 *
 * 判定规则（冻结，见 src/utils/format.ts 文件头）：
 * - 标题类（列表/表格单元格、Drawer 标题、引用 title/summary、Alert message）→ 清洗成纯文本；
 * - 正文类（知识对象正文、问答回答）→ DashboardMarkdown 渲染；
 * - 时间一律 formatDateTime（YYYY-MM-DD HH:mm:ss）/ formatTime（HH:mm:ss）。
 *
 * 断言口径：
 * 1) 传入含 `**` 的标题/摘要与含微秒+时区的 ISO 时间戳，渲染结果里
 *    **不得出现 `**`**，且时间必须形如 `YYYY-MM-DD HH:mm:ss`（并与 formatDateTime 一致）；
 * 2) 正文类内容必须渲染成富文本（<strong>），而不是把标记原样吐出。
 *
 * Run with: npx vitest run tests/unit/display-layer-cleanup.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import Jobs from "../../src/views/Jobs";
import Changes from "../../src/views/Changes";
import KnowledgeObjects from "../../src/views/KnowledgeObjects";
import AskAI from "../../src/views/AskAI";
import DiffViewer from "../../src/components/DiffViewer";
import { formatDateTime } from "../../src/utils/format";
import type { AskResponse, ChangeDetail, ChangeEvent, CollectionJob, KnowledgeObject } from "../../src/services/api";

const mocks = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listChanges: vi.fn(),
  getChangeDiff: vi.fn(),
  listKnowledgeObjects: vi.fn(),
  publishKo: vi.fn(),
  archiveKo: vi.fn(),
  editKo: vi.fn(),
  createKo: vi.fn(),
  batchArchiveKo: vi.fn(),
  archiveExpiredKo: vi.fn(),
  ingestKnowledgeObjectFile: vi.fn(),
  askQuestion: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({ api: mocks }));

// jsdom 未实现 Element.prototype.scrollTo（AskAI 的"自动滚到底部"会用到），就地补桩
Object.defineProperty(Element.prototype, "scrollTo", {
  writable: true,
  value: vi.fn(),
});

/** 与后端同构的输入：带微秒 + UTC 时区 */
const ISO_MICROS = "2026-09-08T14:07:42.033674+00:00";
/** 展示层唯一合法形态 */
const DATETIME_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** 断言文本是 formatDateTime 的形态且与统一出口逐一相等（避免时区耦合） */
function expectUnifiedDateTime(text: string | null, iso: string): void {
  expect(text).toBeTruthy();
  const value = String(text);
  expect(value).toBe(formatDateTime(iso));
  expect(value).toMatch(DATETIME_SHAPE);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("B6 时间统一出口（不再出现裸 ISO / 本地 toLocaleString）", () => {
  it("Jobs：开始/结束时间走 formatDateTime（YYYY-MM-DD HH:mm:ss）", async () => {
    const job: CollectionJob = {
      id: "job_1",
      source_id: "src_1",
      status: "SUCCESS",
      stage_trace: { Fetch: "ok", Parse: "ok" },
      result: { fetched: 4, indexed: 3 },
      created_at: ISO_MICROS,
      started_at: ISO_MICROS,
      completed_at: "2026-09-08T14:07:52.100000+00:00",
    };
    mocks.listJobs.mockResolvedValue({ jobs: [job], total: 1 });

    const { container } = render(<Jobs />);

    await waitFor(() => {
      expect(container.textContent).toContain(formatDateTime(ISO_MICROS));
    });
    // 展示层不得再露出裸 ISO 串（未本地化）
    expect(container.textContent).not.toContain("2026-09-08T14:07:42.033674");
    // 开始/结束两处时间都是统一形态
    const timeLine = screen.getByText(/^开始 .+ · 结束 .+$/);
    expect(timeLine.textContent).toContain(`开始 ${formatDateTime(ISO_MICROS)}`);
    expect(timeLine.textContent).toMatch(/开始 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} · 结束 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(formatDateTime(ISO_MICROS)).toMatch(DATETIME_SHAPE);
  });

  it("Changes：时间列走 formatDateTime，变更摘要清洗 Markdown", async () => {
    const change: ChangeEvent = {
      id: "chg_1",
      source_id: "src_1",
      source_name: "教务处通知",
      old_version: 1,
      new_version: 2,
      change_type: ["TITLE_CHANGED"],
      severity: "HIGH",
      diff_summary: "**校务知识洞察**：标题变更",
      detected_at: ISO_MICROS,
    };
    mocks.listChanges.mockResolvedValue({ changes: [change], total: 1 });

    const { container } = render(<Changes />);

    // 摘要清洗：`**` 不再出现，文本保留
    expect(await screen.findByText("校务知识洞察：标题变更")).toBeInTheDocument();
    expect(container.textContent).not.toContain("**");
    // 时间列统一形态
    expect(screen.getByText(formatDateTime(ISO_MICROS))).toBeInTheDocument();
    expect(formatDateTime(ISO_MICROS)).toMatch(DATETIME_SHAPE);
  });

  it("DiffViewer：检测时刻走 formatDateTime，前后标题清洗 Markdown", () => {
    const detail: ChangeDetail = {
      id: "chg_1",
      source_id: "src_1",
      source_name: "教务处通知",
      change_type: ["TITLE_CHANGED"],
      severity: "MEDIUM",
      diff_summary: "**要点**：标题调整",
      detected_at: ISO_MICROS,
      title_before: "**关于 2026 学年** 选课通知",
      title_after: "__关于 2026 学年__ 选课安排",
      changes: [],
    };

    const { container } = render(<DiffViewer detail={detail} />);

    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("__");
    expect(screen.getByText("关于 2026 学年 选课通知")).toBeInTheDocument();
    expect(screen.getByText("关于 2026 学年 选课安排")).toBeInTheDocument();
    expectUnifiedDateTime(screen.getByText(formatDateTime(ISO_MICROS)).textContent, ISO_MICROS);
  });
});

describe("B6 标题清洗 / 正文渲染判定", () => {
  it("KnowledgeObjects：表格标题与 Drawer 标题清洗，正文区渲染 Markdown", async () => {
    const ko: KnowledgeObject = {
      id: "ko_1",
      type: "Announcement",
      title: "**校务知识洞察**（2026 秋季）",
      department: "教务处",
      status: "PUBLISHED",
      version: 1,
      effective_from: "2026-09-01",
      effective_to: "2026-12-31",
      content: "## 正文标题\n\n**重点**：请于 9 月 10 日前完成选课。",
    };
    mocks.listKnowledgeObjects.mockResolvedValue({ objects: [ko], total: 1 });

    const { container } = render(<KnowledgeObjects />);

    // 表格单元格 = 标题类 → 清洗
    const cell = await screen.findByText("校务知识洞察（2026 秋季）");
    expect(cell).toBeInTheDocument();
    expect(container.textContent).not.toContain("**");

    // 点行打开 Drawer：标题同样清洗，正文渲染成富文本（<strong>）而非裸标记
    fireEvent.click(cell);
    await waitFor(() => {
      expect(document.querySelector(".ant-drawer-title")).not.toBeNull();
    });
    expect(document.querySelector(".ant-drawer-title")?.textContent).toBe("校务知识洞察（2026 秋季）");
    expect(document.body.textContent).not.toContain("**");
    expect(document.querySelector(".ant-drawer-body strong")?.textContent).toBe("重点");
    expect(document.querySelector(".ant-drawer-body h2")?.textContent).toBe("正文标题");
  });

  it("AskAI：引用 title/summary 清洗；回答正文渲染 Markdown", async () => {
    const answer: AskResponse = {
      query: "选课时间",
      answer: "**答案要点**：选课时间为 9 月 1 日。",
      citations: [
        {
          id: "c1",
          title: "**教务处**：2026 秋季选课通知",
          summary: "本轮选课 **9 月 1 日** 开始，逾期不补。",
          type: "url",
          url: "https://www.gzhu.edu.cn/z__l/tzgg.htm",
          freshness: "Fresh",
        },
      ],
      intent: "policy_lookup",
    };
    mocks.askQuestion.mockResolvedValue(answer);

    const { container } = render(<AskAI />);

    const input = screen.getByPlaceholderText("输入问题，回车发送");
    fireEvent.change(input, { target: { value: "选课时间" } });
    // antd 会在两个中文字之间插空格（发 送），用宽松匹配
    fireEvent.click(screen.getByRole("button", { name: /发\s*送/ }));

    // 回答正文：Markdown 渲染（<strong>），不留 `**`
    expect(await screen.findByText("答案要点")).toBeInTheDocument();
    expect(container.textContent).not.toContain("**");

    // 展开引用面板（antd Collapse 默认惰性渲染）
    fireEvent.click(screen.getByText(/来源引用/));

    expect(await screen.findByText("[1] 教务处：2026 秋季选课通知")).toBeInTheDocument();
    // 摘要只去标记、不截断：`**9 月 1 日**` → `9 月 1 日`（标记两侧空格原样保留）
    expect(await screen.findByText("本轮选课 9 月 1 日 开始，逾期不补。")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("**");
  });
});

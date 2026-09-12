/**
 * Unit tests for Sources - guards against runtime render crashes (e.g. missing imports)
 * plus T13 采集面板升级：栏目动态发现 / 时间筛选 / 刷新监控反馈。
 * Run with: vitest run tests/unit/sources.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Sources from "../../src/views/Sources";

const mocks = vi.hoisted(() => ({
  listSources: vi.fn(),
  monitorSources: vi.fn(),
  listSourceColumns: vi.fn(),
  runSource: vi.fn(),
  pauseSource: vi.fn(),
  deleteSource: vi.fn(),
  createSource: vi.fn(),
  generateBrief: vi.fn(),
  recommendSources: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({
  api: {
    listSources: mocks.listSources,
    monitorSources: mocks.monitorSources,
    listSourceColumns: mocks.listSourceColumns,
    runSource: mocks.runSource,
    pauseSource: mocks.pauseSource,
    deleteSource: mocks.deleteSource,
    createSource: mocks.createSource,
    generateBrief: mocks.generateBrief,
    recommendSources: mocks.recommendSources,
  },
}));

const SOURCE = {
  id: "s1",
  name: "广州大学通知公告",
  source_type: "list_page",
  base_url: "https://www.gzhu.edu.cn/z__l/tzgg.htm",
  status: "active",
  last_success_at: "2026-09-08T02:30:00+00:00",
  last_crawled_at: "2026-09-08T02:31:00+00:00",
  last_error: null,
  created_at: "2026-09-01T00:00:00+00:00",
};

/** 与视图同源的日期折算（本地时区） */
function localDate(offsetDays: number): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("Sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSources.mockResolvedValue({ sources: [], total: 0 });
    mocks.monitorSources.mockResolvedValue({
      recent_days: 7,
      total_new: 0,
      sources: 0,
      refreshed_at: "2026-09-08T02:00:00+00:00",
      items: [],
    });
    mocks.listSourceColumns.mockResolvedValue({
      source_id: "s1",
      columns: [],
      generated_at: "2026-09-08T02:00:00+00:00",
      cached: false,
    });
    mocks.runSource.mockResolvedValue({ job_id: "job-1", status: "PENDING" });
  });

  it("renders WITHOUT crashing (title + monitor card)", async () => {
    render(<Sources />);
    expect(await screen.findByText("数据源管理")).toBeTruthy();
    // 监控卡片标题（含"数据源监控"）
    expect(await screen.findByText(/数据源监控/)).toBeTruthy();
  });

  it("栏目下拉选项来自 api.listSourceColumns（不是硬编码常量）", async () => {
    mocks.listSources.mockResolvedValue({ sources: [SOURCE], total: 1 });
    mocks.listSourceColumns.mockResolvedValue({
      source_id: "s1",
      columns: [
        { value: "通知公告", label: "通知公告 (42)", count: 42, origin: "history" },
        { value: "科研动态", label: "科研动态 (0)", count: 0, origin: "adapter" },
      ],
      generated_at: "2026-09-08T02:00:00+00:00",
      cached: false,
    });
    render(<Sources />);

    fireEvent.click(await screen.findByRole("button", { name: /^采\s*集$/ }));
    expect(await screen.findByText(/采集「广州大学通知公告」/)).toBeTruthy();
    await waitFor(() => {
      expect(mocks.listSourceColumns).toHaveBeenCalledWith("s1", false);
    });

    // 打开栏目下拉，选项必须来自接口返回
    fireEvent.mouseDown(screen.getByRole("combobox"));
    expect(await screen.findByText("通知公告 (42)")).toBeTruthy();
    expect(await screen.findByText("科研动态 (0)（暂未采集到内容）")).toBeTruthy();
  });

  it("选择「近 7 天」提交时，runSource 第 4 参数带正确的 since/until", async () => {
    mocks.listSources.mockResolvedValue({ sources: [SOURCE], total: 1 });
    render(<Sources />);

    fireEvent.click(await screen.findByRole("button", { name: /^采\s*集$/ }));
    await screen.findByText(/采集「广州大学通知公告」/);

    fireEvent.click(screen.getByText("近 7 天"));
    // 弹窗内展示折算后的实际请求参数
    expect(await screen.findByText(/将按 \d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2} 过滤/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /确认采集/ }));

    await waitFor(() => {
      expect(mocks.runSource).toHaveBeenCalledWith(
        "s1",
        1,
        undefined,
        expect.objectContaining({ since: localDate(6), until: localDate(0) }),
      );
    });
  });

  it("点「刷新监控」后有确定反馈（已更新）并同步刷新数据源表格", async () => {
    render(<Sources />);
    await waitFor(() => {
      expect(mocks.listSources).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /刷新监控/ }));

    expect(await screen.findByText(/已更新/)).toBeTruthy();
    await waitFor(() => {
      expect(mocks.listSources).toHaveBeenCalledTimes(2);
    });
  });

  it("栏目接口失败时回退为「全部内容」并给出可见提示（不静默、不崩溃）", async () => {
    mocks.listSources.mockResolvedValue({ sources: [SOURCE], total: 1 });
    mocks.listSourceColumns.mockRejectedValue(new Error("500 Internal Server Error"));
    render(<Sources />);

    fireEvent.click(await screen.findByRole("button", { name: /^采\s*集$/ }));

    expect(await screen.findByText(/栏目加载失败，已回退为「全部内容」/)).toBeTruthy();
    expect(screen.getByText("全部内容")).toBeTruthy();
  });

  it("无成功采集记录时「仅采新内容」禁用并提示原因", async () => {
    mocks.listSources.mockResolvedValue({ sources: [{ ...SOURCE, last_success_at: null }], total: 1 });
    render(<Sources />);

    fireEvent.click(await screen.findByRole("button", { name: /^采\s*集$/ }));

    expect(await screen.findByText("该源尚无成功采集记录")).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: /仅采集晚于上次成功采集的新内容/ }),
    ).toBeDisabled();
  });
});

/**
 * Unit tests for Sources - guards against runtime render crashes (e.g. missing imports).
 * Run with: vitest run tests/unit/sources.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Sources from "../../src/views/Sources";

vi.mock("../../src/services/api", () => ({
  api: {
    listSources: vi.fn().mockResolvedValue({ sources: [], total: 0 }),
    monitorSources: vi.fn().mockResolvedValue({ recent_days: 7, total_new: 0, sources: 0, items: [] }),
  },
}));

describe("Sources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders WITHOUT crashing (title + monitor card)", async () => {
    render(<Sources />);
    expect(await screen.findByText("数据源管理")).toBeTruthy();
    // 监控卡片标题（含"数据源监控"）
    expect(await screen.findByText(/数据源监控/)).toBeTruthy();
  });
});

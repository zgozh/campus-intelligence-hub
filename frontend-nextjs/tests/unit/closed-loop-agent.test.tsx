/**
 * Unit tests for ClosedLoop (AI 智能体中心) - agent roster renders + status loaded.
 * Run with: vitest run tests/unit/closed-loop-agent.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ClosedLoop from "../../src/views/ClosedLoop";

vi.mock("../../src/services/api", () => ({
  api: {
    listSources: vi.fn().mockResolvedValue({ sources: [], total: 2 }),
    listReviewTasks: vi.fn().mockResolvedValue({ tasks: [], total: 3 }),
    listKnowledgeGraph: vi.fn().mockResolvedValue({ entity_count: 5, relation_count: 6 }),
    listInsights: vi.fn().mockResolvedValue({ reports: [], total: 4 }),
    getKnowledgeHealth: vi.fn().mockResolvedValue({ health_score: 80 }),
    runClosedLoop: vi.fn().mockResolvedValue({ stages: [], summary: "ok", status: "ok" }),
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
}));

describe("ClosedLoop (AI 智能体中心)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all six agent cards", () => {
    render(<ClosedLoop />);
    ["采集 Agent", "知识治理 Agent", "图谱 Agent", "洞察 Agent", "问答 Agent", "审核助手 Agent"].forEach((name) => {
      expect(screen.getByText(name)).toBeTruthy();
    });
  });

  it("renders the one-click run button", () => {
    render(<ClosedLoop />);
    expect(screen.getByText("一键运行闭环")).toBeTruthy();
  });

  it("loads live status (data source count)", async () => {
    render(<ClosedLoop />);
    await waitFor(() => {
      expect(screen.getByText("数据源 2")).toBeTruthy();
    });
  });
});

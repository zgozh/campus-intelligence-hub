/**
 * Unit tests for Overview (校务智汇中台) - guards against runtime render crashes.
 * Run with: vitest run tests/unit/overview.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Overview from "../../src/views/Overview";

vi.mock("../../src/services/api", () => ({
  api: {
    getKnowledgeHealth: vi.fn().mockResolvedValue({ health_score: 80, coverage: { total: 10, published: 8, expired: 1 }, freshness: { Fresh: 5, Aging: 2, Stale: 1, Unknown: 2 }, source_health: { total: 3, error: 0, ok: 3 }, today: { new: 1, changed: 0, conflicts: 0, review: 1 }, review_backlog: 1, conflict_rate: 0, formula: "" }),
    listChanges: vi.fn().mockResolvedValue({ changes: [], total: 0 }),
    listKnowledgeObjects: vi.fn().mockResolvedValue({ objects: [], total: 0 }),
    listInsights: vi.fn().mockResolvedValue({ reports: [], total: 0 }),
    listKnowledgeGraph: vi.fn().mockResolvedValue({ entities: [], relations: [], entity_count: 0, relation_count: 0 }),
  },
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => () => {} }));

describe("Overview (校务智汇中台)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders WITHOUT crashing (title + quick actions)", async () => {
    render(<Overview />);
    expect(await screen.findByText("校务智汇中台")).toBeTruthy();
    expect(screen.getByText("快捷操作：")).toBeTruthy();
  });
});

/**
 * Unit tests for DashboardMarkdown - ensures markdown renders to rich text (no `**` leakage).
 * Run with: vitest run tests/unit/campus-markdown.test.tsx
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardMarkdown from "../../src/components/DashboardMarkdown";

describe("DashboardMarkdown", () => {
  it("renders bold markdown without leaking ** markers", () => {
    render(<DashboardMarkdown content={"**重点**内容"} />);
    expect(screen.getByText("重点")).toBeTruthy();
    expect(screen.queryByText("**")).toBeNull();
  });

  it("renders unordered list items", () => {
    render(<DashboardMarkdown content={"- 项目一\n- 项目二"} />);
    expect(screen.getByText("项目一")).toBeTruthy();
    expect(screen.getByText("项目二")).toBeTruthy();
  });

  it("renders inline code without backtick leakage", () => {
    const { container } = render(<DashboardMarkdown content={"路径 `app/api` 到 `services`"} />);
    expect(container.querySelector("code")).toBeTruthy();
  });
});

/**
 * T11-7 通知中心页：kind 分类筛选 Tabs、全部已读、点击条目按 link 跳转。
 * Run with: vitest run tests/unit/Notifications.kindTabs.test.tsx
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Notifications from "../../src/views/Notifications";

const mocks = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  readAllNotifications: vi.fn(),
  checkAlerts: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../src/services/api", () => ({
  api: {
    listNotifications: mocks.listNotifications,
    markNotificationRead: mocks.markNotificationRead,
    readAllNotifications: mocks.readAllNotifications,
    checkAlerts: mocks.checkAlerts,
  },
}));

const ITEMS = [
  {
    id: "n1",
    kind: "brief",
    title: "**校务快讯**（近 7 天）",
    content: "正文摘要",
    read: false,
    link: "/sources",
    created_at: "2026-09-08T02:30:00+00:00",
  },
];

describe("Notifications 通知中心页（T11-7）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listNotifications.mockResolvedValue({ notifications: ITEMS, total: 1 });
    mocks.markNotificationRead.mockResolvedValue({ id: "n1", read: true });
    mocks.readAllNotifications.mockResolvedValue({ updated: 1 });
  });

  it("默认拉取全部通知，标题清洗为去 Markdown 的纯文本", async () => {
    render(<Notifications />);
    await waitFor(() => {
      expect(mocks.listNotifications).toHaveBeenCalledWith(50, false, undefined);
    });
    expect(await screen.findByText("校务快讯（近 7 天）")).toBeTruthy();
  });

  it("切换到「快讯」Tab 时按 kind=brief 过滤", async () => {
    render(<Notifications />);
    await waitFor(() => {
      expect(mocks.listNotifications).toHaveBeenCalledWith(50, false, undefined);
    });

    fireEvent.click(screen.getByRole("tab", { name: "快讯" }));

    await waitFor(() => {
      expect(mocks.listNotifications).toHaveBeenCalledWith(50, false, "brief");
    });
  });

  it("点「全部已读」调用 readAllNotifications 并刷新列表", async () => {
    render(<Notifications />);
    await screen.findByText("校务快讯（近 7 天）");
    const before = mocks.listNotifications.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /全部已读/ }));

    await waitFor(() => {
      expect(mocks.readAllNotifications).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mocks.listNotifications.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it("点击条目按 link 跳转，并标记已读", async () => {
    render(<Notifications />);
    fireEvent.click(await screen.findByText("校务快讯（近 7 天）"));

    await waitFor(() => {
      expect(mocks.markNotificationRead).toHaveBeenCalledWith("n1");
    });
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/sources");
    });
  });
});

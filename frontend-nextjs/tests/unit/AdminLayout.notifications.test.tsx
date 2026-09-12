/**
 * T11 通知中心修复：右上角铃铛点击必展开、失败可见可重试、点击条目已读+跳转、全部已读、30s 轮询。
 * Run with: vitest run tests/unit/AdminLayout.notifications.test.tsx
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AdminLayout from "../../src/components/AdminLayout";

const mocks = vi.hoisted(() => ({
  getUnreadCount: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  readAllNotifications: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("../../src/context/AuthContext", () => ({
  useAuth: () => ({
    admin: { id: 1, name: "管理员", email: "admin@campus.local", role: "super_admin" },
    logout: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: "/overview", search: "" }),
}));

vi.mock("../../src/services/api", () => ({
  api: {
    getUnreadCount: mocks.getUnreadCount,
    listNotifications: mocks.listNotifications,
    markNotificationRead: mocks.markNotificationRead,
    readAllNotifications: mocks.readAllNotifications,
  },
}));

const NOTIFICATION = {
  id: "n1",
  kind: "brief",
  title: "校务快讯（近 7 天）",
  content: "正文",
  read: false,
  link: "/sources",
  created_at: "2026-09-08T02:30:00+00:00",
};

function renderLayout() {
  return render(
    <AdminLayout>
      <div>Body</div>
    </AdminLayout>,
  );
}

describe("AdminLayout 通知中心（T11）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUnreadCount.mockResolvedValue({ unread: 3 });
    mocks.listNotifications.mockResolvedValue({ notifications: [NOTIFICATION], total: 1 });
    mocks.markNotificationRead.mockResolvedValue({ id: "n1", read: true });
    mocks.readAllNotifications.mockResolvedValue({ updated: 1 });
  });

  it("点击铃铛后面板展开并显示通知内容（Popover 受控 + 可交互子元素）", async () => {
    renderLayout();

    // 点击前面板未展开（回归防护：旧实现 Badge 包裹导致 trigger 不生效）
    expect(screen.queryByText("校务快讯（近 7 天）")).toBeNull();

    fireEvent.click(screen.getByLabelText("通知中心"));

    expect(await screen.findByText("校务快讯（近 7 天）")).toBeTruthy();
    expect(mocks.listNotifications).toHaveBeenCalled();
  });

  it("接口失败时显示「通知加载失败，点击重试」，点重试会再次拉取列表", async () => {
    mocks.listNotifications.mockRejectedValue(new Error("500 Internal Server Error"));
    renderLayout();

    fireEvent.click(screen.getByLabelText("通知中心"));

    expect(await screen.findByText("通知加载失败，点击重试")).toBeTruthy();
    // antd 会在两个中文字之间插入空格（重 试），故用宽松匹配
    const retry = await screen.findByRole("button", { name: /^重\s*试$/ });
    const before = mocks.listNotifications.mock.calls.length;

    fireEvent.click(retry);

    await waitFor(() => {
      expect(mocks.listNotifications.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it("点击带 link 的通知：标记已读并跳转到该 link", async () => {
    renderLayout();

    fireEvent.click(screen.getByLabelText("通知中心"));
    fireEvent.click(await screen.findByText("校务快讯（近 7 天）"));

    await waitFor(() => {
      expect(mocks.markNotificationRead).toHaveBeenCalledWith("n1");
    });
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/sources");
    });
  });

  it("点击「全部已读」调用 readAllNotifications 并刷新未读数", async () => {
    renderLayout();

    fireEvent.click(screen.getByLabelText("通知中心"));
    const readAll = await screen.findByRole("button", { name: /全部已读/ });
    const unreadCallsBefore = mocks.getUnreadCount.mock.calls.length;

    fireEvent.click(readAll);

    await waitFor(() => {
      expect(mocks.readAllNotifications).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mocks.getUnreadCount.mock.calls.length).toBeGreaterThan(unreadCallsBefore);
    });
  });

  it("未读数 30s 轮询一次，组件卸载后定时器被清理", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderLayout();
      // 初次加载（flush 微任务）
      await act(async () => { await Promise.resolve(); });
      const afterMount = mocks.getUnreadCount.mock.calls.length;
      expect(afterMount).toBeGreaterThanOrEqual(1);

      await act(async () => {
        vi.advanceTimersByTime(30000);
        await Promise.resolve();
      });
      expect(mocks.getUnreadCount.mock.calls.length).toBe(afterMount + 1);

      unmount();
      await act(async () => {
        vi.advanceTimersByTime(30000);
        await Promise.resolve();
      });
      expect(mocks.getUnreadCount.mock.calls.length).toBe(afterMount + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// @vitest-environment jsdom
/**
 * A2 构建版本可见性渲染测试：侧边栏常驻显示构建标识、布局带 data-build、
 * 前后端构建不一致时给出可见提示。
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AdminLayout from "../../src/components/AdminLayout";
import { BUILD_ID } from "../../src/build-info";

const mocks = vi.hoisted(() => ({
  getUnreadCount: vi.fn(),
  listNotifications: vi.fn(),
  getVersion: vi.fn(),
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

vi.mock("../../src/services/api", () => ({
  api: {
    getUnreadCount: mocks.getUnreadCount,
    listNotifications: mocks.listNotifications,
    getVersion: mocks.getVersion,
  },
}));

const renderLayout = () =>
  render(
    <MemoryRouter>
      <AdminLayout>
        <div>Body</div>
      </AdminLayout>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUnreadCount.mockResolvedValue({ unread: 0 });
  mocks.listNotifications.mockResolvedValue({ notifications: [], total: 0 });
  mocks.getVersion.mockResolvedValue({
    name: "campus-intelligence-hub",
    version: "2.2.0",
    build: BUILD_ID,
    commit: "unknown",
    environment: "test",
  });
});

describe("构建版本可见性（A2）", () => {
  it("侧边栏常驻显示构建标识，布局根节点带 data-build", async () => {
    const { container } = renderLayout();

    const buildNode = await screen.findByTestId("build-id");
    expect(buildNode.textContent).toContain(BUILD_ID);
    // 真机探针据此断言"页面跑的是哪个构建"
    expect(container.querySelector(`[data-build="${BUILD_ID}"]`)).not.toBeNull();
  });

  it("后端构建标识与前端不一致时显示提示", async () => {
    mocks.getVersion.mockResolvedValue({
      name: "campus-intelligence-hub",
      version: "2.2.0",
      build: "some-other-build",
      commit: "unknown",
      environment: "test",
    });
    renderLayout();

    await waitFor(() => {
      expect(screen.getByTestId("build-mismatch")).toBeInTheDocument();
    });
  });

  it("版本接口不可用时不影响界面（静默降级）", async () => {
    mocks.getVersion.mockRejectedValue(new Error("network down"));
    renderLayout();

    await screen.findByTestId("build-id");
    expect(screen.queryByTestId("build-mismatch")).toBeNull();
  });
});

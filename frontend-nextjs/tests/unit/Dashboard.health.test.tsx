// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Dashboard from "../../src/views/Dashboard";
import { api } from "../../src/services/api";
import type { KnowledgeHealth } from "../../src/services/api";

// 说明：本文件替代原先的 tests/unit/Dashboard.agentScope.test.tsx——那份断言的是 Basjoo
// 骨架期的「欢迎回到 {agent} 控制台 / navigation.playground」旧 UI；Dashboard 已在
// feb841a（Ant Design 重构）+ 9c2f000（Knowledge Health 首页仪表）后完全变更，
// 旧断言长期为红色，属与展示层重构无关的既有陈旧测试。

const navigateMock = vi.fn();

vi.mock("react-router-dom", () => ({
	useNavigate: () => navigateMock,
}));

vi.mock("../../src/services/api", () => ({
	api: {
		getKnowledgeHealth: vi.fn(),
	},
}));

const mockedApi = vi.mocked(api);

const HEALTH: KnowledgeHealth = {
	health_score: 76,
	formula: "100 - 待审*2 - 冲突*3 - 陈旧占比*40 - 来源异常占比*30 - 过期占比*20",
	today: { new: 5, changed: 2, conflicts: 1, review: 3 },
	coverage: { total: 42, published: 30, expired: 4 },
	freshness: { Fresh: 20, Aging: 6, Stale: 4, Unknown: 12 },
	conflict_rate: 0.03,
	review_backlog: 3,
	source_health: { total: 4, error: 1, ok: 3 },
};

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getKnowledgeHealth.mockResolvedValue(HEALTH);
});

describe("Dashboard 校务概览", () => {
	it("渲染标题与健康度指标（来自 Knowledge Health 接口）", async () => {
		render(<Dashboard />);

		await waitFor(() => {
			expect(screen.getByText("校务知识健康度")).toBeInTheDocument();
		});
		expect(screen.getByText("校务智汇中台")).toBeInTheDocument();
		expect(screen.getByText("76")).toBeInTheDocument();
		expect(screen.getByText("42")).toBeInTheDocument(); // 知识总量
		expect(screen.getByText("3/4")).toBeInTheDocument(); // 来源健康 ok/total
		expect(mockedApi.getKnowledgeHealth).toHaveBeenCalledTimes(1);
	});

	it("接口失败时不崩溃（首页仍可渲染）", async () => {
		mockedApi.getKnowledgeHealth.mockRejectedValueOnce(new Error("boom"));
		render(<Dashboard />);

		await waitFor(() => {
			expect(screen.getByText("校务智汇中台")).toBeInTheDocument();
		});
		expect(screen.getByText("知识总量")).toBeInTheDocument();
	});

	it("点击快捷入口卡片跳转到对应页面", async () => {
		render(<Dashboard />);

		fireEvent.click(await screen.findByText("数据源管理"));

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith("/sources");
		});
	});
});

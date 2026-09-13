// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AdminLayout from "../../src/components/AdminLayout";

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
		getUnreadCount: vi.fn().mockResolvedValue({ unread: 2 }),
		listNotifications: vi.fn().mockResolvedValue({ notifications: [], total: 0 }),
		// A2：布局挂载时会查后端构建版本；不 mock 会抛错
		getVersion: vi.fn().mockResolvedValue({
			name: "campus-intelligence-hub",
			version: "2.2.0",
			build: "dev",
			commit: "unknown",
			environment: "test",
		}),
	},
}));

describe("AdminLayout (校务智汇中台)", () => {
	beforeEach(() => vi.clearAllMocks());

	it("renders brand + children WITHOUT crashing", () => {
		render(
			<MemoryRouter>
				<AdminLayout>
					<div>Body</div>
				</AdminLayout>
			</MemoryRouter>,
		);
		expect(screen.getByText("校务智汇中台")).toBeTruthy();
		expect(screen.getByText("Body")).toBeTruthy();
	});
});

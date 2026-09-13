// @vitest-environment jsdom
/**
 * B1 结构化 API 错误 + B5 流式终态归一化测试
 *
 * 目标：409 不再"猜" run_id、422 能按字段定位、run_error 不再被当成"执行完成"，
 * 同时保证 `.message` 与改造前逐字一致（既有 catch 方零改动）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError, readErrorResponse, api } from "../../src/services/api";

/** 构造最小 Response 替身（不依赖 jsdom 是否提供 Headers） */
function fakeResponse(
	status: number,
	body: unknown,
	contentType = "application/json",
): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 409 ? "Conflict" : "",
		headers: {
			get: (name: string) =>
				name.toLowerCase() === "content-type" ? contentType : null,
		},
		json: async () => body,
		text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
	} as unknown as Response;
}

/** 构造 SSE 流式 Response 替身：每次 read 返回一帧 */
function sseResponse(frames: string[]): Response {
	const encoder = new TextEncoder();
	let index = 0;
	return {
		ok: true,
		status: 200,
		statusText: "",
		headers: { get: () => "text/event-stream" },
		body: {
			getReader: () => ({
				read: async () =>
					index < frames.length
						? { value: encoder.encode(frames[index++]), done: false }
						: { value: undefined as unknown as Uint8Array, done: true },
				releaseLock: () => undefined,
			}),
		},
	} as unknown as Response;
}

const frame = (event: string, data: unknown) =>
	`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("readErrorResponse / ApiError（B1）", () => {
	it("409 保留原始 detail 与 run_id，message 与改造前一致", async () => {
		const response = fakeResponse(409, {
			detail: "已有进行中的闭环运行",
			run_id: "run_abc123",
		});
		const { message, detail, payload } = await readErrorResponse(response);
		expect(message).toBe("已有进行中的闭环运行");

		const error = new ApiError({ message, status: 409, detail, payload });
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toBeInstanceOf(Error); // 既有 catch 方按 Error 处理仍然成立
		expect(error.status).toBe(409);
		expect(error.runId).toBe("run_abc123"); // ★ 不再需要去运行历史里猜
		expect(error.message).toBe("已有进行中的闭环运行");
	});

	it("422 字段级错误可按字段定位", async () => {
		const response = fakeResponse(422, {
			detail: [{ field: "max_pages", message: "max_pages: 不得大于 5" }],
		});
		const { message, detail, payload } = await readErrorResponse(response);
		// 兼容层：仍是 ";" 拼接的字符串
		expect(message).toBe("max_pages: 不得大于 5");

		const error = new ApiError({ message, status: 422, detail, payload });
		expect(error.fieldErrors).toEqual([
			{ field: "max_pages", message: "max_pages: 不得大于 5" },
		]);
		expect(error.runId).toBeUndefined();
	});

	it("非 JSON 错误体回退为状态行 + 文本", async () => {
		const response = fakeResponse(500, "boom", "text/plain");
		const { message } = await readErrorResponse(response);
		expect(message).toContain("500");
		expect(message).toContain("boom");
	});

	it("普通请求失败也抛 ApiError（不再只是 Error）", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			fakeResponse(403, { detail: "permission denied" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(api.getVersion()).rejects.toBeInstanceOf(ApiError);
		await expect(api.getVersion()).rejects.toMatchObject({
			status: 403,
			message: "permission denied",
		});
	});
});

describe("streamClosedLoop 终态归一化（B5）", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("run_finished → terminal=run_finished，携带 status 与 summary", async () => {
		fetchMock.mockResolvedValue(
			sseResponse([
				frame("run_started", { run_id: "r1", started_at: "t", config: {} }),
				frame("run_finished", { run_id: "r1", status: "partial", summary: "部分完成" }),
			]),
		);
		const seen: string[] = [];
		const result = await api.streamClosedLoop({}, (event) => seen.push(event));

		expect(result).toEqual({
			run_id: "r1",
			terminal: "run_finished",
			status: "partial",
			summary: "部分完成",
		});
		expect(seen).toEqual(["run_started", "run_finished"]);
	});

	it("run_error → terminal=run_error、status=error（不再被当成成功）", async () => {
		fetchMock.mockResolvedValue(
			sseResponse([
				frame("run_started", { run_id: "r2", started_at: "t", config: {} }),
				frame("run_error", { run_id: "r2", message: "内部错误" }),
			]),
		);
		const result = await api.streamClosedLoop({}, () => undefined);

		expect(result.terminal).toBe("run_error");
		expect(result.status).toBe("error");
		expect(result.summary).toBeNull();
	});

	it("流结束但无终态事件 → terminal=interrupted（交由调用方按 run_id 回放补齐）", async () => {
		fetchMock.mockResolvedValue(
			sseResponse([
				frame("run_started", { run_id: "r3", started_at: "t", config: {} }),
				frame("stage_decision", { run_id: "r3", decision: "采集中" }),
			]),
		);
		const result = await api.streamClosedLoop({}, () => undefined);

		expect(result.terminal).toBe("interrupted");
		expect(result.run_id).toBe("r3");
	});

	it("HTTP 409 → 抛 ApiError 且带 runId", async () => {
		fetchMock.mockResolvedValue(
			fakeResponse(409, { detail: "已有进行中的闭环运行", run_id: "run_busy" }),
		);
		await expect(api.streamClosedLoop({}, () => undefined)).rejects.toMatchObject({
			status: 409,
		});
		try {
			await api.streamClosedLoop({}, () => undefined);
		} catch (error) {
			expect((error as ApiError).runId).toBe("run_busy");
		}
	});

	it("HTTP 422 → 抛 ApiError 且带 fieldErrors", async () => {
		fetchMock.mockResolvedValue(
			fakeResponse(422, { detail: [{ field: "since", message: "since: 日期格式应为 YYYY-MM-DD" }] }),
		);
		try {
			await api.streamClosedLoop({}, () => undefined);
			throw new Error("应当抛错");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			expect((error as ApiError).fieldErrors).toEqual([
				{ field: "since", message: "since: 日期格式应为 YYYY-MM-DD" },
			]);
		}
	});
});

/**
 * API Service for v1 Endpoints
 */
import { API_BASE_URL } from "../lib/env";

export interface ChatRequest {
	agent_id: string;
	message: string;
	locale?: string;
	session_id?: string;
	params?: {
		temperature?: number;
		max_tokens?: number;
	};
}

export interface UsageInfo {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

export interface ChatResponse {
	reply: string;
	sources: Source[];
	usage?: UsageInfo;
	session_id?: string;
	message_id?: number;
	taken_over?: boolean;
}

export interface StreamDoneMeta {
	message_id: number | null;
	session_id?: string;
	usage?: UsageInfo | null;
	taken_over?: boolean;
}

export interface Source {
	type: "url" | "file";
	title?: string;
	url?: string;
	snippet?: string;
	question?: string;
	id?: string;
}

export type ProviderType =
	| "openai"
	| "openai_native"
	| "google"
	| "anthropic"
	| "xai"
	| "openrouter"
	| "zai"
	| "deepseek"
	| "volcengine"
	| "moonshot"
	| "aliyun_bailian"
	| "siliconflow";

export type EmbeddingProvider = "jina" | "siliconflow" | "custom";
export type AgentType =
	| "website_support"
	| "ai_clone"
	| "sales_outreach"
	| "custom";
export type AgentChannelMode = "web_widget" | "whatsapp" | "email" | "custom";

export interface Agent {
	id: string;
	workspace_id?: number;
	name: string;
	description?: string;
	agent_type?: AgentType;
	channel_mode?: AgentChannelMode;
	avatar?: string | null;
	system_prompt: string;
	model: string;
	temperature: number;
	max_tokens: number;
	api_format?: "openai" | "openai_compatible" | "anthropic" | "google";
	api_key?: string;
	api_key_set?: boolean;
	api_key_masked?: string;
	api_base?: string;
	jina_api_key?: string;
	jina_api_key_set?: boolean;
	jina_api_key_masked?: string;
	siliconflow_api_key?: string;
	siliconflow_api_key_set?: boolean;
	siliconflow_api_key_masked?: string;
	provider_type?: ProviderType;
	azure_endpoint?: string;
	azure_deployment_name?: string;
	azure_api_version?: string;
	anthropic_version?: string;
	google_project_id?: string;
	google_region?: string;
	provider_config?: Record<string, string | number | boolean>;
	embedding_provider?: EmbeddingProvider;
	embedding_api_base?: string | null;
	embedding_api_key_set?: boolean;
	embedding_model: string;
	embedding_batch_size?: number;
	kb_setup_completed?: boolean;
	crawl_max_depth?: number;
	crawl_max_pages?: number;
	top_k: number;
	similarity_threshold: number;
	enable_context: boolean;
	enable_auto_fetch?: boolean;
	url_fetch_interval_days?: number;
	rate_limit_per_minute?: number;
	rate_limit_per_hour?: number;
	restricted_reply?: string;
	last_error_code?: string | null;
	last_error_message?: string | null;
	last_error_at?: string | null;
	persona_type?: string;
	widget_title?: string;
	widget_color?: string;
	welcome_message?: string;
	history_days?: number;
	allowed_widget_origins?: string[] | null;
	is_active: boolean;
	deleted_at?: string | null;
	purge_after?: string | null;
	status?: "active" | "inactive" | "deleted";
	url_count?: number;
	file_count?: number;
	active_session_count?: number;
	created_at: string;
	updated_at?: string;
}

export interface AgentMember {
	id: number;
	email: string;
	name: string;
	is_active: boolean;
	role: string;
	member_role: "admin" | "support";
}

export interface AgentMemberCreateInput {
	email: string;
	name?: string;
	password?: string;
	role: "admin" | "support";
}

export interface URLSource {
	id: number;
	url: string;
	normalized_url: string;
	status: "pending" | "fetching" | "success" | "failed";
	title?: string;
	last_fetch_at?: string;
	is_indexed: boolean;
	created_at: string;
	updated_at?: string;
	// KB indexing diagnostics
	indexing_status?: "pending" | "processing" | "ready" | "error";
	indexing_error?: string;
	last_error?: string;
}

export interface URLListResponse {
	urls: URLSource[];
	total: number;
	quota: { used: number; max: number };
	job_id?: string;
	auto_fetch_queued?: boolean;
	last_fetch_at?: string;
	is_indexed: boolean;
	created_at: string;
	updated_at?: string;
}

export interface FileItem {
	id: string;
	filename: string;
	file_type: string;
	file_size: number;
	status: "ready" | "processing" | "uploading" | "pending" | "failed";
	created_at: string;
	updated_at?: string;
	// Processing error details
	error_message?: string;
}

export interface Quota {
	max_agents: number;
	max_urls: number;
	max_files: number;
	max_messages_per_day: number;
	max_total_text_mb: number;
	used_agents: number;
	used_urls: number;
	used_files: number;
	used_messages_today: number;
	used_total_text_mb: number;
	remaining_urls: number;
	remaining_files: number;
	remaining_messages_today: number;
}

export interface AgentCreateInput {
	name: string;
	description?: string;
	agent_type?: AgentType;
	channel_mode?: AgentChannelMode;
	system_prompt?: string;
	persona_type?: string;
	widget_title?: string;
	welcome_message?: string;
}

export async function parseErrorResponse(response: Response): Promise<string> {
	const contentType = (
		response.headers.get("content-type") || ""
	).toLowerCase();

	if (contentType.includes("application/json")) {
		const data = await response.json().catch(() => null);
		if (data?.detail) {
			if (typeof data.detail === "string") return data.detail;
			if (Array.isArray(data.detail)) {
				const messages = data.detail
					.map((e: { msg?: string; message?: string }) => e.msg || e.message)
					.filter(Boolean);
				if (messages.length) return messages.join("; ");
			}
			return JSON.stringify(data.detail);
		}
		if (data?.message) return data.message;
	}

	const text = await response.text().catch(() => "");
	const statusLabel = `${response.status} ${response.statusText || "Request failed"}`;
	if (text.trim()) {
		return `${statusLabel}: ${text.trim().slice(0, 500)}`;
	}
	return statusLabel;
}

/**
 * 解析单个 SSE 帧（`event: X\ndata: {...}`）为 [事件名, 数据]。
 * 数据行按 SSE 规范允许多行（多行以 \n 拼接后整体 JSON.parse），无 data 的帧（如注释）返回 null。
 */
function parseSseFrame(
	frame: string,
): [ClosedLoopEventName, ClosedLoopEventData] | null {
	const eventMatch = /^event:\s*(.+)$/m.exec(frame);
	const dataRaw = frame
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.replace(/^data:\s?/, ""))
		.join("\n");
	if (!eventMatch || !dataRaw) return null;
	try {
		const data = JSON.parse(dataRaw) as ClosedLoopEventData;
		const event = eventMatch[1].trim() as ClosedLoopEventName;
		return [event, { ...data, event }];
	} catch {
		return null;
	}
}

class APIService {
	private baseUrl: string;
	private selectedAgentStorageKey = "basjoo_selected_agent_id";

	constructor(baseUrl: string = API_BASE_URL) {
		this.baseUrl = baseUrl;
	}

	private getLocale(): string {
		return localStorage.getItem("basjoo_locale") || "zh-CN";
	}

	private getStreamBaseUrl(): string {
		if (this.baseUrl) {
			return this.baseUrl;
		}

		if (typeof window === "undefined") {
			return this.baseUrl;
		}

		const { protocol, hostname, port } = window.location;
		const isFrontendDevPort = port === "3000";

		if ((protocol === "http:" || protocol === "https:") && isFrontendDevPort) {
			return `${protocol}//${hostname}:8000`;
		}

		return this.baseUrl;
	}

	getSelectedAgentId(): string | null {
		if (typeof window === "undefined") return null;
		return localStorage.getItem(this.selectedAgentStorageKey);
	}

	setSelectedAgentId(agentId: string) {
		if (typeof window === "undefined") return;
		localStorage.setItem(this.selectedAgentStorageKey, agentId);
		window.dispatchEvent(
			new CustomEvent("basjoo-agent-changed", { detail: { agentId } }),
		);
	}

	clearSelectedAgentId() {
		if (typeof window === "undefined") return;
		localStorage.removeItem(this.selectedAgentStorageKey);
		window.dispatchEvent(
			new CustomEvent("basjoo-agent-changed", { detail: { agentId: null } }),
		);
	}

	private async request<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		// Add locale parameter to URL
		const url = new URL(`${this.baseUrl}${endpoint}`, window.location.origin);
		url.searchParams.set("locale", this.getLocale());

		const token = localStorage.getItem("token");

		const response = await fetch(url.toString(), {
			...options,
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...options.headers,
			},
		});

		if (!response.ok) {
			const errorMessage = await parseErrorResponse(response);
			console.error(`API Error: ${errorMessage}`, {
				status: response.status,
				endpoint,
				url,
			});
			throw new Error(errorMessage);
		}

		// Handle 204 No Content
		if (response.status === 204) {
			return undefined as T;
		}

		const contentType = (
			response.headers.get("content-type") || ""
		).toLowerCase();
		if (!contentType.includes("application/json")) {
			throw new Error(
				`Expected JSON response but received ${contentType || "unknown content type"}`,
			);
		}

		return response.json();
	}

	async checkHealth(): Promise<{ status: string }> {
		try {
			const result = await this.request<{ status: string }>("/health");
			return result;
		} catch (error) {
			console.error("Health check failed:", error);
			throw new Error(
				"Backend service is not accessible. Please check if the backend is running.",
			);
		}
	}

	// Chat APIs
	async chat(request: ChatRequest): Promise<ChatResponse> {
		// Include locale in request body, but don't override if already provided
		const chatRequest = {
			...request,
			locale: request.locale || this.getLocale(),
		};
		return this.request<ChatResponse>("/api/v1/chat", {
			method: "POST",
			body: JSON.stringify(chatRequest),
		});
	}

	async streamChat(
		request: ChatRequest,
		callbacks: {
			onSources: (sources: Source[]) => void;
			onContent: (chunk: string) => void;
			onDone: (meta: StreamDoneMeta) => void;
			onError: (error: string) => void;
			onThinking?: (elapsed: number) => void;
			onThinkingDone?: () => void;
		},
		options?: {
			signal?: AbortSignal;
		},
	): Promise<void> {
		const chatRequest = {
			...request,
			locale: request.locale || this.getLocale(),
		};

		const streamBaseUrl = this.getStreamBaseUrl();
		const url = new URL(
			`${streamBaseUrl}/api/v1/chat/stream`,
			window.location.origin,
		);
		url.searchParams.set("locale", this.getLocale());

		const token = localStorage.getItem("token");

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify(chatRequest),
			signal: options?.signal,
		});

		if (!response.ok) {
			const message = await parseErrorResponse(response);
			throw new Error(message || "Stream request failed");
		}

		if (!response.body) {
			throw new Error("Streaming response body is unavailable");
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let streamEnded = false;

		const processEvent = async (rawEvent: string) => {
			if (!rawEvent.trim()) {
				return;
			}

			let eventName = "message";
			const dataLines: string[] = [];

			for (const line of rawEvent.split("\n")) {
				if (line.startsWith("event:")) {
					eventName = line.slice(6).trim();
				} else if (line.startsWith("data:")) {
					dataLines.push(line.slice(5).trimStart());
				}
			}

			if (dataLines.length === 0) {
				return;
			}

			const payload = JSON.parse(dataLines.join("\n"));

			switch (eventName) {
				case "sources":
					callbacks.onSources(
						Array.isArray(payload.sources) ? payload.sources : [],
					);
					break;
				case "thinking":
					callbacks.onThinking?.(
						typeof payload.elapsed === "number" ? payload.elapsed : 0,
					);
					break;
				case "thinking_done":
					callbacks.onThinkingDone?.();
					break;
				case "content":
					callbacks.onContent(
						typeof payload.content === "string" ? payload.content : "",
					);
					break;
				case "done":
					streamEnded = true;
					callbacks.onDone(payload as StreamDoneMeta);
					break;
				case "error":
					streamEnded = true;
					callbacks.onError(
						typeof payload.error === "string" ? payload.error : "Stream failed",
					);
					break;
				default:
					break;
			}
		};

		const findEventDelimiter = (): { index: number; length: number } | null => {
			const crlfIndex = buffer.indexOf("\r\n\r\n");
			const lfIndex = buffer.indexOf("\n\n");

			if (crlfIndex === -1 && lfIndex === -1) {
				return null;
			}
			if (crlfIndex === -1) {
				return { index: lfIndex, length: 2 };
			}
			if (lfIndex === -1) {
				return { index: crlfIndex, length: 4 };
			}
			return crlfIndex < lfIndex
				? { index: crlfIndex, length: 4 }
				: { index: lfIndex, length: 2 };
		};

		const streamReadTimeout = 90_000;

		try {
			while (!streamEnded) {
				let timeoutId: number | null = null;
				const { done, value } = await Promise.race([
					reader.read(),
					new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
						timeoutId = window.setTimeout(
							() => reject(new Error("Stream read timeout")),
							streamReadTimeout,
						);
					}),
				]);
				if (timeoutId !== null) clearTimeout(timeoutId as number);

				buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

				let delimiter = findEventDelimiter();
				while (delimiter) {
					const rawEvent = buffer.slice(0, delimiter.index);
					buffer = buffer.slice(delimiter.index + delimiter.length);
					await processEvent(rawEvent.replace(/\r\n/g, "\n"));
					if (streamEnded) {
						break;
					}
					delimiter = findEventDelimiter();
				}

				if (done) {
					break;
				}
			}

			if (!streamEnded) {
				if (buffer.trim()) {
					await processEvent(buffer);
				}
				if (!streamEnded) {
					throw new Error("Stream ended unexpectedly");
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	// Agent APIs
	async listAgents(): Promise<{ agents: Agent[]; total: number }> {
		return this.request<{ agents: Agent[]; total: number }>("/api/v1/agents");
	}

	async createAgent(input: AgentCreateInput): Promise<Agent> {
		const agent = await this.request<Agent>("/api/v1/agents", {
			method: "POST",
			body: JSON.stringify(input),
		});
		this.setSelectedAgentId(agent.id);
		return agent;
	}

	async deleteAgent(
		agentId: string,
	): Promise<{ success: boolean; deleted_at?: string; purge_after?: string }> {
		const result = await this.request<{
			success: boolean;
			deleted_at?: string;
			purge_after?: string;
		}>(`/api/v1/agents/${agentId}`, {
			method: "DELETE",
		});

		if (this.getSelectedAgentId() === agentId) {
			this.clearSelectedAgentId();
		}

		return result;
	}

	async restoreAgent(agentId: string): Promise<Agent> {
		const agent = await this.request<Agent>(
			`/api/v1/agents/${agentId}:restore`,
			{
				method: "POST",
			},
		);
		this.setSelectedAgentId(agent.id);
		return agent;
	}

	async listAgentMembers(
		agentId: string,
	): Promise<{ members: AgentMember[]; total: number }> {
		return this.request<{ members: AgentMember[]; total: number }>(
			`/api/v1/agents/${agentId}/members`,
		);
	}

	async createAgentMember(
		agentId: string,
		input: AgentMemberCreateInput,
	): Promise<AgentMember> {
		return this.request<AgentMember>(`/api/v1/agents/${agentId}/members`, {
			method: "POST",
			body: JSON.stringify(input),
		});
	}

	async deleteAgentMember(
		agentId: string,
		adminId: number,
	): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(
			`/api/v1/agents/${agentId}/members/${adminId}`,
			{
				method: "DELETE",
			},
		);
	}

	async getDefaultAgent(): Promise<Agent> {
		const selectedAgentId = this.getSelectedAgentId();
		if (selectedAgentId) {
			try {
				return await this.getAgent(selectedAgentId);
			} catch (error) {
				this.clearSelectedAgentId();
			}
		}
		return this.request<Agent>("/api/v1/agent:default");
	}

	async getAgent(agentId: string): Promise<Agent> {
		return this.request<Agent>(`/api/v1/agent?agent_id=${agentId}`);
	}

	async updateAgent(agentId: string, updates: Partial<Agent>): Promise<Agent> {
		return this.request<Agent>(`/api/v1/agent?agent_id=${agentId}`, {
			method: "PUT",
			body: JSON.stringify(updates),
		});
	}

	async clearAgentError(agentId: string): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(
			`/api/v1/agent:clear-error?agent_id=${agentId}`,
			{
				method: "POST",
			},
		);
	}

	async getJinaKeyStatus(agentId: string): Promise<{
		agent_id: string;
		configured: boolean;
		embedding_provider?: EmbeddingProvider;
	}> {
		return this.request(`/api/v1/agent:jina-key-status?agent_id=${agentId}`);
	}

	async updateJinaApiKey(
		agentId: string,
		jina_api_key: string,
	): Promise<{ agent_id: string; configured: boolean }> {
		return this.request(`/api/v1/agent:jina-key?agent_id=${agentId}`, {
			method: "PUT",
			body: JSON.stringify({ jina_api_key }),
		});
	}

	async getQuota(agentId: string): Promise<Quota> {
		return this.request<Quota>(`/api/v1/quota?agent_id=${agentId}`);
	}

	// KB Setup
	async kbStatus(agentId: string): Promise<{
		agent_id: string;
		kb_setup_completed: boolean;
		embedding_provider: EmbeddingProvider;
		embedding_model: string;
		embedding_api_base: string | null;
		embedding_batch_size: number | null;
		embedding_api_key_set: boolean;
	}> {
		return this.request(`/api/v1/agent:kb-status?agent_id=${agentId}`);
	}

	async kbSetup(
		agentId: string,
		config: {
			embedding_provider: EmbeddingProvider;
			embedding_model: string;
			embedding_api_base?: string;
			embedding_batch_size?: number;
			jina_api_key?: string;
			siliconflow_api_key?: string;
		},
	): Promise<Agent> {
		return this.request(`/api/v1/agent:kb-setup?agent_id=${agentId}`, {
			method: "POST",
			body: JSON.stringify(config),
		});
	}

	async kbReset(agentId: string): Promise<{ message: string }> {
		return this.request(`/api/v1/agent:kb-reset?agent_id=${agentId}`, {
			method: "POST",
		});
	}

	// URL Management APIs
	async createURLs(agentId: string, urls: string[]): Promise<URLListResponse> {
		return this.request(`/api/v1/urls:create?agent_id=${agentId}`, {
			method: "POST",
			body: JSON.stringify({ urls }),
		});
	}

	async listURLs(
		agentId: string,
		skip = 0,
		limit = 100,
	): Promise<{
		urls: URLSource[];
		total: number;
		quota: { used: number; max: number };
	}> {
		return this.request(
			`/api/v1/urls:list?agent_id=${agentId}&skip=${skip}&limit=${limit}`,
		);
	}

	async refetchURLs(
		agentId: string,
		urlIds?: number[],
		force = false,
	): Promise<{
		job_id: string;
		status: string;
		message: string;
	}> {
		return this.request(`/api/v1/urls:refetch?agent_id=${agentId}`, {
			method: "POST",
			body: JSON.stringify({ url_ids: urlIds, force }),
		}).then(
			(result) => result as { job_id: string; status: string; message: string },
		);
	}

	async cancelURLTasks(
		agentId: string,
	): Promise<{ cancelled: number; task_ids: string[]; message: string }> {
		return this.request(`/api/v1/urls:cancel?agent_id=${agentId}`, {
			method: "POST",
		}).then(
			(result) =>
				result as { cancelled: number; task_ids: string[]; message: string },
		);
	}

	async deleteURL(agentId: string, urlId: number): Promise<void> {
		await this.request(
			`/api/v1/urls:delete?agent_id=${agentId}&url_id=${urlId}`,
			{
				method: "DELETE",
			},
		);
	}

	async clearAllUrls(
		agentId: string,
	): Promise<{ message: string; deleted_count: number }> {
		return this.request(`/api/v1/urls:clear_all?agent_id=${agentId}`, {
			method: "POST",
		}).then((result) => result as { message: string; deleted_count: number });
	}

	async discoverURLs(
		agentId: string,
		url: string,
		maxDepth = 1,
		maxPages = 10,
	): Promise<{
		discovered: number;
		created: number;
		message: string;
	}> {
		return this.request(
			`/api/v1/urls:discover?agent_id=${agentId}&url=${encodeURIComponent(url)}&max_depth=${maxDepth}&max_pages=${maxPages}`,
			{
				method: "POST",
			},
		);
	}

	async crawlSite(
		agentId: string,
		url: string,
		maxDepth = 2,
		maxPages = 20,
	): Promise<{
		job_id: string;
		status: string;
		discovered: number;
		created: number;
		message: string;
	}> {
		const body = JSON.stringify({
			url,
			max_depth: maxDepth,
			max_pages: maxPages,
		});
		const result = await this.request<{
			job_id: string;
			status: string;
			discovered: number;
			created: number;
			message: string;
		}>(`/api/v1/urls:crawl_site?agent_id=${agentId}`, {
			method: "POST",
			body,
		});
		return result;
	}

	// File Upload APIs
	async uploadFiles(
		agentId: string,
		files: File[],
	): Promise<{
		uploaded: number;
		failed: number;
		errors: string[];
		files: FileItem[];
	}> {
		const formData = new FormData();
		for (const file of files) {
			formData.append("files", file);
		}
		const token = localStorage.getItem("token");
		const url = new URL(
			`${this.baseUrl}/api/v1/files:upload`,
			window.location.origin,
		);
		url.searchParams.set("agent_id", agentId);
		url.searchParams.set("locale", this.getLocale());

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: formData,
		});

		if (!response.ok) {
			const errorMessage = await parseErrorResponse(response);
			throw new Error(errorMessage);
		}

		return response.json();
	}

	async listFiles(
		agentId: string,
		skip = 0,
		limit = 100,
	): Promise<{
		files: FileItem[];
		total: number;
	}> {
		return this.request(
			`/api/v1/files:list?agent_id=${agentId}&skip=${skip}&limit=${limit}`,
		);
	}

	async deleteFile(agentId: string, fileId: string): Promise<void> {
		await this.request(
			`/api/v1/files:delete?agent_id=${agentId}&file_id=${fileId}`,
			{
				method: "DELETE",
			},
		);
	}

	async clearAllFiles(
		agentId: string,
	): Promise<{ message: string; deleted_count: number }> {
		return this.request(`/api/v1/files:clear_all?agent_id=${agentId}`, {
			method: "POST",
		}).then((result) => result as { message: string; deleted_count: number });
	}

	// Index APIs
	async rebuildIndex(
		agentId: string,
		force = false,
	): Promise<{
		job_id: string;
		status: string;
		message: string;
	}> {
		return this.request(`/api/v1/index:rebuild?agent_id=${agentId}`, {
			method: "POST",
			body: JSON.stringify({ force }),
		}).then(
			(result) => result as { job_id: string; status: string; message: string },
		);
	}

	async getIndexStatus(agentId: string): Promise<{
		job_id?: string;
		agent_id: string;
		status: string;
		result?: {
			urls_ingested: number;
			errors: string[];
		};
	}> {
		return this.request(`/api/v1/index:status?agent_id=${agentId}`);
	}

	async getIndexInfo(agentId: string): Promise<{
		agent_id: string;
		urls_indexed: number;
		files_indexed: number;
		index_exists: boolean;
		status: string;
	}> {
		return this.request(`/api/v1/index:info?agent_id=${agentId}`);
	}

	// Models API
	async listModels(params: {
		provider_type: "openai_native" | "google";
		api_key?: string;
		agent_id?: string;
	}): Promise<string[]> {
		const result = await this.request<{ models: string[] }>(
			"/api/v1/models:list",
			{
				method: "POST",
				body: JSON.stringify(params),
			},
		);
		return result.models;
	}

	// Tasks Status API
	async getTasksStatus(agentId: string): Promise<{
		agent_id: string;
		is_crawling: boolean;
		is_rebuilding: boolean;
		active_tasks: string[];
		can_modify_index: boolean;
	}> {
		return this.request(`/api/v1/tasks:status?agent_id=${agentId}`);
	}

	// Sources Summary API
	async getSourcesSummary(agentId: string): Promise<{
		urls: {
			total: number;
			indexed: number;
			pending: number;
			total_size_kb: number;
		};
		files: {
			total: number;
			ready: number;
			processing: number;
			total_size_kb: number;
		};
		has_pending: boolean;
	}> {
		return this.request(`/api/v1/sources:summary?agent_id=${agentId}`);
	}

	// API Test Methods
	async testAIApi(
		agentId: string,
		overrides?: Partial<Agent>,
	): Promise<{ success: boolean; message: string }> {
		return this.request(`/api/v1/agent:test-ai-api?agent_id=${agentId}`, {
			method: "POST",
			body: JSON.stringify(overrides ?? {}),
		});
	}

	async testJinaApi(
		agentId: string,
		overrides?: Partial<Agent>,
	): Promise<{ success: boolean; message: string }> {
		return this.request(`/api/v1/agent:test-jina-api?agent_id=${agentId}`, {
			method: "POST",
			body: JSON.stringify(overrides ?? {}),
		});
	}

	async testEmbeddingApi(
		agentId: string,
		overrides?: Partial<Agent>,
	): Promise<{ success: boolean; message: string }> {
		return this.request(
			`/api/v1/agent:test-embedding-api?agent_id=${agentId}`,
			{
				method: "POST",
				body: JSON.stringify(overrides ?? {}),
			},
		);
	}

	// Admin API methods
	async getAdminSessions(params?: {
		agent_id?: string;
		visitor_id?: string;
		keyword?: string;
	}): Promise<any[]> {
		let url = "/api/v1/admin/sessions?";
		if (params?.agent_id) {
			url += `agent_id=${params.agent_id}`;
		}
		if (params?.visitor_id) {
			url += `${url.endsWith("?") ? "" : "&"}visitor_id=${params.visitor_id}`;
		} else if (params?.keyword) {
			url += `${url.endsWith("?") ? "" : "&"}keyword=${params.keyword}`;
		}
		return this.request(url);
	}

	async getAdminSessionMessages(sessionId: string): Promise<any[]> {
		return this.request(`/api/v1/admin/sessions/${sessionId}/messages`);
	}

	// Campus Source & CollectionJob APIs (EPIC 3)
	async listSources(): Promise<{ sources: CampusSource[]; total: number }> {
		return this.request(`/api/v1/sources`);
	}

	async monitorSources(recentDays = 7): Promise<SourceMonitor> {
		return this.request(`/api/v1/sources/monitor?recent_days=${recentDays}`);
	}

	async generateBrief(days = 7): Promise<BriefResult> {
		return this.request(`/api/v1/sources/brief?days=${days}`, { method: "POST" });
	}

	async listBrief(limit = 10): Promise<{ reports: BriefReportItem[]; total: number }> {
		return this.request(`/api/v1/sources/brief?limit=${limit}`);
	}

	async discoverSources(url: string, maxLinks = 20): Promise<DiscoverResult> {
		return this.request(`/api/v1/sources/discover`, {
			method: "POST",
			body: JSON.stringify({ url, max_links: maxLinks }),
		});
	}

	async recommendSources(url: string, maxLinks = 20): Promise<RecommendResult> {
		return this.request(`/api/v1/sources/recommend`, {
			method: "POST",
			body: JSON.stringify({ url, max_links: maxLinks }),
		});
	}

	async ingestFile(sourceId: string, file: File): Promise<{ raw_document_id: string; knowledge_object_id: string; status: string; content_len: number }> {
		const form = new FormData();
		form.append("file", file);
		const res = await fetch(`${this.baseUrl}/api/v1/sources/${sourceId}/ingest-file`, {
			method: "POST",
			headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
			body: form,
		});
		if (!res.ok) throw new Error("文件上传/解析失败");
		return res.json();
	}

	async createSource(data: {
		name: string;
		source_type?: string;
		base_url?: string;
		crawl_frequency?: number;
		max_pages?: number;
	}): Promise<CampusSource> {
		return this.request(`/api/v1/sources`, {
			method: "POST",
			body: JSON.stringify(data),
		});
	}

	async updateSource(
		id: string,
		data: {
			name?: string;
			base_url?: string;
			crawl_frequency?: number;
			status?: string;
		},
	): Promise<CampusSource> {
		return this.request(`/api/v1/sources/${id}`, {
			method: "PUT",
			body: JSON.stringify(data),
		});
	}

	async deleteSource(id: string): Promise<{ deleted: boolean }> {
		return this.request(`/api/v1/sources/${id}`, { method: "DELETE" });
	}

	/**
	 * 触发单源采集。前三个参数保持原签名（向后兼容），extra 追加时间范围/仅新内容/条数上限
	 * （REFACTOR_PLAN_V2 T5/T13）。仅新内容以该源"上次成功采集时间"为水位，由后端解析。
	 */
	async runSource(
		id: string,
		maxPages?: number,
		column?: string,
		extra: RunSourceExtra = {},
	): Promise<{ job_id: string; status: string }> {
		const params = new URLSearchParams();
		if (maxPages !== undefined) params.set("max_pages", String(maxPages));
		if (column) params.set("column", column);
		if (extra.since) params.set("since", extra.since);
		if (extra.until) params.set("until", extra.until);
		if (extra.onlyNew) params.set("only_new", "true");
		if (extra.maxItems !== undefined) params.set("max_items", String(extra.maxItems));
		const q = params.toString() ? `?${params.toString()}` : "";
		return this.request(`/api/v1/sources/${id}/run${q}`, { method: "POST" });
	}

	async pauseSource(id: string): Promise<CampusSource> {
		return this.request(`/api/v1/sources/${id}/pause`, { method: "POST" });
	}

	async listJobs(sourceId?: string): Promise<{ jobs: CollectionJob[]; total: number }> {
		const q = sourceId ? `?source_id=${sourceId}` : "";
		return this.request(`/api/v1/jobs${q}`);
	}

	async getJob(id: string): Promise<CollectionJob> {
		return this.request(`/api/v1/jobs/${id}`);
	}

	async getRadar(): Promise<RadarStats> {
		return this.request(`/api/v1/radar`);
	}

	async getKnowledgeHealth(): Promise<KnowledgeHealth> {
		return this.request(`/api/v1/knowledge-health`);
	}

	async generateDigest(period = "daily"): Promise<DigestItem> {
		return this.request(`/api/v1/digests/generate?period=${period}`, {
			method: "POST",
		});
	}

	async listDigests(): Promise<{ digests: DigestItem[]; total: number }> {
		return this.request(`/api/v1/digests`);
	}

	// Review Queue APIs
	async listReviewTasks(status?: string): Promise<{ tasks: ReviewTaskItem[]; total: number }> {
		const q = status ? `?status=${status}` : "";
		return this.request(`/api/v1/review-tasks${q}`);
	}

	async approveReviewTask(id: string): Promise<{ task_id: string; status: string }> {
		return this.request(`/api/v1/review-tasks/${id}/approve`, { method: "POST" });
	}

	async rejectReviewTask(id: string): Promise<{ task_id: string; status: string }> {
		return this.request(`/api/v1/review-tasks/${id}/reject`, { method: "POST" });
	}

	// Ask AI APIs
	async askQuestion(query: string, topK = 5): Promise<AskResponse> {
		return this.request(`/api/v1/ask`, {
			method: "POST",
			body: JSON.stringify({ query, top_k: topK }),
		});
	}

	// AI 审核助手 APIs (E)
	async aiSuggestReviewTask(id: string): Promise<AIReviewSuggest> {
		return this.request(`/api/v1/review-tasks/${id}/ai-suggest`, { method: "POST" });
	}

	async aiSuggestConflict(id: string): Promise<ConflictSuggest> {
		return this.request(`/api/v1/conflicts/${id}/ai-suggest`, { method: "POST" });
	}

	// 校务洞察 APIs (F)
	async generateInsights(): Promise<InsightResult> {
		return this.request(`/api/v1/insights`, { method: "POST" });
	}

	async listInsights(limit = 20): Promise<{ reports: InsightReportItem[]; total: number }> {
		return this.request(`/api/v1/insights?limit=${limit}`);
	}

	// 主动推送 · 站内通知
	async listNotifications(
		limit = 20,
		unreadOnly = false,
		kind?: string,
	): Promise<{ notifications: NotificationItem[]; total: number }> {
		const q = unreadOnly ? `&unread_only=true` : "";
		const k = kind ? `&kind=${encodeURIComponent(kind)}` : "";
		return this.request(`/api/v1/notifications?limit=${limit}${q}${k}`);
	}

	async getUnreadCount(): Promise<{ unread: number }> {
		return this.request(`/api/v1/notifications/unread-count`);
	}

	async markNotificationRead(id: string): Promise<{ id: string; read: boolean }> {
		return this.request(`/api/v1/notifications/${id}/read`, { method: "POST" });
	}

	/** 全部标记已读（幂等：无未读时 updated=0） */
	async readAllNotifications(): Promise<{ updated: number }> {
		return this.request(`/api/v1/notifications/read-all`, { method: "POST" });
	}

	// 异常运维告警
	async checkAlerts(): Promise<{ alerts: { level: string; title: string; detail: string }[]; created: number }> {
		return this.request(`/api/v1/alerts/check`, { method: "POST" });
	}

	// 三层 Agent 智能运营闭环 (G)
	/** 旧同步端点（保留向后兼容：脚本/测试仍可用；前端改用 streamClosedLoop） */
	async runClosedLoop(collect = false): Promise<ClosedLoopResult> {
		return this.request(`/api/v1/closed-loop/run?collect=${collect}`, { method: "POST" });
	}

	/** 闭环配置 Schema：前端据此动态渲染运行配置面板 */
	async getConfigSchema(name: "closed-loop" | "closed_loop" | "collection"): Promise<ConfigSchema> {
		return this.request(`/api/v1/config-schema/${name}`);
	}

	/** 某数据源真实可用的栏目录像（含计数与来源标记） */
	async listSourceColumns(sourceId: string, refresh = false): Promise<SourceColumns> {
		const q = refresh ? "?refresh=true" : "";
		return this.request(`/api/v1/sources/${sourceId}/columns${q}`);
	}

	/**
	 * 流式运行闭环：POST + fetch 流式读取 SSE 帧，逐事件回调（增量渲染）。
	 * 用 fetch 而非 EventSource：需要带 Authorization 头且要 POST 配置体。
	 */
	async streamClosedLoop(
		config: ClosedLoopConfig,
		onEvent: (event: ClosedLoopEventName, data: ClosedLoopEventData) => void,
		signal?: AbortSignal,
	): Promise<{ run_id: string; status: string }> {
		const url = new URL(`${this.baseUrl}/api/v1/closed-loop/stream`, window.location.origin);
		url.searchParams.set("locale", this.getLocale());
		const token = localStorage.getItem("token");

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify(config),
			signal,
		});

		if (!response.ok) {
			throw new Error(await parseErrorResponse(response));
		}
		if (!response.body) {
			throw new Error("当前浏览器不支持流式响应");
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let runId = "";
		let status = "ok";

		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let boundary = buffer.indexOf("\n\n");
			while (boundary >= 0) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const parsed = parseSseFrame(frame);
				if (parsed) {
					const [event, data] = parsed;
					if (event === "run_started" && typeof data.run_id === "string") {
						runId = data.run_id;
					}
					if (event === "run_finished" && typeof data.status === "string") {
						status = data.status;
					}
					onEvent(event, data);
				}
				boundary = buffer.indexOf("\n\n");
			}
		}
		return { run_id: runId, status };
	}

	/** 闭环运行历史（含参数快照，可复现） */
	async listClosedLoopRuns(limit = 10): Promise<{ runs: ClosedLoopRunItem[]; total: number }> {
		return this.request(`/api/v1/closed-loop/runs?limit=${limit}`);
	}

	/** 回放：与实时流同构的事件序列（前端用同一个 reducer 渲染） */
	async getClosedLoopRun(runId: string): Promise<ClosedLoopRunDetail> {
		return this.request(`/api/v1/closed-loop/runs/${runId}`);
	}

	/** 请求取消运行（协作式：阶段之间生效） */
	async cancelClosedLoopRun(runId: string): Promise<{ run_id: string; cancel_requested: boolean }> {
		return this.request(`/api/v1/closed-loop/runs/${runId}/cancel`, { method: "POST" });
	}

	async listDecisions(limit = 10): Promise<{ runs: DecisionRun[]; total: number }> {
		return this.request(`/api/v1/agents/decisions?limit=${limit}`);
	}

	// 一键导入演示数据 (A2)
	async seedDemo(): Promise<{ created: number; skipped: number }> {
		return this.request(`/api/v1/demo/seed`, { method: "POST" });
	}

	// Knowledge Object APIs
	async listKnowledgeObjects(): Promise<{ objects: KnowledgeObject[]; total: number }> {
		return this.request(`/api/v1/knowledge-objects`);
	}

	// Knowledge Governance APIs (EPIC 8)
	async publishKo(id: string): Promise<{ id: string; status: string }> {
		return this.request(`/api/v1/knowledge-objects/${id}/publish`, { method: "POST" });
	}

	async archiveKo(id: string): Promise<{ id: string; status: string }> {
		return this.request(`/api/v1/knowledge-objects/${id}/archive`, { method: "POST" });
	}

	async editKo(id: string, data: {
		title?: string; type?: string; department?: string;
		effective_from?: string; effective_to?: string; summary?: string;
		facts?: { field: string; value: string }[]; tags?: string[]; confidence?: number;
	}): Promise<{ id: string; status: string }> {
		return this.request(`/api/v1/knowledge-objects/${id}/edit`, {
			method: "POST",
			body: JSON.stringify(data),
		});
	}

	async createKo(data: {
		type?: string; title: string; department?: string;
		effective_from?: string; effective_to?: string; summary?: string;
		tags?: string[]; facts?: { field: string; value: string }[]; confidence?: number;
	}): Promise<{ id: string; status: string; title: string }> {
		return this.request(`/api/v1/knowledge-objects/create`, {
			method: "POST",
			body: JSON.stringify(data),
		});
	}

	async batchArchiveKo(ids: string[]): Promise<{ archived: number }> {
		return this.request(`/api/v1/knowledge-objects/batch-archive`, {
			method: "POST",
			body: JSON.stringify({ ids }),
		});
	}

	async archiveExpiredKo(): Promise<{ archived: number }> {
		return this.request(`/api/v1/knowledge-objects/archive-expired`, { method: "POST" });
	}

	async ingestKnowledgeObjectFile(file: File): Promise<{ id: string; title: string; status: string; type: string }> {
		const form = new FormData();
		form.append("file", file);
		const res = await fetch(`${this.baseUrl}/api/v1/knowledge-objects/ingest-file`, {
			method: "POST",
			headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
			body: form,
		});
		if (!res.ok) throw new Error(await parseErrorResponse(res));
		return res.json();
	}

	// Knowledge Graph APIs (A, LLM 抽取)
	async buildKnowledgeGraph(limit = 50, force = false): Promise<{ ko_count: number; relations_added: number; skipped: number }> {
		return this.request(`/api/v1/knowledge-graph/build?limit=${limit}&force=${force}`, { method: "POST" });
	}

	async listKnowledgeGraph(limit = 300): Promise<KnowledgeGraph> {
		return this.request(`/api/v1/knowledge-graph?limit=${limit}`);
	}

	async askKnowledgeGraph(query: string): Promise<KGAskResult> {
		return this.request(`/api/v1/knowledge-graph/ask?query=${encodeURIComponent(query)}&top_k=8`, { method: "POST" });
	}

	// Change Radar APIs (EPIC 5)
	async listChanges(severity?: string, limit = 20, offset = 0): Promise<{ changes: ChangeEvent[]; total: number }> {
		const params = new URLSearchParams();
		if (severity) params.set("severity", severity);
		params.set("limit", String(limit));
		params.set("offset", String(offset));
		const q = params.toString() ? `?${params.toString()}` : "";
		return this.request(`/api/v1/changes${q}`);
	}

	async getChangeDiff(id: string): Promise<ChangeDetail> {
		return this.request(`/api/v1/changes/${id}/diff`);
	}
}

export interface CampusSource {
	id: string;
	name: string;
	source_type: string;
	base_url?: string | null;
	crawl_frequency?: number;
	max_pages?: number;
	status: string;
	last_crawled_at?: string | null;
	last_success_at?: string | null;
	last_error?: string | null;
	created_at: string;
	updated_at?: string | null;
}

export interface CollectionJob {
	id: string;
	source_id: string;
	status: string;
	stage_trace?: Record<string, string> | null;
	result?: { fetched?: number; indexed?: number; errors?: string[] } | null;
	error_message?: string | null;
	created_at: string;
	started_at?: string | null;
	completed_at?: string | null;
}

export interface RadarStats {
	new_today: number;
	review_pending: number;
	conflict_open: number;
	expiring: number;
	source_error: number;
	total_ko: number;
	published: number;
	expired: number;
	source_activity: { name: string; count: number }[];
}

export interface KnowledgeHealth {
	health_score: number;
	formula: string;
	today: { new: number; changed: number; conflicts: number; review: number };
	coverage: { total: number; published: number; expired: number };
	freshness: { Fresh: number; Aging: number; Stale: number; Unknown: number };
	conflict_rate: number;
	review_backlog: number;
	source_health: { total: number; error: number; ok: number };
}

export interface DigestItem {
	id: string;
	period: string;
	title: string;
	content: string;
	created_at: string;
}

export interface ReviewTaskItem {
	id: string;
	knowledge_object_id: string;
	reason: string;
	status: string;
	note?: string | null;
	created_at: string;
	reviewed_at?: string | null;
	ko_title?: string | null;
	ko_type?: string | null;
}

export interface AIReviewSuggest {
	summary?: string;
	risks?: string[];
	recommendation?: "approve" | "reject" | "merge";
	reason?: string;
	confidence?: number;
	error?: string;
}

export interface ConflictSuggest {
	keep?: "a" | "b";
	recommendation?: string;
	note?: string;
	confidence?: number;
}

export interface InsightResult {
	content: string;
	data: {
		统计: {
			今日新增: number;
			已发布知识: number;
			开放冲突: number;
			待审核: number;
			异常来源: number;
			部门分布: Record<string, number>;
		};
		近期高严重度变更: string[];
		临期事项: string[];
	};
}

export interface InsightReportItem extends InsightResult {
	id: string;
	/** 后端生成的干净标题（去 Markdown）；旧数据可能为空，前端需回退 */
	title?: string | null;
	created_at?: string;
}

export interface ClosedLoopStage {
	name: string;
	status: string;
	detail: string;
	jobs?: number;
}

export interface ClosedLoopResult {
	run_id?: string;
	stages: ClosedLoopStage[];
	summary: string;
	status: string;
}

export interface DecisionEntry {
	agent: string;
	decision: string;
	detail?: string | null;
	status: string;
	created_at?: string;
	/** 该步完成时刻（REFACTOR_PLAN_V2 T2：时间线右侧展示） */
	finished_at?: string | null;
	/** 该步耗时（毫秒） */
	duration_ms?: number | null;
}

export interface DecisionRun {
	run_id: string;
	created_at?: string;
	entries: DecisionEntry[];
}

// ===== 配置 Schema（REFACTOR_PLAN_V2 T3）：后端声明，前端动态渲染表单 =====
export type ConfigFieldType = "boolean" | "int" | "string" | "date" | "multi_select";

export interface ConfigField {
	key: string;
	type: ConfigFieldType;
	default: unknown;
	label: string;
	hint?: string;
	min?: number;
	max?: number;
	options_source?: string;
	/** 仅前端渲染联动：勾选/取值满足时才展开显示 */
	visible_if?: Record<string, unknown>;
}

export interface ConfigGroup {
	key: string;
	title: string;
	fields: ConfigField[];
}

export interface ConfigSchema {
	name: string;
	version: number;
	groups: ConfigGroup[];
}

/** 闭环运行配置（键与 Schema 字段一一对应） */
export type ClosedLoopConfig = Record<string, boolean | number | string | string[] | null>;

// ===== 闭环 SSE 流式事件（REFACTOR_PLAN_V2 T4，字段冻结） =====
export type ClosedLoopEventName =
	| "run_started"
	| "stage_started"
	| "stage_decision"
	| "stage_finished"
	| "run_finished"
	| "run_error"
	| "heartbeat";

export interface ClosedLoopEventData {
	event: ClosedLoopEventName;
	run_id?: string;
	stage?: string;
	name?: string;
	index?: number;
	total?: number;
	agent?: string;
	decision?: string;
	detail?: string | null;
	status?: string;
	finished_at?: string | null;
	started_at?: string | null;
	duration_ms?: number | null;
	summary?: string | null;
	message?: string;
	config?: ClosedLoopConfig;
	[k: string]: unknown;
}

export interface ClosedLoopRunItem {
	run_id: string;
	type?: string;
	status: string;
	params: ClosedLoopConfig;
	summary?: string | null;
	error?: string | null;
	cancel_requested?: boolean;
	started_at?: string | null;
	finished_at?: string | null;
	duration_ms?: number | null;
}

export interface ClosedLoopRunDetail extends ClosedLoopRunItem {
	/** 与实时事件同构的回放序列 */
	events: ClosedLoopEventData[];
}

/** 单源采集的扩展参数（时间范围 / 仅新内容 / 条数上限） */
export interface RunSourceExtra {
	since?: string;
	until?: string;
	onlyNew?: boolean;
	maxItems?: number;
}

export interface AskResponse {
	answer: string;
	citations: {
		id?: string;
		title: string;
		url?: string | null;
		type?: string;
		department?: string | null;
		status?: string;
		effective_from?: string | null;
		effective_to?: string | null;
		freshness?: string;
		authority?: number | null;
		confidence?: number | null;
		summary?: string | null;
		version?: number;
	}[];
	query: string;
	grounded?: boolean;
	intent?: string;
	department?: string | null;
	graph_hints?: string[];
}

export interface KnowledgeObject {
	id: string;
	type: string;
	title: string;
	department?: string | null;
	status: string;
	version: number;
	confidence?: number | null;
	effective_from?: string | null;
	effective_to?: string | null;
	facts?: { field: string; value: string }[] | null;
	tags?: string[] | null;
	summary?: string | null;
	content?: string | null;
	source_url?: string | null;
	created_at?: string | null;
}

export interface SourceMonitor {
	recent_days: number;
	total_new: number;
	sources: number;
	/** 本次快照的服务端时间：前端据此给出"已更新 · HH:mm:ss"的确定反馈 */
	refreshed_at?: string | null;
	items: {
		source_id: string;
		name: string;
		source_type: string;
		base_url?: string | null;
		status: string;
		/** 最近一次尝试（开始）采集时间 */
		last_crawled_at?: string | null;
		/** 最近一次采集成功完成时间（展示主字段） */
		last_success_at?: string | null;
		last_error?: string | null;
		new_count: number;
		recent_titles: string[];
	}[];
}

export interface SourceColumn {
	value: string;
	label: string;
	count: number;
	/** history=历史分布（真实可筛到数据）/ adapter=适配器声明（尚未采集到内容） */
	origin: string;
}

export interface SourceColumns {
	source_id: string;
	columns: SourceColumn[];
	generated_at: string;
	cached: boolean;
}

export interface BriefResult {
	id?: string;
	title?: string;
	content: string;
	data?: unknown;
	created_at?: string;
}

export interface BriefReportItem extends BriefResult {
	id: string;
	created_at?: string;
}

export interface NotificationItem {
	id: string;
	kind: string;
	title: string;
	content?: string | null;
	read: boolean;
	/** 点击通知的跳转目标（前端路由，如 /insights） */
	link?: string | null;
	created_at?: string;
}

export interface DiscoverResult {
	base_url: string;
	origin: string;
	discovered: { name: string; url: string; type: string; domain: string }[];
	total: number;
}

export interface RecommendResult {
	recommended: { name: string; url: string; type: string; domain: string; value: string; category: string; frequency_hours: number }[];
	total: number;
}

export interface ChangeEvent {
	id: string;
	source_id: string;
	source_name?: string;
	normalized_url?: string;
	old_version?: number | null;
	new_version?: number | null;
	change_type: string[];
	severity: string;
	diff_summary?: string | null;
	requires_review?: boolean;
	detected_at?: string | null;
}

export interface KnowledgeGraph {
	entities: { id: string; name: string; type: string; ko_id?: string | null }[];
	relations: { id: string; head_id: string; tail_id: string; relation: string }[];
	entity_count: number;
	relation_count: number;
}

export interface KGAskResult {
	answer: string;
	related: string[];
	grounded: boolean;
	subgraph?: {
		nodes: { id: string; name: string; type: string }[];
		edges: { head_id: string; tail_id: string; relation: string }[];
	};
	paths?: string[];
}

export interface ChangeDetail extends ChangeEvent {
	title_before?: string;
	title_after?: string;
	content_hash?: string | null;
	before?: string;
	after?: string;
	changes: { type: string; lines: string[] }[];
}

export const api = new APIService();

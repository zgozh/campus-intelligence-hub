# AGENTS.md

## Scope
This is the primary reference for AI coding agents working on **校务智汇中台（Campus Intelligence Hub，Basjoo 底座二次开发）**. **Always read this file, CLAUDE.md, and relevant sections of README.md before starting any task.** 设计与方案文档在仓库根目录（`README.md`、`ARCHITECTURE.md`、`DECISIONS.md`、`REFACTOR_PLAN_V2.md`、`REFACTOR_PLAN_V2_2.md`、`DEPLOY-GUIDE.md` 等）；注意 `docs/` 目录被 `.gitignore` 排除，勿把长期文档只放在那里。

## Project overview
校务知识自动化中台（面向校务管理的 AI 自动数据采集与知识管理），底座为 Basjoo：
- FastAPI backend with self-developed multi-tenant KB (Qdrant-backed RAG), streaming chat (SSE), knowledge ingestion, admin auth, quotas.
- Next.js 14 (App Router) admin dashboard in `frontend-nextjs/`。
- 校务域：多源采集（含栏目推导/时间范围/礼貌抓取）→ 变更雷达 → 知识治理 → 融合检索问答（防幻觉）→ 自动化（快讯/洞察/告警/三层 Agent 闭环 SSE）→ 对外开放（REST + MCP）。
- Supporting: Scrapling microservice, Qdrant (vector DB), Redis, PostgreSQL, nginx.
All LLM calls to external providers（DashScope 默认）; embeddings via self-KB (Jina/SiliconFlow/OpenAI-compatible).

## Repository layout
- `backend/` — FastAPI app, `services/` (logic), `api/` (thin routers), `models.py`, `tests/`。
- `frontend-nextjs/` — `app/` (routes), `src/views/`, `src/components/`, `src/hooks/`, `src/services/api.ts`, `src/utils/`。
- `scrapling-service/` — standalone stealth scraper (curl_cffi + readability)。
- `docker-compose.yml` — 单机编排（**无 profiles**）；`nginx/`。
- `tests/e2e/` — Playwright specs（Basjoo 时期遗留，本仓库根目录**没有** package.json，无法用 `npm run test:e2e`）。
- `scripts/` — 校务项目自有工具：`smoke_refactor.ps1`、`browser_smoke.mjs`、`browser_probe.mjs`、`lib/cdp.mjs`、`verify_all.ps1`、`docs_check.ps1`、`build_all.ps1`、`eval_grounding.py`。
- `eval/` — 30 问评测集（`questions.json`）。

## Required tools and setup
- Dev stack: `docker compose up -d`（本仓库的 compose **没有 profiles**，也不要加）。
- Backend local: `cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && python3 main.py`
- Frontend: `cd frontend-nextjs && npm install`。
- 后端测试可直接在容器内跑（本机无 venv 时推荐）：`docker compose exec -T backend python -m pytest --ignore=tests/integration -q`。
- 后端只改了代码、未重建镜像时，可 `docker compose cp backend/. backend:/app/ && docker compose restart backend` 快速生效。
- Environment: documented in `.env.example`; `SECRET_KEY`, `ENCRYPTION_KEY`, `DEFAULT_AGENT_ID` auto-persisted to `/app/data/` (preserve volume in prod). Never commit secrets.

## Development commands
- Frontend dev: `cd frontend-nextjs && npm run dev`.
- Frontend verify: `cd frontend-nextjs && npm run typecheck && npm run test`（前端改动**必须**三者齐跑：`npm run build && npm run typecheck && npm run test`）。
- 后端测试: `cd backend && pytest`（`pytest.ini`；`Test*` 类、`test_*` 函数）。容器内：`docker compose exec -T backend python -m pytest --ignore=tests/integration -q`。
- 真机接口冒烟（32 项断言）：`powershell -File scripts/smoke_refactor.ps1`。
- **真实浏览器场景冒烟**（6 场景，判定"用户点得开/看得见"）：`node scripts/browser_smoke.mjs --window 1366x768`；
  单元素探针：`node scripts/browser_probe.mjs --url <url> --window 1366x768 --expect "<selector>"`。
- **一键总验收（R12）**：`powershell -File scripts/verify_all.ps1`（可 `-SkipBuild -SkipBrowser` 快速回归）。
- 文档一致性机械校验：`powershell -File scripts/docs_check.ps1`。
- 注入构建标识并重建：`powershell -File scripts/build_all.ps1`。
- Docker rebuild: `docker compose up -d --build backend frontend`（只重建 backend 会摘掉 frontend 容器，记得 `docker compose up -d frontend` 补回）。
- Health: `curl http://localhost:8000/health`。
- 注意：本机只有 **Windows PowerShell 5.1**（无 `pwsh`）；含中文的 `.ps1` 必须存为 **UTF-8 with BOM**，否则按 ANSI 解析直接语法报错。

## Must-follow conventions
- **Structure**: Backend logic strictly in `backend/services/`; thin routers in `backend/api/`. Models in `backend/models.py`. Frontend views in `src/views/`, shared in `src/components/`, hooks in `src/hooks/`, 展示层格式化统一走 `src/utils/format.ts`（禁组件内自写时间/Markdown 处理）。
- **Style**: Python — 4 spaces, snake_case for modules/functions/tests. TypeScript/React — 2 spaces, PascalCase for components/views, `use*` hooks. Explicit TS types; no `any`.
- **Commits**: Conventional (`feat:`, `fix:`, `docs:`), scoped, imperative. PRs require summary, test commands+output, UI screenshots, migration notes.
- **Security**: Route all URLs through `backend/services/url_safety.py` (SSRF + DNS cache)。采集链路（列表页/详情页）也必须过校验（`CrawlEngine._ssrf_reason`）。Handle CORS/rate-limit via shared middleware helpers。

## Architecture boundaries
- `backend/main.py` owns app factory, middleware (CORS, i18n, rate-limit, body-size), router mounting (`/api/admin`, `/api/v1`), scheduler/Redis startup.
- Self-KB integration (`kb_service.py`, `qdrant_service.py`, `kb_document_processor.py`): tenant-scoped document upload/parse/chunk/embed via Qdrant. Per-tenant collections. Similarity search; default similarity_threshold 0.01.
- Task concurrency guarded by shared TaskLock in URL/index endpoints；闭环运行另有 DB 级互斥（`run_service.get_running_run`）+ 启动时崩溃恢复（`reap_orphaned_runs`）。

## When changing areas
- **New LLM provider**: Extend `backend/services/llm_service.py`, update Agent model/config, expose in Playground UI.
- **New knowledge source type**: Extend ingestion via `backend/api/v1/kb_document_endpoints.py` + `services/kb_document_processor.py` + `services/document_parser.py` (local storage + Qdrant, tenant-scoped).
  - For multi-tenant KB documents: use the new direct pipeline in `backend/api/v1/kb_document_endpoints.py` + `services/kb_document_processor.py` + `services/document_parser.py` (local storage + Qdrant, tenant-scoped).
- **UI change**: Update `src/views/` or `src/components/`; add i18n strings in `src/locales/`; verify responsiveness.
- **Post-agent-creation KB onboarding**: In `src/views/Agents.tsx`, after `api.createAgent` success set `onboardingAgentId`. Triggers `KBSetupWizard` (via `useAgentKbStatus` hook + `kbStatus` API + `kb_setup_completed` flag). On complete/skip call `recheck()` then `navigate("/agents/{id}/dashboard")`.
- **Chat streaming issues**: Inspect SSE in `backend/api/v1/endpoints.py`, widget parser, error middleware.
- **Indexing/retrieval problems**: Check `kb_retrieval_service.py`, `qdrant_service.py`, collection cache, threshold, `is_indexed` flag on URLSource.
- **Large exploration/analysis**: Use `ctx_*` tools (ctx_batch_execute, ctx_execute_file, ctx_search) first.

## Testing and verification (mandatory before claiming done)
- Frontend changes: always `cd frontend-nextjs && npm run build && npm run typecheck && npm run test`.
- Backend changes: `cd backend && pytest` for affected tests (use `conftest.py` fixtures: `client`, `public_client`).
- Use `verification-before-completion` skill; run `lsp_diagnostics` before builds.
- Docker changes: `docker compose --profile dev up --build`.
- E2E or widget: relevant `npm run test:e2e:*`.
- Major changes: request code review via `requesting-code-review` skill.
- For bugs: use `systematic-debugging` skill. For features: `brainstorming` → `writing-plans` → `subagent-driven-development` or `executing-plans`.

## Subsystem-specific
### Backend RAG / ingestion
- URL pipeline: `create_urls` → pending DB → background fetch (Scrapling) → success → content updated. Self-KB handles indexing via document pipeline.
- Force rebuild vs incremental controlled by `force` param in index endpoints.
- Similarity scores are RRF (0.01–0.05 range); frontend % slider maps 0–100 → 0.00–0.10.

**KB Document Pipeline (new, multi-tenant, direct Qdrant)**
- Upload: `POST /api/tenants/{tenant_id}/knowledge_bases/{kb_id}/documents` (max 5 files, 20MB, txt/md/html/pdf/docx/xlsx) → pending record + local storage → BackgroundTasks.
- Processing: `DocumentParser` (pdfplumber/python-docx/openpyxl) → `chunk_text` (Recursive equiv, KB params) → OpenAI-compatible embedding → Qdrant batch upsert (≤100) with tenant/kb/doc payload.
- Status: pending → processing → ready/error (with `error_message`).
- Delete: Qdrant filter delete → `kb_chunks` → `kb_documents` → physical file.
- All queries enforce `tenant_id`; use `require_tenant_access` + `KbService.get_knowledge_base`.

**Legacy agent-scoped KB sources (URL / File)**
- Use `backend/services/url_service.py` and `backend/services/file_service.py`.
- Endpoints in `backend/api/v1/endpoints.py` must remain thin (delegate only; no DB logic).
- The multi-tenant KB document pipeline is the preferred path for new work.

### Frontend
- Centralized API/SSE + `kbStatus` helper in `src/services/api.ts`.
- Auth state in `src/context/AuthContext.tsx` (localStorage).
- New `useAgentKbStatus` hook for first-time KB flow.

### Widget（本仓库不含）
Basjoo 时期的 `widget/` 目录与 `npm run sync-widget` / `npm run test:e2e:*` 命令**在本仓库已不存在**；`frontend-nextjs` 是唯一前端。相关历史段落仅作背景，勿照抄命令。

## Safety and operational notes
- Persistent volumes (`backend-data`, `redis-data`, `postgres-data`) are critical; **部署脚本不存在**（本仓库没有 `install-deploy.sh`），升级/重建请用 `docker compose up -d --build`，卷不会被动到；备份与发布前检查见 `DEPLOY-GUIDE.md`。
- `Origin: null` CORS only when `cors_allow_null_origin=true`; missing Origin gets no wildcard.
- Ask before destructive ops (full DB reset, prod deploy, archive changes without `--yes`).
- Qdrant collection IDs and task locks are process-scoped or Redis-backed; do not assume cross-restart persistence for caches.

## Pull request checklist
- Run targeted verification commands and include output.
- Update docs, i18n, schemas, or fixtures when behavior changes.
- Call out risks, migrations, or follow-ups.
- After implementation use `finishing-a-development-branch` skill to decide merge/PR/cleanup.
- If conventions or architecture evolve, update this file, CLAUDE.md, or README.

## Skills & tools (Pi harness)
Prefer `ctx_*` family to protect context window. Follow superpowers skills (TDD via `test-driven-development`, etc.) and `subagent-driven-development` for parallel work. Use LSP (`lsp_navigation`, `lsp_diagnostics`), `ast_grep_search` for code intelligence.

**This is living documentation. Update when patterns change.**

Last updated: 2026-06-05 (removed non-existent openspec reference, added docs directory structure, verified commands and architecture against current codebase)

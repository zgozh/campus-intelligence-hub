# OSS_REUSE — 开源复用与原创边界

> 记录新版 Campus Intelligence Hub 2.0 复用了哪些 OSS、如何复用、原创增量是什么。
> 底座：`haoyiyin/basjoo`（MIT License，Copyright (c) 2026 haoyiyin）。

---

## 1. 主底座：Basjoo

- **Repository**：`https://github.com/haoyiyin/basjoo`
- **License**：MIT（可商用/参赛，仅需保留版权声明与许可文本）
- **Clone**：浅克隆到 `D:\develop\workspace\_oss_ref\basjoo`（参考目录，不直接作为工作区）
- **用途**：运行底座（FastAPI + Next.js + Qdrant + PostgreSQL + Redis + Scrapling + 外部模型 API + Docker Compose）

### 1.1 直接复用（不改或微改）

| 文件/目录 | 用途 |
|----------|------|
| `backend/services/llm_service.py` | Provider Adapter 框架（BaseLLMService + Mock + OpenAI 兼容 + 错误分类 + 重试 + 工厂）。已内置 aliyun/DashScope |
| `backend/services/qdrant_service.py` | Qdrant 向量读写封装 |
| `backend/services/scrapling_client.py` / `scraper.py` / `scraping_provider.py` / `url_service.py` / `url_safety.py` | URL 抓取抽象 + SSRF 防护 |
| `backend/services/auth_service.py` + `api/endpoints/auth.py` | JWT 登录鉴权 |
| `backend/middleware/rate_limit.py` | 限流 |
| `backend/api/v1/sse_utils.py` | SSE 流式 |
| `backend/services/scheduler.py` | APScheduler 定时调度 |
| `backend/services/document_parser.py` / `file_service.py` | 文件上传/解析 |
| `backend/i18n/` + `frontend-nextjs/src/locales/` | 中英 i18n |
| `backend/core/encryption.py` | API key 加密 |
| `scrapling-service/` | 独立 Scrapling 爬虫微服务（抗反爬、真实浏览器抓取） |
| `frontend-nextjs/app/(auth)/` + `(dashboard)/layout.tsx` + `src/components/AdminLayout.tsx` + `ChatPanel.tsx` + `MarkdownRenderer.tsx` | Next.js App Router 骨架、登录、后台布局、聊天、Markdown 渲染 |
| `docker-compose.yml` 的 redis/postgres/qdrant/scrapling 服务段 | 基础设施编排 |

### 1.2 修改复用（结构保留、语义重构）

| 文件/目录 | 改动 |
|----------|------|
| `backend/models.py` | 去多租户 `Workspace/Agent/Quota/Tenant/Widget` 客服语义 → 校务实体 `Source/CollectionJob/RawDocument/DocumentVersion/KnowledgeObject/KnowledgeRelation/KnowledgeTag/ReviewTask/Conflict/Conversation/AnswerCitation/Digest/AuditLog/ModelUsage` |
| `backend/services/kb_retrieval_service.py` / `kb_service.py` / `kb_document_processor.py` | 检索链路融合现有 hybrid（dense+sparse→归一化→时间衰减→过期降权→断崖截断）+ 外部 rerank + freshness/conflict 感知 |
| `backend/services/llm_service.py`（embedding 部分） | embedding 从 JINA 扩展为可插拔（DashScope text-embedding-v3/v4 默认 + OpenAI 兼容 + Mock） |
| `backend/config.py` | 配置面改为校务中台（DASHSCOPE_* 默认、Qdrant/PG、采集频率、检索参数） |
| `frontend-nextjs` 各页面 | 业务名词 Agent→校务中台；新增 Sources/Jobs/KnowledgeObjects/Review/Radar/Digest 页面 |
| `docker-compose.yml` | 默认 profile 收敛为 `docker compose up -d --build`（去掉 prod/dev 双 profile 的复杂度，保留 demo 覆盖文件） |

### 1.3 删除（与校务中台无关）

- `widget/`（嵌入式客服组件）
- `WorkspaceQuota` / `Tenant` 多租户 SaaS 配额与计费相关
- `allowed-host` / `blocked-host` 等 widget 跨域测试 host
- 多余 Provider 分支（收敛为 openai-compatible 抽象 + 明确的白名单 provider）

## 2. 辅助底座（仅架构/能力参考，不直接复制代码）

| 仓库 | License | 吸收点 |
|------|---------|--------|
| `loglux/RAG-Knowledge-Base-Platform` | 待核验 | Hybrid Retrieval(BM25+dense)、citation、section-aware 检索、KB export/import |
| `OptyxStack/rag-knowledge-base-chatbot` | 待核验 | Crawl 页面、Documents 页面、API Tokens 设计、Celery 任务队列思路 |

## 3. 迁移自现有项目（原创业务资产，非第三方）

见 `CURRENT_SYSTEM_AUDIT.md` 第 3 节完整清单。核心：gzhu/gznews 采集适配器、simhash 去重、规则+LLM 打标、有效期推断、dense+sparse 混合检索、引用问答提示词、六大专题域、18 篇演示数据、20 题演示清单。

## 4. 原创新增（本项目独有，比赛原创边界）

| 模块 | 说明 |
|------|------|
| Campus Source System | 校务化 Source（manual/website/list_page/file/api）+ CollectionJob 状态机（PENDING/RUNNING/SUCCESS/FAILED/PARTIAL） |
| Knowledge Object Model | 结构化知识对象（type/title/department/effective_from/to/entities/facts/version/confidence/status）+ 关系 + 标签 |
| Freshness Engine | 有效期识别 + 版本新旧切换（OLD→EXPIRED，NEW→ACTIVE）+ 问答优先 ACTIVE |
| Conflict Engine | 同字段多来源冲突检测（如两文档报名截止不一致）+ 人工裁决 |
| Review Queue | 低置信度(<0.75)或冲突知识进入人工审核（Approve/Reject/Edit），Human-in-the-loop |
| Knowledge Radar | 运营看板（今日新增/更新/待审/将过期/来源异常/冲突 + 部门活跃度） |
| Campus Digest | 自动日报/周报（Markdown/PDF/网页），体现"自动采集在持续运行" |
| Mock/Demo Mode | `LLM_PROVIDER=mock` + `docker compose -f docker-compose.demo.yml` + RESET_DEMO/SEED_DEMO，断网也能演示 70% |

## 5. Attribution 与合规

- 保留 Basjoo 的 `LICENSE`（MIT）与版权声明；新增 `NOTICE` 记录复用来源。
- `OSS_REUSE.md` 维护复用边界：Repository / URL / License / Commit / Reused files / Modified files / Removed files / Original modules / Attribution。
- 三个辅助底座若最终复用具体代码，需逐一核验 License 后补充记录；未核验前仅借鉴架构。

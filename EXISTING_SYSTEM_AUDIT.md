# EXISTING_SYSTEM_AUDIT — Campus Intelligence Hub 1.0 现状审计

> 依据《（完善版）最终冲奖Spec v4.0》§2 / §60 对 `zgozh/campus-intelligence-hub` 现有原型（commit 37a659f）做审计。
> 结论先行：**现有原型已具备 70% 的产品骨架，可直接作为 2.0 底座；最核心缺口是 ChangeEvent / Change Radar / Diff、SourceVersion、Freshness 分级、Knowledge Health、融合检索评分、MCP、自动采集调度。**

---

## 1. 系统概述（已实测）

- 技术栈：FastAPI + Next.js 14 (App Router) + antd v5 + PostgreSQL(pgvector) + Qdrant + Redis + Scrapling 爬虫微服务。
- 底座：Basjoo(`haoyiyin/basjoo`) 提供登录/RBAC、URL/File ingestion、Qdrant、多 Provider LLM（`get_llm_service`）、SSE、调度、admin dashboard、widget。
- 校务原创模块已实现：Source / CollectionJob / RawDocument / KnowledgeObject / Conflict / ReviewTask / Digest + freshness / conflict / radar / ask。
- 采集：`gzhu`/`gznews` 站点适配器（栏目映射 通知公告/新闻动态）+ 指纹去重 + 版本管理（normalized_url + content_hash，同 URL 异 hash → version+1，旧 KO 标 EXPIRED）。
- 模型：DashScope（qwen-plus LLM + text-embedding-v3 embedding），无 key 自动 Mock。
- 部署：`docker compose up -d --build` 单命令，6 容器全 healthy（已实测），前端 24 页面编译通过。
- 已推送 Gitee `origin`（git@gitee.com:zgozh/campus-intelligence-hub.git），master = 37a659f。

---

## 2. 已有功能矩阵

### 后端实体（models.py）
| 实体 | 状态 | 说明 |
|------|------|------|
| Source | ✅ | source_type/base_url/crawl_frequency/max_pages/status/last_crawled_at/last_success_at/last_error；**缺 department、category、allowed_domain、robots/rate 策略** |
| CollectionJob | ✅ | status/stage_trace(Fetch→Parse→Clean→Classify→Dedup→Index)/params/result |
| RawDocument | ✅ | version/content_hash/normalized_url/canonical_title/column/department；**充当文档版本载体，无独立 SourceVersion** |
| KnowledgeObject | ✅ | type/title/department/effective_from/to/facts/summary/tags/confidence/status/version/source_url |
| Conflict | ✅ | object_a/b/field/value_a/b/status |
| ReviewTask | ✅ | knowledge_object_id/reason/status |
| Digest | ✅ | period/title/content(Markdown) |
| **ChangeEvent** | ❌ MISSING | **spec §31/§33 核心，无** |
| **SourceVersion** | ❌ MISSING | **spec §32，无** |
| **ModelUsage** | ❌ MISSING | spec §51 观测，无 |
| **Evidence** | ❌ MISSING | citation 在聊天消息里，无独立 evidence 表 |
| Department / Role 独立表 | ❌ | department 为字符串字段，无独立表 |

### 后端 API（api/v1）
- `source_endpoints.py`：`GET/POST/PUT/DELETE /sources`、`POST /sources/{id}/run`（带 max_pages/column）、`POST /sources/{id}/pause`、`GET /jobs`、`GET /jobs/{id}`、`POST /refresh`、`GET /conflicts`、`POST /conflicts/{id}/resolve`、`GET /review-tasks`、`POST /review-tasks/{id}/approve|reject`、`GET /radar`、`POST /digests/generate`、`GET /digests`、`GET /digests/{id}`。
- `ask_endpoints.py`：`POST /search`、`POST /ask`、`GET /knowledge-objects`。

### 后端 service 能力
- `collection_service.run_collection`：抓取→解析→去重→版本→KO 编排→向量入库。
- `search_service.search_knowledge`：语义优先 + 关键词补充 + 兜底最新 PUBLISHED（**非评分融合**）。
- `ask_service.ask`：检索→组装上下文→LLM 生成+引用（含 type/department/status/effective_to/summary，**无 freshness 分级/confidence 字段**）。
- `knowledge_service.build_knowledge_object`：分类/摘要/事实/TO 构建（规则链路）。
- `freshness_service.refresh_freshness`：**仅 expired 标记，无 Fresh/Aging/Stale/Unknown 分级与分数**。
- `radar_service.radar_stats`：new_today/review_pending/conflict_open/expiring/source_error/total_ko/published/expired/source_activity（**无综合 Knowledge Health Score**）。
- `conflict_service.detect_conflicts` / `review_service.build_review_queue/approve/reject`：✅。
- `digest_service.generate_digest`：日报/周报 ✅。
- `agents/classifier.py`（分类+专题标签）、`agents/extractor.py`（部门+有效期）、`agents/curator.py`（规则摘要截断）、`agents/embedding.py`（DashScope embedding）、`services/vector_service.py`（Qdrant REST，UUID point id）。

### 前端（frontend-nextjs）
- 路由（App Router）：`/`、`/sources`、`/jobs`、`/knowledge-objects`、`/radar`、`/review`、`/ask`、`/digests`、`/users`、`/login`、`/register` + Basjoo 原生 `/agents`、`/chat`、`/playground`、`/sessions` 等。
- 视图：`Dashboard/Sources/Jobs/Radar/Review/Digests/AskAI/KnowledgeObjects/AdminUsers`（antd 化）+ Basjoo 原生 `Agents/AgentSelector/Chat/Playground/Sessions/URLManagement/FileUploadManagement/KnowledgeBaseSetup/Setup`。
- 组件：`AdminLayout`(Sider+Menu+底部用户信息)、`AppProviders`(ConfigProvider zhCN)、`AuthContext`、`RequireAuth`(已放开角色)、`api.ts`(统一 API 客户端)。

### 组件-API 绑定检查（用户关注）
- 校务 view ↔ api 方法 全部绑定 ✅：
  - Dashboard→`getRadar`；Sources→`listSources/createSource/runSource/pauseSource/deleteSource`；Jobs→`listJobs`；Radar→`getRadar`；Review→`listReviewTasks/approveReviewTask/rejectReviewTask`；Digests→`listDigests/generateDigest`；AskAI→`askQuestion`；KnowledgeObjects→`listKnowledgeObjects`。
- api.ts 校务方法 ↔ 后端端点 全部对上 ✅（listSources→GET /sources、runSource→POST /sources/{id}/run 等）。
- **漏组件**：无 `/changes`（Change Radar 专页）、无 Diff 组件、无 Knowledge Health 仪表、无 `/collections` 专页、无部门/驾驶舱视图。
- **漏 API**：无 `/changes`、`/changes/{id}/diff`、无 Knowledge Health、无 `/sources` 自动发现、无 MCP 端点。

---

## 3. 审计分类

### KEEP（保留）
- 全部校务后端实体与 API（Source/CollectionJob/RawDocument/KnowledgeObject/Conflict/ReviewTask/Digest + source/ask 端点）。
- 采集适配器体系（SiteAdapter 基类 + gzhu/gznews + 去重/版本）。
- vector_service + embedding + qdrant（语义检索底座）。
- provider 抽象 `get_llm_service`（多 Provider，无 key Mock）。
- 前端 antd 化 9 页 + AdminLayout + api.ts + AuthContext + 登录注册。
- Docker Compose 单命令、healthcheck、6 容器。
- 现有演示数据 `seed_demo`（18 篇六大专题域）+ 真实采集源（gzhu 通知公告）。

### REUSE（复用/参考）
- Basjoo：登录/RBAC、URL/File ingestion、Qdrant、SSE、调度、多 Provider、admin dashboard 组件——**继续作为底座**。
- Crawler/Ingestion：Scrapling 爬虫微服务 + ScraplingClient 复用。
- 前端参考 Basjoo/Caddy（`i-dot-ai/caddy`）的 Collection/Resource/Knowledge UI 布局、SentiWiki 的采集→结构化→索引管道、rag-demo 的 evidence/citation 呈现——**不整仓引入，参考模式**。

### REFACTOR（重构/增强）
- `search_service`：由"语义+关键词+兜底"升级为 **融合评分**（semantic+lexical+authority+freshness+recency）。
- `ask_service`：citation 补 `confidence`+`freshness` 分级+`effective_from`；Answer Guard 显式强化。
- `freshness_service`：由仅 expired 升级为 Fresh/Aging/Stale/Unknown 分级 + Freshness Score。
- `radar_service`：新增综合 **Knowledge Health Score**（公式公开）。
- `Source`：补 department/category/allowed_domain 字段。
- `knowledge_service`：增加权威度、版本级的变更语义。

### DELETE（删除/不保留）
- Customer Support / Agent Widget 业务语义（Basjoo 遗留）——**不进入校务主链路，保留登录/RBAC/Qdrant 等基础设施即可**。
- 无意义彩虹 dashboard、大量纯装饰图表。

### MISSING（缺失，按 spec 优先级）
| spec | 缺失项 | 优先级 |
|------|--------|--------|
| §12/§33 | **ChangeEvent 实体 + 变更检测（TITLE/CONTENT/DATE/ATTACHMENT changed + severity）** | P0 |
| §13 | **Diff Viewer（前后对照 + 高亮）** | P0 |
| §48 | **/changes Change Radar 页面（What changed? + 部门/级别/时间）** | P0 |
| §32 | SourceVersion 实体 | P1 |
| §15 | Freshness 分级 Fresh/Aging/Stale/Unknown + Score | P1 |
| §22 | Authority Score（配置化） | P1 |
| §21 | 融合检索评分 | P1 |
| §25 | Knowledge Health Score（综合，公式公开） | P1 |
| §19 | Answer 元数据（Effective Date/Freshness/Confidence/Related） | P1 |
| §20 | Answer Guard 显式化 | P1 |
| §27 | **自动采集调度（每天自动发现→采集→对比→标记→待审）** | P1 |
| §11 | 自动发现（URL→栏目/部门）+ Allowed Domains 限定 | P1 |
| §29/§56 | **MCP 工具（campus/search|source|knowledge|changes|review）** | P2 |
| §30 | 对外公开 API（/api/knowledge/search 等） | P2 |
| §51 | ModelUsage / Job Log / Audit Log 观测 | P2 |
| §35 | Prompt Injection 显式防护（网页内容仅作 DATA） | P2 |
| §42 | 部门视角（我的来源/变更/知识/审核/日报） | P2 |
| §43 | 校领导驾驶舱（Health/Critical Changes/Risk/Departments） | P3 |
| §9 | Source.department/category + Source 完整字段 | P2 |

---

## 4. 关键风险

1. **变更检测链路不存在**：当前 version 递增但无独立 ChangeEvent、无 diff 快照、无 severity 分级——这是比赛最核心亮点，需重点补齐。
2. **检索无融合评分**：目前语义+关键词是"并集去重"，非加权融合，Authority/Freshness 未参与。
3. **无自动调度**：采集靠手动 run，不符合"每天自动维护"定位。
4. **前端无 Change Radar/Diff**：最强视觉页缺失。
5. **前端仍有 Basjoo 客服语义菜单**残留（agents/chat/sessions/playground 等），需在校务后台屏蔽或改造为主链路外工具。

---

## 5. 建议 EPIC 顺序（映射 spec §61-72）

- EPIC 1：稳定 docker compose（已完成，容器全 healthy）。
- EPIC 2：Source Registry 增强（department/category/schedule/allowed_domain + 自动发现）。
- EPIC 3：Crawler/Ingestion（已具备，扩展 PDF/DOCX/CSV 解析）。
- EPIC 4：SourceVersion + ChangeEvent（含 content_hash 快照）。
- EPIC 5：Change Radar + Diff Viewer（前端 + 变更检测 + 分级）。
- EPIC 6：Knowledge Object 增强（权威度/版本/变更语义）。
- EPIC 7：Conflict Engine（已具备，增强 diff 证据）。
- EPIC 8：Governance（approve/reject/edit/publish/archive）。
- EPIC 9：AI Assistant 升级（融合检索 + Answer Guard + citation 元数据）。
- EPIC 10：Digest + Knowledge Health + 部门/驾驶舱。
- EPIC 11：MCP + 对外 API。
- EPIC 12：Final Integration + 端到端 Golden Path。

> 详细任务拆解见 `TASKS.md`；OSS 复用边界见 `OSS_REUSE.md`；架构见 `ARCHITECTURE.md`；关键决策见 `DECISIONS.md`。

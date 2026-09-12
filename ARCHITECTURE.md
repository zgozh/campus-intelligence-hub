# ARCHITECTURE — 校务智汇中台 2.0（Campus Intelligence Hub）

> 目标架构：以 Basjoo 为底座、DashScope 为默认模型 API、Docker 一键部署的校务 AI 自动数据采集与知识管理中台。

---

## 1. 服务拓扑

```
                        ┌────────────────────────────┐
       浏览器            │  nginx（可选，反代/静态）     │
   http://localhost:3000 └────────────┬───────────────┘
                                      │
                        ┌─────────────▼─────────────┐
                        │  frontend  (Next.js 14)    │  管理后台 + 问答端
                        │  App Router / React / TS   │
                        └─────────────┬─────────────┘
                                      │ REST + SSE
                        ┌─────────────▼─────────────┐
                        │  backend   (FastAPI)       │  单体：采集编排 + 知识化 + 检索 + 问答
                        │  services/ + api/v1/       │
                        └──┬────────┬────────┬───────┘
             ┌─────────────┘        │        └──────────────┐
             ▼                      ▼                        ▼
     ┌───────────────┐    ┌──────────────────┐    ┌──────────────────┐
     │  PostgreSQL    │    │  Qdrant（向量）    │    │  Redis（缓存/限流/ │
     │  pgvector      │    │  语义检索          │    │   任务队列）       │
     └───────────────┘    └──────────────────┘    └──────────────────┘
             ▲
             │ 采集内容落库
     ┌───────┴───────────┐          ┌────────────────────────────┐
     │ scrapling-service  │◄────────│  外部模型 API（默认 DashScope）│
     │ （Scrapling 爬虫微服务）│        │  LLM + Embedding + Rerank     │
     └───────────────────┘          └────────────────────────────┘
```

**服务清单**（严格收敛，禁本地模型）：

| 服务 | 技术 | 职责 |
|------|------|------|
| `backend` | FastAPI + SQLAlchemy | 采集编排、知识化 Agent、检索、问答、审核、Digest、Radar、Provider Adapter |
| `frontend` | Next.js 14 + React + TS | 管理后台 + 问答端 |
| `scrapling-service` | Scrapling（独立微服务） | 抗反爬真实浏览器抓取 |
| `postgres` | pgvector/pgvector:pg16 | 元数据（Source/Job/Document/KO/Conflict/会话/审计/用量） |
| `qdrant` | qdrant/qdrant | 向量检索（dense，首版）+ 后续 sparse/BM25 |
| `redis` | redis:7 | 缓存、限流、任务状态 |

## 2. 数据模型（核心实体）

```
Source ──< CollectionJob ──< RawDocument ──< DocumentVersion
                                                │
                                                ▼
                                    KnowledgeObject ──< KnowledgeRelation
                                       │      │
                                       │      └──< KnowledgeTag
                                       ├──< ReviewTask（低置信/冲突）
                                       └──< Conflict（字段级冲突）
Conversation ──< AnswerCitation
Digest / AuditLog / ModelUsage（横切）
```

关键字段（沿用 spec §24 + 现有项目资产）：

- **Source**：id/name/type(manual·website·list_page·file·api)/url/schedule/status/last_run_at/last_success_at/last_error
- **CollectionJob**：id/source_id/status(PENDING·RUNNING·SUCCESS·FAILED·PARTIAL)/stage_trace(Fetch→Parse→Clean→Classify→Dedup→Index)/params/result/error
- **RawDocument**：id/source_id/url/title/content_hash/normalized_url/publish_time/fetched_at/storage_path
- **DocumentVersion**：id/raw_document_id/version/content_hash/diff_summary/created_at
- **KnowledgeObject**：id/raw_document_id/type(Announcement·Policy·Course·Department·Contact·Event·Procedure·FAQ·Regulation·Research)/title/department/effective_from/effective_to/entities/facts/summary/tags/version/confidence/status(DISCOVERED→PROCESSING→REVIEW_REQUIRED→PUBLISHED→UPDATED→EXPIRED→ARCHIVED)
- **Conflict**：id/object_a/object_b/field/value_a/value_b/confidence/status/resolved_by

## 3. 采集管道（Collector Job 内部状态机）

```
Source → [Fetch → Normalize → Extract → Fingerprint → Diff → Classify → Extract-Facts → KnowledgeObject → Index]
           │        │          │          │           │         │            │               │
        scrapling  trafilatura 标题/日期  content_hash 版本比较   5类型分类   字段抽取         Qdrant
```

- **Fingerprint**：normalized_url + content_hash + canonical_title + publish_time（复用现有 dedup.py）
- **Diff**：标题同 + 正文 hash 不同 → 新 DocumentVersion；内容完全未变 → 不入库（幂等）
- **降级**：LLM 分类/抽取失败 → 规则兜底（rules.py）→ 仍失败则标 REVIEW_REQUIRED，不阻断主链路

### 3.1 采集参数（时间范围 / 栏目 / 条数上限）

`POST /api/v1/sources/{id}/run` 除 `max_pages`/`column` 外新增 `since`/`until`（YYYY-MM-DD）、
`only_new`、`max_items`；全部可选，缺省即历史行为（向后兼容）。

- **发布时间过滤**：在 `extract_article` 之后、入库之前按 `publish_time` 过滤；
  `RawDocument.publish_time` 是 `String(20)`，解析支持 `%Y-%m-%d`（兼容 `%Y-%m-%d %H:%M`、`%Y/%m/%d`、`%Y年%m月%d日`），
  **解析失败视为"不受时间约束"放行**（避免脏数据误杀）。
- **水位（only_new）**：以该源 `last_success_at` 为水位，取 `since = max(显式 since, 水位日期)`。
- **条数硬上限**：`campus_collect_max_items`（默认 500），超出截断并在 `result.truncated` 留痕。
- **可解释**：过滤条件与命中/丢弃计数写入 `CollectionJob.params` 与 `stage_trace`（`Filter/filtered_in/filtered_out/since/until/truncated`）。

### 3.2 栏目（column）与栏目动态发现

栏目是"采集内容筛选"的取值空间。历史实现把栏目写死在适配器里（每源只能产出一个值），
与前端硬编码选项不对齐 → 选了筛不出数据。现在：

- 适配器按**列表页**推导栏目：`declared_columns`（显式栏目→路径映射）→ 页面当前栏目导航/面包屑 → 带分隔符的 `<title>` 栏目名 → `default_column` 兜底；
- `GET /api/v1/sources/{id}/columns` 返回"历史分布（`RawDocument.column` group-by，带计数，origin=history）+ 适配器声明（origin=adapter，count=0）"的并集，进程内缓存 TTL 300s，采集完成后自动失效；
- 因此"能选的栏目"与"能筛到的数据"**同源**。

### 3.3 采集礼貌与安全

- 同站点连续请求最小间隔 `campus_collect_interval_ms`（默认 500ms，0=关闭）；并发抓取由锁串行化保证间隔真实生效。
- 所有列表页/详情页 URL 强制通过 `services/url_safety.py` 的 SSRF 校验（`campus_collect_ssrf_check` 可关）；
  被拦 URL **不发出请求**，列表页被拦直接失败，详情页被拦记入 `failures` 并继续其它条目。
- 抓取失败重试 1 次（退避 2s），第二次仍失败才进入失败路径。

### 3.4 时间真源（"最近采集时间"）

`Source.last_crawled_at`（最近尝试）与 `Source.last_success_at`（最近成功）**统一由
`services/collection_service.run_collection` 维护**——端点、闭环、调度三条链路都调用它，
因此不再出现"只有手动点击才更新时间、闭环/定时采集后监控时间不动"的问题。监控接口
（`GET /api/v1/sources/monitor`）返回两个时间 + `last_error` + 顶层 `refreshed_at` 快照时间，
前端以 `last_success_at ?? last_crawled_at` 展示，并用 `refreshed_at` 给出"已更新 · HH:mm:ss"的确定反馈。

## 4. 检索链路（Ask AI）

```
Question → Intent → Filter → Hybrid Retrieve → Rerank → Freshness Check → Conflict Check → Answer + Citation
```

- **Hybrid Retrieve**：dense(Qdrant) 必跑，sparse/BM25 失败降级仅 dense；min-max 归一化融合 → 时间衰减(半衰期30天) → 过期降权(0.25) → 断崖截断(0.3)（迁移现有 hybrid.py）
- **Freshness Check**：优先 ACTIVE 版本；历史版本仅在用户显式询问时召回
- **Conflict Check**：命中冲突知识时在答案标注「⚠ 检测到多来源信息不一致」而非强答唯一结论
- **Citation**：每条结论附来源（标题/部门/日期/URL/版本），引用率目标 100%

## 4.1 智能运营闭环（SSE 实时流 + 运行记录 + 配置 Schema）

三层 Agent 闭环：**采集 Agent → 知识治理 Agent → 问答/运营 Agent**。改造后的关键点：

```
前端「一键运行闭环」
  → 先弹「运行配置面板」（字段由后端 Schema 动态渲染）
  → POST /api/v1/closed-loop/stream（配置体，SSE）
       run_started → 3 ×（stage_started → N × stage_decision → stage_finished）→ run_finished
  → 前端逐事件追加渲染（时间线随步骤生长，每步右侧显示完成时刻 + 耗时）
断线/回看：GET /api/v1/closed-loop/runs/{run_id} → 由 run_records + decision_logs
          物化为**与实时同构**的事件序列（前端同一个 reducer 渲染两条路径）
```

| 事件 | 触发时机 | 关键字段 |
| --- | --- | --- |
| `run_started` | 建流后立即（≤1.5s 首事件） | run_id / started_at / config |
| `stage_started` | 每阶段开始 | stage(collection·governance·operation) / name / index / total |
| `stage_decision` | 每个决策产生（=落库时刻） | stage / agent / decision / detail / status / finished_at / duration_ms |
| `stage_finished` | 每阶段结束（含失败降级） | stage / status / detail / duration_ms |
| `run_finished` | 全部完成 | status(ok·partial·cancelled) / summary / duration_ms |
| `run_error` | 不可恢复错误（尽量不用） | message |
| `heartbeat` | 每 10s 无事件 | ts |

- **配置 Schema 驱动**：`GET /api/v1/config-schema/{closed-loop|collection}` 返回字段定义（类型/默认值/范围/分组/`visible_if`），
  前端 `SchemaForm` 动态渲染、后端用同一份定义二次校验（校验后快照写入 `run_records.params`，**运行可复现**）。
- **决策产生即落库**：每个决策立刻 `INSERT decision_logs` 并 commit（修复旧实现"结束后批量写"导致运行中查不到任何步骤的问题）。
- **运行记录 `run_records`**：run_id/type/status/params/summary/error/cancel_requested/started_at/finished_at/duration_ms。
- **互斥与自愈**：同一时刻仅允许一个 `running` 闭环（重复点击 → 409 并回传 run_id）；
  超时 30 分钟仍未收尾的运行自动关闭为 error，避免互斥锁永久阻塞。
- **协作式取消**：`POST /api/v1/closed-loop/runs/{run_id}/cancel` 置标志，编排器在阶段之间检查并收尾为 `cancelled`。
- **降级**：单阶段 try/except，失败发 `stage_finished(status=error)` 后继续后续阶段，**绝不整流 500**；无 LLM Key 时走 Mock/规则兜底仍可完整演示。

## 4.2 通知中心（主动推送）

- 生产侧：校务快讯（`/sources`）、AI 洞察（`/insights`）、巡检告警（`/notifications`）写入时带上 `link` 跳转目标。
- 接口：`GET /notifications?kind=`（分类过滤）、`GET /notifications/unread-count`、
  `POST /notifications/{id}/read`、`POST /notifications/read-all`（幂等，返回 updated）。
- 前端：Header 铃铛点击展开受控 Popover（未读优先 + 标题清洗 + 本地化时间 + 点击跳转），
  未读数 30s 轻量轮询（不引 SSE 长连接，YAGNI），加载失败给可见重试而非静默。



## 5. Provider Adapter（模型服务 API 化）

```
Provider 接口（可插拔）
├── LLM：OpenAI-compatible（DashScope qwen 系列默认 / DeepSeek / SiliconFlow / OpenAI / 自定义 base_url）
├── Embedding：OpenAI-compatible（DashScope text-embedding-v3/v4 默认 / 其他兼容接口）
├── Rerank：DashScope gte-rerank-v2 默认（专有 rerank API）/ 可选关闭
└── Mock：全部返回确定性演示结果（LLM_PROVIDER=mock）
```

- 业务代码**只依赖 Provider 接口**，不写死任何 SDK/base_url。
- **Model Routing**（spec §33）：分类/抽取/摘要 → 快模型(qwen-turbo)；冲突分析/复杂问答 → 强模型(qwen-plus/qwen-max)；记录 model/input_tokens/output_tokens/latency/estimated_cost → `ModelUsage` 表。
- **Mock 模式**：`LLM_PROVIDER=mock` 或 `docker compose -f docker-compose.demo.yml up -d`，断网/限流/key 过期也能演示 70%。

## 6. 部署

```bash
git clone <campus-intelligence-hub>
cp .env.example .env          # 填 DASHSCOPE_API_KEY
docker compose up -d --build
# http://localhost:3000
```

- 无 Ollama / 无本地模型 / 无 GPU / 无 CUDA / 无 Kafka / 无 K8s / 无 Elastic 全家桶。
- `docker-compose.demo.yml` 提供 Mock + 种子演示数据覆盖。

## 7. 目录结构（继承 Basjoo + 新增域）

```
campus-intelligence-hub/
├── backend/                 # FastAPI（继承 Basjoo services/ + api/v1/）
│   ├── app/
│   │   ├── api/v1/          # 路由
│   │   ├── models/          # SQLAlchemy 校务实体
│   │   ├── services/        # auth/qdrant/llm/scraper/scheduler/...（继承）
│   │   ├── collectors/      # 站点适配器 + 采集引擎（迁移）
│   │   ├── ingestion/       # 解析/清洗/分块/入库（迁移）
│   │   ├── knowledge/       # KO/版本/有效期/指纹（迁移+原创）
│   │   ├── agents/          # Classifier/Extractor/Curator/QA/Dedup 五 Agent
│   │   ├── search/          # hybrid/rerank/citation（迁移）
│   │   ├── conflicts/       # 冲突检测（原创）
│   │   ├── review/          # 审核队列（原创）
│   │   ├── radar/           # Knowledge Radar（原创）
│   │   ├── digest/          # 日报/周报（原创）
│   │   └── providers/       # LLM/Embedding/Rerank/Mock Adapter
│   └── tests/
├── frontend/                # Next.js（继承 Basjoo frontend-nextjs + 新增页面）
├── scrapling-service/       # 爬虫微服务（继承）
├── demo-data/               # 种子演示数据（迁移）
├── docs/                    # adr/architecture/demo
├── docker-compose.yml
├── docker-compose.demo.yml
├── .env.example
└── OSS_REUSE.md / CURRENT_SYSTEM_AUDIT.md / ARCHITECTURE.md / TASKS.md / AGENTS.md
```

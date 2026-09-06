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

## 4. 检索链路（Ask AI）

```
Question → Intent → Filter → Hybrid Retrieve → Rerank → Freshness Check → Conflict Check → Answer + Citation
```

- **Hybrid Retrieve**：dense(Qdrant) 必跑，sparse/BM25 失败降级仅 dense；min-max 归一化融合 → 时间衰减(半衰期30天) → 过期降权(0.25) → 断崖截断(0.3)（迁移现有 hybrid.py）
- **Freshness Check**：优先 ACTIVE 版本；历史版本仅在用户显式询问时召回
- **Conflict Check**：命中冲突知识时在答案标注「⚠ 检测到多来源信息不一致」而非强答唯一结论
- **Citation**：每条结论附来源（标题/部门/日期/URL/版本），引用率目标 100%

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

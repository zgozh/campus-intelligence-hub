# CURRENT_SYSTEM_AUDIT — 现有 school-knowledge-hub 审计

> 审计对象：`D:\develop\workspace\school-knowledge-hub`（zgozh/school-knowledge-hub）
> 审计目的：决定哪些业务逻辑/数据模型/演示资产迁入新版 Campus Intelligence Hub 2.0，哪些删除或重构。
> 审计方式：真实读代码（README / docker-compose / pyproject / shared / collector / qa_api 核心文件），非猜测。

---

## 1. 现状概览（真实架构）

| 维度 | 事实 |
|------|------|
| 前端 | Vue 3 + Element Plus + echarts + markstream-vue，双端：问答端 `/` + 管理端 `/admin` |
| 后端 | Python 三服务（FastAPI）：`collector`(:8002 采集) / `qa_api`(:8003 问答) / `model_server`(:8001 本地推理)，`shared` 跨服务复用 |
| 包管理 | uv（pyproject.toml + uv.lock），Python >=3.11 |
| 存储 | Milvus(:19530) + etcd(Milvus 依赖) + MinIO(:9000/9001 原文对象) + MongoDB(:27017 元数据/会话) —— **四件套，重** |
| 本地模型 | **BGE-M3(embedding, dense+sparse) + bge-reranker-large(rerank)**，FlagEmbedding 加载，需提前下载权重挂载，冷启动 30–90s |
| LLM | DeepSeek 主（deepseek-chat）+ DashScope 备援（qwen-plus） |
| 采集 | gzhu 通知公告 + gznews 新闻网两个站点适配器；httpx+selectolax 抓取；trafilatura+LLM 兜底解析；URL/内容哈希 + simhash 去重；规则+LLM 专题打标；有效期识别；APScheduler 调度 |
| 检索 | dense(COSINE 0.8)+sparse(IP 0.2) 双路 → min-max 归一化 → 时间衰减(半衰期30天) → 过期降权(0.25) → bge-reranker 重排 → 断崖截断(0.3) → DeepSeek 流式 → 来源引用 |
| 测试 | 后端 101 pytest 通过；前端 34 vitest 通过；20 题演示引用率 100% |
| 专题域 | 六大：新生入学 / 港澳生服务 / 教务学籍 / 后勤生活 / 就业创业 / 科研学术 |
| 一级分类 | 通知公告 / 办事指南 / 规章制度 / 新闻动态 |

## 2. 核心痛点（为什么必须升级）

1. **本地模型硬依赖**：BGE-M3 + reranker 必须下载权重、挂载、冷启动慢、换机器易炸 —— 违反 spec「模型服务 API 化」。
2. **存储偏重**：Milvus 要拖 etcd + MinIO 三件套；MongoDB 单独一套。Qdrant + PostgreSQL 即可覆盖同样需求且更轻。
3. **三服务 + 前端四镜像**：collector/qa_api/model_server 拆分是当年"重任务+在线低延迟"的产物，但新版统一进单一 FastAPI 后端 + 独立 Scrapling 采集微服务更简洁。
4. **前端是 Vue3**，而 Basjoo 底座是 Next.js 14 管理后台；按「以 Basjoo 为底座」路线，前端需迁移到 Next.js 生态。

## 3. 值得迁移的资产（文件级清单）

| 现有文件 | 迁移去向 | 说明 |
|---------|---------|------|
| `collector/crawler/gzhu.py` / `gzhu_cms.py` / `gznews.py` | 新后端 `crawlers/` 站点适配器 | 广州大学官网/院系/新闻网选择器与分页逻辑，直接复用 |
| `collector/crawler/base.py` / `engine.py` | 采集引擎抽象 | 站点适配器协议、抓取编排 |
| `collector/dedup.py` | `knowledge/fingerprint.py` | URL sha256 + 内容 md5 + simhash 近重复（spec §7 指纹现成实现） |
| `collector/lifecycle/validity.py` | `knowledge/freshness.py` | 截止日期正则推断 + 类别默认有效期(90天) + 过期判定（spec §27 雏形） |
| `collector/tagger/rules.py` / `llm_topics.py` | `agents/classifier.py` + 规则兜底 | 一级分类 + 六大专题域关键词 + LLM 兜底（spec §10 Agent1 雏形） |
| `collector/parser/extract.py` / `file_parser.py` | `ingestion/parser/` | 正文抽取 + PDF/Word/文本解析 |
| `collector/ingest/splitter.py` / `writer.py` | `ingestion/` | 分块 + 幂等入库（先删后插） |
| `qa_api/retriever/hybrid.py` | `search/hybrid.py` | dense+sparse 融合 + 时间衰减 + 过期降权 + 断崖截断 + 降级链路（核心资产） |
| `qa_api/reranker/rerank.py` | `search/rerank.py`（改用外部 rerank API） | 重排逻辑抽象 |
| `qa_api/generator/llm.py` / `prompts.py` | `search/answer.py` + prompts | 流式生成 + 引用问答提示词 |
| `shared/config.py` / `clients.py` / `errors.py` / `retry.py` / `logging.py` | 新后端横切层 | dataclass 单例配置、客户端单例、重试、日志（DocMind 配方） |
| `scripts/seed_demo.py` / `demo_templates.py` | `demo-data/` + `scripts/` | 18 篇六大专题域模拟文档（对应 spec Mock/Demo 模式） |
| `docs/demo/20-questions.md` | 保留为演示问题清单 | 20 题逐题实测，引用率 100% |

## 4. 必须删除 / 替换

| 项 | 处置 | 原因 |
|----|------|------|
| `model_server/`（本地 BGE-M3 + reranker） | **删除**，改为外部 Embedding/Rerank API | 部署痛点根因 |
| Milvus + etcd + MinIO | **替换**为 Qdrant（向量）+ PostgreSQL（元数据，原文存 PG JSONB 或本地卷） | 存储偏重 |
| MongoDB | **替换**为 PostgreSQL（SQLAlchemy，与 Basjoo 一致） | 收敛为单关系库 |
| Vue3 前端（`frontend/`） | **替换**为 Basjoo Next.js 前端骨架改造 | 底座路线决定 |
| 三服务 Dockerfile 拆分 | **收敛**为 Basjoo 的 backend + scrapling-service 两服务 | 简洁性 |

## 5. 数据模型映射（现有 Mongo 文档 → 新 PG 表）

| 现有（Mongo 概念） | 新版（PostgreSQL / SQLAlchemy） | 对应 spec 实体 |
|------------------|------------------------------|---------------|
| sources（采集源） | `Source` | §24 Source |
| tasks（采集任务） | `CollectionJob` | §24 CollectionJob |
| documents（原始文档） | `RawDocument` + `DocumentVersion` | §24 RawDocument / DocumentVersion |
| ——（无） | `KnowledgeObject` + `KnowledgeRelation` + `KnowledgeTag` | §8 原创核心 |
| ——（无） | `ReviewTask` / `Conflict` | §20 / §24 原创 |
| conversations（会话） | `Conversation` + `AnswerCitation` | §24 |
| ——（无） | `Digest` / `AuditLog` / `ModelUsage` | §24 / §33 |

## 6. 结论

现有项目**业务资产质量高**（采集适配器、去重、打标、有效期、混合检索、引用问答、演示数据、测试），但**底座（本地模型 + 四件套存储 + Vue3）是升级包袱**。迁移策略：**业务逻辑带走，底座全部换成 Basjoo 的（Qdrant + PG + Redis + Scrapling + 外部 API + Next.js）**，再叠加 spec 的原创模块。

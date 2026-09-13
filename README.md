# 校务智汇中台 2.0（Campus Intelligence Hub）

> 面向高校校务管理的 **AI 自动数据采集与知识管理中台** —— 把分散在各院系/部门官网的通知、公告、办事指南，自动采集、自动检测变化、自动治理成"可被 AI 可信引用"的校务知识，并以 REST / MCP 两种形式对外开放。
>
> 赛道：广州大学第二届「庆园杯」AI 创新应用大赛 · 类别③ 面向校务管理的 AI 自动数据采集与知识管理中台

**一句话定位**：让校务信息**自动更新、可信可查、AI 可用**的一站式知识中台 —— 不是聊天机器人，而是"校务知识的自动化数据中心"。

**部署前提**：**不需要下载任何本地模型、不需要 GPU、不需要 Ollama** —— 生成、向量化、精排全部走云端 HTTP API。唯一的模型依赖是**一个 `DASHSCOPE_API_KEY`**；连它也可以不填，系统会自动 Mock 降级，全链路仍可演示。详见[模型依赖](#模型依赖只需要一个-key不下载任何本地模型)。

---

## 目录

- [背景与真实痛点](#背景与真实痛点)
- [核心能力](#核心能力)
- [快速开始（三条命令）](#快速开始三条命令)
- [⚠️ 首次部署后是零数据 —— 三种取数方式](#️-首次部署后是零数据--三种取数方式)
- [界面导览](#界面导览)
- [系统架构](#系统架构)
- [关键能力与代码位置](#关键能力与代码位置)
- [对外开放：REST 与 MCP](#对外开放rest-与-mcp)
- [可信评测](#可信评测)
- [配置说明](#配置说明)
- [项目自有工具（真机验证）](#项目自有工具真机验证)
- [目录结构](#目录结构)
- [文档导航](#文档导航)
- [常见问题（FAQ）](#常见问题faq)
- [技术栈与许可](#技术栈与许可)

---

## 背景与真实痛点

高校校务信息长期存在"散、变、旧、乱、难复用"五个问题：

| 痛点 | 具体表现 | 本方案回应 |
| --- | --- | --- |
| **散** | 通知/制度/办事流程散布在十几个部门官网 | 统一数据源 + 自动发现 + AI 智能推荐采集 |
| **变** | 政策/截止日期频繁变动，人工盯不过来 | 变化检测 + 变更雷达 + 行级 Diff |
| **旧** | 引用了过期信息 | 新鲜度分级 + 时效衰减 + 临期提醒 + 一键归档 |
| **乱** | 网传与官方不一致，AI 回答无出处 | 证据引用 + Answer Guard 拒答 + 冲突检测与消解 |
| **难复用** | 各 AI 应用重复爬官网 | 中台 REST + MCP 一次建设、多方复用 |

## 核心能力

| 环节 | 能力 |
| --- | --- |
| **自动采集** | 数据源管理、同域自动发现、AI 智能推荐（LLM 评估价值/分类/建议频率）、**栏目动态发现**、**时间范围筛选**、仅采新内容、抓取礼貌（请求间隔可配）与 SSRF 校验 |
| **变化感知** | 内容指纹去重 + 版本管理 + **变更雷达**（TITLE/CONTENT/DATE_CHANGED + 高/中/低）+ 行级 Diff 高亮 |
| **知识治理** | 自动分类/字段抽取/有效期、权威度与新鲜度分级、审核队列 + **AI 审核助手**（摘要/风险/推荐动作）、冲突检测、发布/归档、**知识健康度**（公式公开） |
| **可信问答** | 融合评分检索（语义+关键词+权威度+新鲜度+时效衰减）→ **gte-rerank-v2 精排**（DashScope 云端 API，非本地模型）→ 意图/部门路由 → GraphRAG 线索 → **证据引用 + Answer Guard 防幻觉拒答** |
| **知识图谱** | LLM 三元组抽取、力导向可视化（缩放/拖拽/节点详情/类型筛选）、**关系路径问答**（返回子图与路径） |
| **自动化 Agent** | 三层 Agent 闭环（采集 → 知识治理 → 问答运营）、**运行配置面板**（Schema 驱动，可就地改参数）、**SSE 实时流式**执行、**决策时间线**（每步完成时刻+耗时，支持历史回放与取消） |
| **运营与推送** | 校务快讯、AI 洞察报告、日报周报、巡检告警、**站内通知中心**（分类筛选 / 一键全部已读 / 点击跳转） |
| **对外开放** | 公开 REST API + **7 个 MCP 工具**，其他高校或应用可直接调用，避免重复爬官网 |

## 快速开始（三条命令）

```bash
git clone git@github.com:zgozh/campus-intelligence-hub.git
cd campus-intelligence-hub
cp .env.example .env          # 唯一需要改的文件：填入 DASHSCOPE_API_KEY（不填也能跑，自动 Mock 降级）
docker compose up -d --build  # 6 个容器：backend / frontend / postgres / qdrant / redis / scrapling
```

> **整个部署只需要这一个 Key，不需要下载任何模型权重。**

打开 <http://localhost:3000>，用默认管理员登录：

```
邮箱：admin@campus.local
密码：campus123456
```

> 首次构建约 3–8 分钟（拉取基础镜像 + 编译前端）。健康检查：`curl http://localhost:8000/health`。

### 模型依赖：只需要一个 Key（不下载任何本地模型）

本项目**不需要**下载 BGE / reranker 之类的任何模型权重，**不需要 GPU**，也**不需要 Ollama**。上面 6 个容器里没有模型服务，镜像里也没有推理运行时（`torch` / `transformers` / `sentence-transformers` / `FlagEmbedding` 全部未安装）。

| 能力 | 由谁执行 | 形态 | 需要本地下载吗 |
| --- | --- | --- | --- |
| 生成 / 抽取 / 分类 / 摘要 / 洞察 / 审核建议 | DashScope `qwen-plus` | 云端 HTTP API | ❌ |
| 向量化（语义检索、知识图谱） | DashScope `text-embedding-v3`（1024 维） | 云端 HTTP API | ❌ |
| 检索结果精排 | DashScope `gte-rerank-v2` | 云端 HTTP API（专有 rerank 端点） | ❌ |
| 网页抓取与正文抽取 | `campus-scrapling` 容器（curl_cffi + readability） | 本仓库自建的抓取微服务，不是模型 | ❌ |

**唯一必填项就是 `DASHSCOPE_API_KEY`**（阿里云百炼，新账号有免费额度）。留空的后果不是"跑不起来"，而是自动 Mock 降级 —— 见下一节。

> 代码与数据库里会出现 `BAAI/bge-m3`、`jina-embeddings-v3` 这样的字样，那是**模型名字符串**，不是本地权重：`BAAI/bge-m3` 用于按名字推断向量维度（`backend/services/qdrant_service.py:21`），也是 SiliconFlow 等**云端** OpenAI 兼容 embedding 服务托管的同名模型的 API 参数。校务主链路默认不使用它们。

**一个例外（与本项目主链路无关）**：Basjoo 底座的「文件管理」页（`/files`，多租户 KB 文档管道）在做向量索引时，key 取自智能体设置里的 **embedding provider**（默认 `jina`，可选 `siliconflow`），**不读 `DASHSCOPE_API_KEY`**。不配它时该文档会以 embedding 失败落到 `error` 状态（可在文件列表看到原因），但**不影响采集 / 治理 / 问答 / 图谱 / 洞察 / 闭环等校务主链路**，也不影响下面三种取数方式中的任何一种。

## ⚠️ 首次部署后是零数据 —— 三种取数方式

**是的，全新 clone 部署起来是空库**：镜像里不含任何业务数据，PostgreSQL / Qdrant 卷都是空的（只有**表结构**由启动时的建表 + 幂等迁移执行器创建好）。所以启动后看到"知识总量 0、图谱空、问答无可引用来源"是**预期现象，不是故障**。三种方式让它有数据：

### 方式一：一键导入演示数据（最快，推荐给评委演示）

- **界面**：登录后进「智能闭环（AI 智能体中心）」→ 点「**导入演示数据**」。
- **命令行**（等价）：

```bash
# 方式 A：演示编排（含自动 seed 容器）
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build

# 方式 B：对已起好的栈手动灌入
docker compose exec -T backend python -m scripts.seed_demo
```

会写入一批**贴近真实校务场景**的知识对象（通知公告 / 办事指南 / 规章制度等模板），可直接用于演示图谱、问答、洞察与闭环。

其它演示脚本：`python -m scripts.seed_change`（变更事件）、`scripts.seed_conflict`（冲突样例）、`scripts.reset_demo`（清空演示数据）。

### 方式二：真实采集（最真实，需要网络可达目标站点）

1. 「数据源管理」→ 添加数据源（也可从预置的广州大学站点一键导入，或用「AI 智能推荐」）；
2. 选中数据源 → 「采集」→ 按需选择**栏目**、**时间范围**、**仅采新内容**、「仅采晚于上次成功采集的新内容」、每源页数；
3. 采集完成后到「知识对象」审核/发布，或在「智能闭环」一键跑完整链路（采集 → 治理 → 图谱 → 日报 → 洞察 → 健康度）。

> 采集由容器内的 `scrapling-service` 执行。目标站点不可达时任务会记录 `last_error`，在数据源监控卡片上以红色失败标记展示原因。

### 方式三：上传文件入库（无需外网）

「知识对象 → 上传文件」支持 md / txt / pdf 等，由 LLM（或 Mock）识别标题、部门、有效期后建立知识对象 —— 这条路径只用到 `DASHSCOPE_API_KEY`，不填时走 Mock 抽取，同样能入库（向量部分自动降级为关键词检索）。

### 关于模型 Key

- **不填 `DASHSCOPE_API_KEY`**：自动降级为 **Mock LLM**（后端日志出现 `Agent没有配置 API Key，使用Mock LLM服务`），采集 / 治理 / 图谱 / 闭环全链路仍可跑通，问答与洞察为确定性占位内容，但**证据引用与拒答逻辑依然生效** —— 适合断网或没有 Key 的演示。此时语义检索自动退化为关键词检索，不会报错。
- **填了 Key**：走真实 `qwen-plus`（生成）+ `text-embedding-v3`（1024 维向量）+ `gte-rerank-v2`（精排），问答、洞察、图谱抽取均为真实模型输出。**这三个都是 DashScope 的云端 API，不需要本地部署任何模型。**
- 与"取数"无关：本节的 Key 只影响**内容质量**，不影响"有没有数据"；不填 Key 也能完成下面三种取数方式。

## 界面导览

| 页面 | 路径 | 能做什么 |
| --- | --- | --- |
| 总览 | `/overview` | 健康度、重大变更、风险、部门分布、快捷操作、AI 洞察预览、一键智能闭环 |
| 数据源管理 | `/sources` | 增删改数据源、自动发现、AI 推荐、采集（栏目 / 时间范围）、**数据源监控**、一键生成校务快讯 |
| 采集任务 | `/jobs` | 任务卡片 + 六阶段步骤条（抓取/解析/清洗/分类/去重/入库）、参数、结果、失败原因 |
| 知识对象 | `/knowledge-objects` | 结构化知识（类型/部门/有效期/权威度/新鲜度）、上传文件入库、发布 / 归档 |
| 知识图谱 | `/knowledge-graph` | 构建（增量 / 强制重建）+ 力导向图 + **关系路径问答**（返回子图） |
| 变更雷达 | `/changes` | 变更列表 + 行级 Diff 对比 |
| 审核队列 | `/review` | 低置信 / 冲突知识审核 + **AI 建议**（批准 / 拒绝 / 合并 + 风险） |
| 冲突 | `/conflicts` | 冲突列表 + 字段级对比 + 一键消解 |
| AI 问答 | `/ask` | 引用式问答：结论 + 来源 + 时效 / 权威度 + 无依据拒答 |
| 校务洞察 | `/insights` | LLM 洞察报告（要点 / 趋势 / 风险 / 建议）+ 历史报告 |
| 智能闭环 | `/closed-loop` | 6 个 Agent 能力矩阵、**运行配置面板**、**实时决策时间线**、运行历史回放、导入演示数据 |
| 日报周报 | `/digests` | 自动汇总校园知识动态 |
| 通知中心 | `/notifications` | 分类筛选（快讯 / 洞察 / 告警 / 临期 / 系统）、全部已读、点击跳转 |

右上角铃铛是**通知抽屉**（未读数 30s 轮询）；侧边栏左下角常驻显示**构建版本标识**，用于排查"浏览器跑的是不是最新构建"。

## 系统架构

```
                    ┌──────────────── 前端（Next.js 14 + antd）────────────────┐
                    │ 总览/数据源/任务/知识/图谱/变更/审核/问答/洞察/闭环/通知   │
                    └───────────────┬──────────────────────────────┬─────────┘
                          REST / SSE │                              │ 轻量轮询
                    ┌───────────────▼──────────────────────────────▼─────────┐
                    │              FastAPI 后端（/api/admin · /api/v1 · /api）│
                    │  采集 · 变更 · 治理 · 检索问答 · 图谱 · Agent 编排 · 推送 │
                    └──┬────────┬──────────┬──────────┬───────────┬──────────┘
                       │        │          │          │           │
              Scrapling│ PostgreSQL│   Qdrant │   Redis   │  DashScope（云 API）
              （抓取）  │ （业务库）  │（向量库）│（限流/缓存）│ qwen-plus / embedding / rerank
```

| 组件 | 作用 |
| --- | --- |
| `campus-backend` | FastAPI：业务逻辑集中在 `backend/services/`，路由保持薄（`backend/api/`） |
| `campus-frontend` | Next.js 14 App Router 管理台（构建产物镜像） |
| `campus-postgres` | 业务库（pgvector 镜像）；启动时建表 + 执行幂等迁移 |
| `campus-qdrant` | 向量库（RAG 检索） |
| `campus-redis` | 限流、缓存兜底 |
| `campus-scrapling` | 独立抓取微服务（curl_cffi + readability，端口 8001，仅内网） |

## 关键能力与代码位置

| 能力 | 端点 | 实现 |
| --- | --- | --- |
| 采集（时间范围 / 条数上限 / 重试 / SSRF） | `POST /api/v1/sources/{id}/run` | `services/collection_service.py` |
| 栏目动态发现（单源 / 跨源并集） | `GET /api/v1/sources/{id}/columns`、`GET /api/v1/sources/columns` | `services/column_discovery_service.py`、`collectors/*.py` |
| 数据源监控（最近成功时间 / 失败原因 / 快照时间） | `GET /api/v1/sources/monitor` | `services/source_monitor.py` |
| 校务快讯 | `POST /api/v1/sources/brief` | `services/source_brief_service.py` |
| 融合检索问答 + 防幻觉 | `POST /api/v1/ask` | `services/ask_service.py`、`search_service.py`、`agents/reranker.py`、`agents/router.py` |
| 知识图谱构建 / 关系路径问答 | `POST/GET /api/v1/knowledge-graph*` | `services/kg_service.py`、`agents/kg_extractor.py` |
| 三层 Agent 闭环（配置 Schema / 流式 / 回放 / 取消） | `GET /api/v1/config-schema/{name}`、`POST /api/v1/closed-loop/stream`、`GET /api/v1/closed-loop/runs*` | `services/agent_orchestrator.py`、`config_schema_service.py`、`run_service.py` |
| 变更雷达 | `GET /api/v1/changes` | `services/change_service.py`、`radar_service.py` |
| 审核 / 冲突 / AI 助手 | `/api/v1/review-tasks*`、`/api/v1/conflicts*` | `services/review_service.py`、`agents/review_advisor.py` |
| 洞察 / 日报 / 告警 / 通知 | `/api/v1/insights`、`/digests`、`/alerts`、`/notifications` | `services/{insight_generator,digest_service,alert_service,notify_service}.py` |
| 构建版本可见性 | `GET /api/v1/version` | `services/version_service.py` + 前端 `src/build-info.ts` |
| 启动时迁移（幂等 + 多副本互斥） | 启动自动执行 | `services/migration_runner.py` |
| 闭环崩溃恢复（僵尸运行自愈） | 启动自动执行 | `services/run_service.reap_orphaned_runs` |

## 对外开放：REST 与 MCP

**公开 REST**（`/api` 前缀，只读公开、写操作需登录）：

```
GET  /api/knowledge/search?q=&department=&freshness=&limit=
GET  /api/knowledge/{id}
GET  /api/sources     GET /api/changes     GET /api/conflicts     GET /api/digest
POST /api/chat
POST /api/review/{id}/approve|reject
```

**MCP（JSON-RPC 2.0 over HTTP，`POST /api/mcp`）**：`initialize` / `tools/list` / `tools/call`，
共 **7 个工具**：`campus_search`、`campus_source`、`campus_knowledge`、`campus_changes`、`campus_review`、`campus_insight`、`campus_closed_loop`。

```bash
curl -X POST http://localhost:8000/api/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"campus_search","arguments":{"query":"奖学金"}}}'
```

## 可信评测

30 问评测集（24 个可作答题 + 6 个知识库外反例题）：`eval/questions.json`；复跑脚本：`scripts/eval_grounding.py`。

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| Grounded 率（可作答题有依据） | **95.8%** | 知识覆盖良好 |
| Answer Guard 反例拒答率 | **66.7%** | 防幻觉生效（修复前为 0%） |
| 证据引用一致性 | 95.8% | 稳定 |
| 平均引用条数 | 2.57 | 每条回答约 2–3 条来源 |

> 数字来自仓库内 `EVAL_REPORT.md` 的实测记录。**需要最新数字请自行复跑**（结果会写入该文件）：
> ```bash
> python scripts/eval_grounding.py
> ```

## 配置说明

主要项（完整示例见 `.env.example`）：

| 变量 | 说明 |
| --- | --- |
| `DASHSCOPE_API_KEY` | **唯一的模型 Key**（阿里云百炼），覆盖 `qwen-plus` / `text-embedding-v3` / `gte-rerank-v2` 三个**云端 API**。**留空自动 Mock 降级**；本项目无本地模型、无 GPU |
| `APP_BUILD` / `APP_VERSION` / `APP_ENVIRONMENT` | 构建标识：后端 `/api/v1/version` 返回，前端显示并比对；用 `scripts/build_all.ps1` 自动注入 |
| `DEMO_RELAX_AUTH` | `true`（默认，演示档）：可自助注册管理员、所有登录账号均可用户管理；`false`（生产档）：关闭自助注册、恢复 `super_admin` 严格校验 |
| `DATABASE_URL` / `REDIS_URL` / `QDRANT_URL` | 连接串（compose 内已配好，一般无需修改） |
| `SECRET_KEY` / `ENCRYPTION_KEY` | 留空则自动生成并持久化到 `/app/data/` 卷 |
| `ALLOWED_ORIGINS` | 生产请收紧为实际域名；默认 `*` 仅为本地演示方便 |
| `SERVER_DOMAIN` | nginx 规范 Host；配置证书到 `./ssl` 后自动启用 HTTPS 并跳转 |
| `REQUIRE_SECRET_KEY` | 生产设 `true`，拒绝弱密钥启动 |
| `CAMPUS_NOTIFY_WEBHOOK` | 可选：把站内通知外发到飞书 / 企微 / 钉钉群机器人 |

## 项目自有工具（真机验证）

本项目把"用户到底点得开、看得见"作为交付判定，而不只看单测：

```bash
# 1) 接口真机冒烟（32 项断言：配置 Schema / 监控真源 / 栏目 / 采集参数 / SSE / 回放 / 通知 / title 清洗）
powershell -File scripts/smoke_refactor.ps1

# 2) 真实浏览器场景冒烟（6 场景：通知抽屉 / 采集弹窗栏目 / 闭环配置面板 / 通知分类 /
#    闭环时间线生长 / 构建一致性）—— 零依赖（本机 Edge/Chrome + CDP）
node scripts/browser_smoke.mjs --window 1366x768

# 3) 一键总验收（后端 pytest + 前端 typecheck/test/build + 接口冒烟 + 浏览器冒烟 + 文档一致性）
powershell -File scripts/verify_all.ps1

# 4) 注入构建标识并重建（签名：git短hash-时间戳）
powershell -File scripts/build_all.ps1
```

其它：`scripts/browser_probe.mjs`（单元素探针，可排查任意页面"点了有没有反应"）、
`scripts/docs_check.ps1`（文档与仓库一致性机械校验）、`scripts/lib/cdp.mjs`（共享 CDP 客户端）。

> 两条实测教训：**jsdom 通过 ≠ 用户点得开**（真实缺陷曾表现为弹层被定位到视口外几千像素）；
> **重建镜像 ≠ 用户刷新**（已打开的标签页仍跑旧 bundle，靠左下角版本号区分）。

## 目录结构

```
campus-intelligence-hub/
├─ backend/                 # FastAPI 后端
│  ├─ api/v1/               # 薄路由：source / config / closed_loop / ask / public_api / mcp
│  ├─ services/             # 业务逻辑（采集/检索/问答/图谱/闭环/监控/推送/迁移…）
│  ├─ agents/               # reranker / router / review_advisor / kg_extractor / insight_generator
│  ├─ collectors/           # 站点适配器（栏目推导 + 翻页 + 礼貌抓取）
│  ├─ scripts/              # 迁移与演示数据脚本（seed_demo / reset_demo / …）
│  ├─ tests/                # pytest（SQLite 隔离库）
│  └─ models.py  config.py  main.py
├─ frontend-nextjs/         # Next.js 14 管理台
│  └─ src/{views,components,utils,services,context}
├─ scrapling-service/       # 抓取微服务
├─ nginx/                   # 反向代理（HTTPS 可选）
├─ eval/questions.json      # 30 问评测集
├─ scripts/                 # 真机验证与运维脚本（见上）
├─ docker-compose.yml       # 单机一键编排
└─ README.md  ARCHITECTURE.md  DEPLOY-GUIDE.md  等文档
```

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 服务拓扑、数据模型、采集管道、检索链路、SSE 事件协议、配置 Schema、通知中心 |
| [`DEPLOY-GUIDE.md`](DEPLOY-GUIDE.md) | 部署与演示指南 + **发布前 checklist（12 项，逐项带命令）** |
| [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) | 演示视频分镜（含"配置面板 → 流式时间线 → 通知中心"新动线） |
| [`EVAL_REPORT.md`](EVAL_REPORT.md) | 30 问评测的诚实版记录 |
| [`REFACTOR_PLAN_V2.md`](REFACTOR_PLAN_V2.md) · [`REFACTOR_PLAN_V2_2.md`](REFACTOR_PLAN_V2_2.md) | 两轮重构方案 + **实施记录**（契约偏差、追加缺陷、性能实测、明确未做项） |
| [`DECISIONS.md`](DECISIONS.md) | 关键决策与权衡 |
| [`OSS_REUSE.md`](OSS_REUSE.md) | 开源复用清单（复用了哪个项目、复用了什么、为什么） |
| [`COMPETITION_SUBMISSION.md`](COMPETITION_SUBMISSION.md) | 参赛申报要点 |
| `AGENTS.md` / `CLAUDE.md` | 面向 AI 编码助手的仓库约定、命令与测试规范 |

## 常见问题（FAQ）

**Q1：启动后各页面都是空的 / 知识总量 0？**
预期现象，见[首次部署后是零数据](#️-首次部署后是零数据--三种取数方式)。最快路径是「导入演示数据」或「添加数据源 → 采集」。

**Q2：不填模型 Key 能用吗？**
能。无 Key 时自动使用 Mock LLM（确定性占位输出），采集 / 治理 / 图谱 / 闭环流程全部可跑；问答与洞察为占位内容，但**证据引用与拒答逻辑仍生效**。本项目不需要本地模型，见[模型依赖](#模型依赖只需要一个-key不下载任何本地模型)。

**Q3：页面打开了但点了没反应，或提示要登录？**
先**硬刷新**（Ctrl+Shift+R）或关掉标签页重开 —— 重建镜像后旧标签页仍跑旧 bundle。左下角版本号应与 `GET /api/v1/version` 的 `build` 一致。

**Q4：登录提示"尝试次数过多"？**
登录限流 5 次 / 300 秒，且是滑动窗口（**被拒的请求也会把窗口往后推**）。等满 5 分钟再登，不要短间隔重试。

**Q5：采集失败怎么办？**
到「数据源管理」看该源的 `last_error`（红色失败标记 + 悬浮原因），常见是目标站点不可达或被 WAF 拦截。建议先选「1 页（仅最新）」试跑。

**Q6：闭环点不动 / 一直提示"已有进行中的闭环运行"？**
同一时刻只允许一个闭环运行（防止重复点击）。若上一次运行因进程重启中断，**启动时会自动结算为 error**（日志出现"崩溃恢复"字样），无需手动清理。

**Q7：重建后端后，之前正在跑的闭环变成了 error？**
这是预期的崩溃恢复行为（运行状态由进程内任务驱动，进程没了运行就不可能还活着）。避免"跑闭环的同时重建后端"。

**Q8：端口冲突？**
默认 3000（前端）/ 8000（后端）/ 5432 / 6379 / 6333。改端口需同时调整 `docker-compose.yml` 与 nginx 配置。

**Q9：需要下载 BGE / reranker 权重吗？要装 GPU 或 Ollama 吗？**
都不需要。6 个容器里没有模型服务，镜像里也没有推理运行时；生成 / 向量化 / 精排分别走 DashScope 的 `qwen-plus` / `text-embedding-v3` / `gte-rerank-v2` **云端 API**。唯一要做的是在 `.env` 填一个 `DASHSCOPE_API_KEY`（留空则 Mock 降级）。代码与数据库里出现的 `BAAI/bge-m3`、`jina-embeddings-v3` 是**模型名字符串**（用于推断向量维度、以及对接云端 OpenAI 兼容 embedding 服务），不是本地权重。详见[模型依赖](#模型依赖只需要一个-key不下载任何本地模型)。

**Q10：只填 `DASHSCOPE_API_KEY` 就够了吗？**
校务主链路（采集 → 治理 → 问答 → 图谱 → 洞察 → 闭环）够用。唯一例外是 Basjoo 底座的「文件管理」`/files` 页：它的向量索引读的是智能体设置里的 embedding provider key（默认 `jina`，可选 `siliconflow`），不读 `DASHSCOPE_API_KEY`；不配也能上传，但文档索引会失败并显示原因。不用这个页面的话可以完全忽略。

## 技术栈与许可

**技术栈**：FastAPI · 异步 SQLAlchemy · PostgreSQL(pgvector) · Qdrant · Redis · APScheduler · Scrapling（curl_cffi + readability）· Next.js 14 App Router · TypeScript · antd 5 · ECharts · react-markdown · DashScope（qwen-plus / text-embedding-v3 / gte-rerank-v2，**全部走云端 API，无本地模型 / GPU / Ollama**）· pytest · vitest + React Testing Library · 零依赖 CDP 真机验证脚本。

**许可**：见 [`LICENSE`](LICENSE)。底座复用 MIT 协议的 Basjoo，本项目在其之上做校务域二次开发（详见 [`OSS_REUSE.md`](OSS_REUSE.md)）。

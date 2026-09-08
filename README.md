# 校务智汇中台 2.0（Campus Intelligence Hub）

> 面向高校校务管理的 **AI 自动数据采集与知识管理中台**。
> 赛道：第二届「庆园杯」AI 创新应用大赛 · 类别③ 面向校务管理的 AI 自动数据采集与知识管理中台。

**一句话定位**：让高校校务信息**自动更新、可信可查、AI 可用**的一站式知识中台——不是聊天机器人，而是"校务知识的自动化数据中心"。

---

## 背景与真实痛点

高校校务信息长期存在"散、变、旧、乱、难复用"五个问题：

| 痛点 | 具体表现 | 本方案回应 |
| --- | --- | --- |
| 散 | 通知/制度/办事流程散布在十几个部门官网 | 统一数据源 + AI 智能推荐采集 |
| 变 | 政策/截止日期频繁变动，人工盯不过来 | LLM 变化检测 + 变更雷达 + Diff 视图 |
| 旧 | 引用过期信息 | 新鲜度/时效评分 + 临期提醒 + 一键归档 |
| 乱 | 网传与官方不一致，AI 无出处 | 证据引用 + Answer Guard 拒答 + 冲突消解 |
| 难复用 | 各 AI 应用重复爬官网 | 中台 REST + MCP 一次建设多方复用 |

---

## 核心功能

- **数据采集**：数据源管理 / 自动发现 / **AI 智能推荐**（LLM 评估价值 + 分类 + 建议采集频率）/ 文件入库（md/pdf → LLM 识别建知识对象）/ 定时任务。
- **知识治理**：冲突检测 / 审核队列 / **AI 审核助手**（LLM 摘要 + 风险 + 推荐动作）/ 归档 / **知识健康度**（公开公式）。
- **知识图谱**：LLM 三元组抽取 / **力导向可视化**（缩放/拖拽/节点点击/类型筛选）/ **关系路径问答 GraphRAG**（返回子图）/ 生命周期一致（新增/删除自动同步）。
- **可信问答**：融合评分检索 + **gte-rerank-v2 精排** + 意图/部门路由 + GraphRAG 线索 + **证据引用** + **Answer Guard 防幻觉拒答**。
- **校务洞察**：LLM 日报/周报 / 趋势·风险·建议 / **自动定时推送**。
- **Agent 能力**：三层 Agent 智能闭环（采集 → 知识治理 → 问答/运营）/ **AI 智能体中心**（6 个 Agent 能力矩阵 + 实时状态）。
- **对外开放**：REST + **MCP 工具**（campus_search/source/knowledge/changes/review/insight/closed_loop，共 7 个）。

---

## 系统架构（一条数据流）

```
数据源(官网/文件/API)
   │  发现 + AI 智能推荐（LLM 选高价值源 + 采集频率）
   ▼
采集（Scrapling 微服务，抗反爬真实浏览器抓取）
   │  解析 → 去重 → 版本化
   ▼
知识对象（KnowledgeObject）
   │  LLM 抽取：类型 / 部门 / 摘要 / 关键信息
   ├─► 变化检测 → 变更雷达 / Diff
   ├─► 知识图谱（LLM 三元组 → 关系路径 / GraphRAG）
   ├─► 冲突检测 / 审核队列 / AI 预审
   ▼
可信问答（融合检索 + Rerank + 意图/部门路由 + Answer Guard 防幻觉）
   ▼
校务洞察（LLM 日报 / 趋势 / 风险）+ 三层 Agent 闭环
```

**组件**：

| 组件 | 技术 | 作用 |
| --- | --- | --- |
| 后端 | FastAPI + SQLAlchemy | 业务/服务/API |
| 前端 | Next.js 14 (App Router) + React + TS + ECharts | 管理后台 + 问答端 |
| 向量库 | Qdrant | 语义检索 |
| 关系库 | PostgreSQL (pgvector) | 知识对象/图谱/审计 |
| 缓存/限流 | Redis | 缓存 + 限流 |
| 采集 | Scrapling 微服务 | 抗反爬真实浏览器抓取 |
| 模型 | 可插拔 Provider Adapter（DashScope LLM/Embedding/Rerank + Mock） | 生成/嵌入/精排 |

---

## 快速开始

```bash
git clone git@gitee.com:zgozh/campus-intelligence-hub.git
cd campus-intelligence-hub
cp .env.example .env          # 可选填 DASHSCOPE_API_KEY（阿里云百炼）
docker compose up -d --build
# 打开 http://localhost:3000
```

- 默认管理员：`admin@campus.local` / `campus123456`
- **无本地模型、无 GPU**：模型全走 DashScope；**空 API Key 也能演示**（Mock 降级，主链路可用）。

### 一键演示（可选）

```powershell
pwsh scripts/demo.ps1       # 启动 → 导入演示数据 → 构建图谱 → 生成洞察 → 智能闭环 → 30 问评测
```

---

## 界面预览（占位）

> 以下截图请按文件名放入 `docs/screenshots/`（可替换成真实截图）。当前以占位说明列出，避免图片失效。

| 页面 | 截图文件 | 展示内容 |
| --- | --- | --- |
| 中台驾驶舱 | `docs/screenshots/overview.png` | 健康度 / 风险 / 部门分布 / 快捷操作 / AI 洞察预览 |
| 数据源与监控 | `docs/screenshots/sources.png` | 数据源管理 + 自动发现 + 新内容监控 |
| 知识图谱 | `docs/screenshots/knowledge-graph.png` | 力导向图（缩放/拖拽/节点详情/类型筛选） |
| AI 问答 | `docs/screenshots/ask.png` | 融合检索 + 证据引用 + Answer Guard 拒答 |
| 智能体中心 | `docs/screenshots/closed-loop.png` | Agent 能力矩阵 + 一键闭环 |
| 校务洞察 | `docs/screenshots/insights.png` | LLM 洞察 / 趋势 / 风险 |

> 架构图：见上方 Mermaid 图（gitee/GitHub 可渲染）。

---

## 目录结构

```
backend/             FastAPI 后端（services/ + api/ + agents/ + scripts/）
frontend-nextjs/     Next.js 管理后台 + 问答端（src/views/ + src/components/ + src/services/）
scrapling-service/   独立爬虫微服务
scripts/             工具脚本（demo.ps1 / eval_grounding.py）
eval/                Golden QA 评测集（questions.json）
docs/adr/            技术决策记录（ADR-001 底座选型 / ADR-002 模型路由）
docker-compose.yml   一键编排（backend/frontend/qdrant/postgres/redis/scrapling）
```

---

## 📚 重要文档导航（点击跳转）

**项目 / 提交与答辩**
- [PROJECT_README.md](PROJECT_README.md) — 面向评委的完整项目说明
- [COMPETITION_SUBMISSION.md](COMPETITION_SUBMISSION.md) — 参赛申报要点（痛点 / 创新点 / 可量化指标 / 演示脚本）
- [DEMO_SCRIPT.md](DEMO_SCRIPT.md) — 演示视频分镜脚本（13 镜头）
- [EVAL_REPORT.md](EVAL_REPORT.md) — 可信问答评测报告（30 问）

**规划 / 设计**
- [ENHANCEMENT_V3_SPEC.md](ENHANCEMENT_V3_SPEC.md) — 3.x 增强规格（P0 修错 / P1 功能 / P2 体验）
- [ARCHITECTURE.md](ARCHITECTURE.md) — 目标架构
- [DECISIONS.md](DECISIONS.md) — 关键决策记录
- [CURRENT_SYSTEM_AUDIT.md](CURRENT_SYSTEM_AUDIT.md) — 旧项目审计
- [OSS_REUSE.md](OSS_REUSE.md) — 开源复用与原创边界
- [TASKS.md](TASKS.md) — EPIC 0–12 开发任务
- [DEPLOY-GUIDE.md](DEPLOY-GUIDE.md) — 部署指南

**代码 / 脚本**
- [scripts/demo.ps1](scripts/demo.ps1) — 一键演示脚本
- [scripts/eval_grounding.py](scripts/eval_grounding.py) — 可信问答评测脚本（零依赖）
- [eval/questions.json](eval/questions.json) — Golden QA 评测集（30 问）
- [backend/services/demo_seed.py](backend/services/demo_seed.py) — 一键演示数据种子（幂等）
- [docs/adr/ADR-001-底座选型.md](docs/adr/ADR-001-底座选型.md) / [ADR-002-模型路由.md](docs/adr/ADR-002-模型路由.md)

---

## 可信评测（30 问，实测）

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| **Grounded 率**（可作答题有依据） | **95.8%** | 知识覆盖良好 |
| **Answer Guard 反例拒答率** | **66.7%** | 防幻觉生效（修复前为 0%） |
| 证据引用一致性 | 95.8% | 稳定 |
| 平均引用条数 | 2.57 | 每条回答约 2–3 条来源 |

复跑：`python scripts/eval_grounding.py`（自动更新 `EVAL_REPORT.md`）。

---

## 对外开放接口

**REST**：`/api/v1/sources`、`/knowledge-objects`、`/knowledge-graph`、`/ask`、`/insights`、`/closed-loop/run`、`/review-tasks/*` 等。

**MCP（JSON-RPC over HTTP, `POST /api/mcp`）**：`campus_search` / `campus_source` / `campus_knowledge` / `campus_changes` / `campus_review` / `campus_insight` / `campus_closed_loop`（共 7 个）。

---

## 配置说明（.env）

| 变量 | 说明 |
| --- | --- |
| `DASHSCOPE_API_KEY` | 阿里云百炼密钥（LLM/Embedding/Rerank），可选；留空走 Mock |
| `DATABASE_URL` / `REDIS_URL` / `QDRANT_URL` | 数据库 / 缓存 / 向量库连接 |
| `SECRET_KEY` | 签发 JWT，缺失自动生成并持久化 |
| `LLM_PROVIDER` | 设为 `mock` 可在无 key 时演示 |

---

## 技术栈

FastAPI · Next.js 14 (App Router) · Qdrant · PostgreSQL(pgvector) · Redis · Scrapling · DashScope(qwen-plus / text-embedding-v3 / gte-rerank-v2) · ECharts · MCP。

## License

基于 [Basjoo](https://github.com/haoyiyin/basjoo)（MIT License）底座重构，保留其 LICENSE 与版权声明，复用边界见 `OSS_REUSE.md`。

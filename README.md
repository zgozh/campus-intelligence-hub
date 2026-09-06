# 校务智汇中台 2.0（Campus Intelligence Hub）

> 面向校务管理的 AI 自动数据采集与知识管理中台

自动从学校官网、院系网站、通知公告、政策文件、公开页面和人工上传文件中持续采集校务信息，通过 AI 清洗、去重、分类、结构化、知识化，形成「数据进入—知识形成—业务查询—知识反哺」的校园信息闭环。

## 快速启动

```bash
git clone <repo>
cd campus-intelligence-hub
cp .env.example .env        # 填 DASHSCOPE_API_KEY（阿里云百炼）
docker compose up -d --build
# 打开 http://localhost:3000
```

无本地模型、无 GPU、无 Ollama。模型全部走外部 API（默认阿里云百炼 DashScope，LLM + Embedding + Rerank），支持 Mock 模式（`LLM_PROVIDER=mock`，断网/限流/key 过期也能演示 70%）。

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | FastAPI + SQLAlchemy |
| 前端 | Next.js 14 (App Router) + React + TypeScript |
| 向量库 | Qdrant |
| 关系库 | PostgreSQL (pgvector) |
| 缓存/限流 | Redis |
| 采集 | Scrapling 微服务（抗反爬真实浏览器抓取） |
| 模型 | 可插拔 Provider Adapter（DashScope LLM/Embedding/Rerank + Mock） |

## 目录结构

```
backend/           FastAPI 后端（services/ + api/）
frontend-nextjs/   Next.js 管理后台 + 问答端
scrapling-service/ 独立爬虫微服务
docs/              架构 / ADR / 演示文档
demo-data/         种子演示数据
```

## 文档

- `ARCHITECTURE.md` — 目标架构
- `TASKS.md` — EPIC 0–12 开发任务
- `CURRENT_SYSTEM_AUDIT.md` — 旧项目审计
- `OSS_REUSE.md` — 开源复用与原创边界
- `docs/adr/` — 技术决策记录（底座选型、模型路由）

## License

基于 [Basjoo](https://github.com/haoyiyin/basjoo)（MIT License）底座重构，保留其 LICENSE 与版权声明，复用边界见 `OSS_REUSE.md`。

# DECISIONS — 关键架构与产品决策（ADR 摘要）

> 原则：最小实现、每步 commit、每 EPIC 验收、Docker First、Mock First、OSS First。
> 详见 `docs/adr/`（ADR-001 底座选型 / ADR-002 模型路由）。

## D-1 升级策略：增量升级，不重写
- **决定**：以现有 1.0 原型（commit 37a659f）为底座，只补齐 Spec MISSING 项；不推倒重来。
- **理由**：已具备 70% 骨架（Source/Collection/RawDoc/KO/Conflict/Review/Digest + 采集 + 检索 + antd UI）。Spec §2 明确"原型能留就留，不要为了架构看起来高级而重写"。

## D-2 变更检测：新建实体，非扩展 RawDocument
- **决定**：新增 `SourceVersion` + `ChangeEvent` 两个实体承载"自动采集→变化检测"，而非在 RawDocument 上堆字段。
- **理由**：Spec §32/§33 明确指出 SourceVersion/ChangeEvent 是自动采集真正需要的实体，Diff 需要独立快照与元数据。

## D-3 前端策略：复用 antd + 参考 OSS 布局，不整仓引入
- **决定**：前端保持 antd v5 + 现有 9 页骨架；新增 Change Radar / Diff / Health / 部门 / 驾驶舱页面参考 Basjoo、Caddy（i-dot-ai/caddy 的 Collection/Resource/Knowledge UI）、SentiWiki 的管道呈现；不整仓引入 Caddy/Crawl4AI/LangGraph。
- **理由**：Spec §46"能缝就缝"；整仓引入会引入与校务无关的复杂度与 License 风险。

## D-4 模型：Provider Adapter + 无 key Mock
- **决定**：所有 LLM/Embedding 走 `get_llm_service` Provider Adapter；默认 DashScope（qwen-plus + text-embedding-v3）；无 key 自动 Mock。
- **理由**：Spec §74 禁本地模型/GPU；External API 优先；Mock 保证 Zero-API Demo 可展示。

## D-5 检索：融合评分，禁纯 cosine
- **决定**：检索升级为 `score = semantic + lexical + authority + freshness + recency`（各分量配置化权重，authority 按来源配置）。
- **理由**：Spec §21/§22；当前"语义+关键词并集去重"未体现权威度/过期。

## D-6 视觉：Enterprise / Clean / Info-dense / Evidence-first
- **决定**：强页为 Change Radar、Diff Viewer、Knowledge Object、Source Health；禁炫技（紫色渐变、AI 卡片墙、无意义图表）。
- **理由**：Spec §84；Evidence-first 是答辩核心可感知点。

## D-7 产品边界：知识运营，非 OA / 非 ChatBot
- **决定**：不做审批/请假/财务等 OA 流程；Chat 只是最末模块，排在 Knowledge/Changes/Governance 之后。
- **理由**：Spec §44/§45；差异化是"自动采集+变化监测+生命周期+冲突治理+Freshness+Evidence+中台 API"，即 Knowledge Operations。

## D-8 复用边界：OSS 承担通用，原创承担校务
- **决定**：Basjoo 承担登录/RBAC/Qdrant/Ingestion/SSE/调度/Provider/UI 骨架；校务 KnowledgeObject、变化检测、生命周期、冲突治理、知识健康度、中台 API/MCP 为原创增量。
- **理由**：Spec §82 答辩口径；把基础设施复用转化为完整校务知识运营产品。

## D-9 部署：docker compose 单命令，服务收敛
- **决定**：保持 `docker compose up -d --build`（web/api/worker 思路收敛为 backend/frontend/scrapling + pg/redis/qdrant）；不引入复杂可观测平台。
- **理由**：Spec §38/§51；比赛版仅需 Job Log / Audit Log / Model Usage，不拖重监控。

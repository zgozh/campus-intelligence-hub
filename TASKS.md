# TASKS — Campus Intelligence Hub 2.0 升级任务拆解

> 依据《（完善版）最终冲奖Spec v4.0》EPIC 1-12。基于现有 1.0 原型（commit 37a659f）升级，非重写。
> 完成标准：每 EPIC 均以 `docker compose up -d --build` 真实验证，不凭口头/单测。复用成熟 OSS 组件，前端同步复用。

## EPIC 1 — 稳定现有原型
- [x] docker compose 一键启动，6 容器 healthy（已实测）
- [x] 前端 24 页面编译通过；登录/注册/用户管理可用
- [ ] 回归验证：/sources /jobs /knowledge-objects /radar /review /ask /digests 全 200

## EPIC 2 — Source Registry 增强
- [ ] Source 增加：`department`、`category`、`allowed_domains`(JSON)、`robots_policy`、`ratelimit_qps`、`max_depth`、`timeout_s`、`content_type_filter`
- [ ] `POST /sources/discover` 自动发现（URL → 候选栏目/部门，受 allowed_domains 限定）
- [ ] 前端数据源表单加 部门/分类/允许域名/抓取策略 + 「自动发现」

## EPIC 3 — Crawler / Ingestion 扩展
- [ ] 采集支持 URL/HTML（已有）、PDF、DOCX、CSV（pdfplumber/python-docx 兜底）
- [ ] 采集安全参数（max_depth/max_pages/timeout/content-type/size）从 Source 策略读取
- [ ] 真实 gzhu/gznews 采集仍 100% 可用

## EPIC 4 — SourceVersion + ChangeEvent（P0 地基）
- [ ] 新增 `SourceVersion(src_svid, source_id, version_no, content_hash, fetched_at, published_at, content, metadata)`
- [ ] 新增 `ChangeEvent(ce_id, source_id, source_version, old_version, change_type, severity, diff, diff_summary, requires_review)`
- [ ] 变更检测：内容 hash 变化 → TITLE/CONTENT/DATE/ATTACHMENT changed + severity(HIGH/MEDIUM/LOW)
- [ ] 采集入库自动写 SourceVersion + 产生 ChangeEvent

## EPIC 5 — Change Radar + Diff Viewer（P0 最强视觉）
- [ ] 后端 `GET /changes`（部门/级别/时间/类型列表）+ `GET /changes/{id}/diff`（Before/After）
- [ ] 后端 `GET /knowledge-health`（综合评分 + 公式公开）
- [ ] 前端 `/changes` 页面：WHAT CHANGED? 列表 + 严重度徽章 + 点击进 Diff
- [ ] 前端 Diff Viewer 组件：Before/After 对照 + 高亮（复用 antd + 自定义 diff 渲染）
- [ ] 前端 Dashboard 第一屏 → TODAY 统计（New/Changed/Conflicts/Pending）+ Knowledge Health

## EPIC 6 — Knowledge Object 增强
- [ ] KO 增加 `authority`（来源权威度，配置化）、`freshness_level`、`last_verified_at`、`source_version`
- [ ] 变更语义：KO 关联 ChangeEvent，版本语义化

## EPIC 7 — Conflict Engine 增强
- [ ] 冲突队列展示 diff 证据（Source A/B + 字段 + 值）
- [ ] resolve 支持 Use A / Use B / Merge / Ignore（补 Merge 与证据）

## EPIC 8 — Governance
- [ ] approve/reject/edit/publish/archive 全链路（补 edit/publish/archive）
- [ ] 状态机 DISCOVERED→PARSED→PENDING_REVIEW→APPROVED→PUBLISHED→STALE→ARCHIVED

## EPIC 9 — AI Assistant 升级
- [ ] 融合评分 score = semantic + lexical + authority + freshness + recency
- [ ] Answer Guard 显式化（证据不足 → 拒答模板，不编造）
- [ ] answer 返回元数据：Source / Effective Date / Freshness / Confidence / Related
- [ ] 引用可展开（已有）+ 显示 freshness/confidence

## EPIC 10 — Digest / Health / 部门 / 驾驶舱
- [ ] Daily Digest（新增/变化/重要通知/冲突/待审 + Top5 变化）增强
- [ ] Knowledge Health 仪表（Coverage/Freshness/Citation Rate/Conflict Rate/Review Backlog/Source Health）
- [ ] `/department` 部门视角（我的来源/变更/知识/审核/日报）
- [ ] `/overview` 校领导驾驶舱（Health/Critical Changes/Risk/Departments）

## EPIC 11 — MCP + 对外 API
- [ ] MCP server：campus/search|source|knowledge|changes|review
- [ ] 对外公开 API：GET /api/knowledge/search、/api/knowledge/:id、/api/changes、/api/conflicts、/api/digest、POST /api/chat

## EPIC 12 — Final Integration
- [ ] 端到端 Golden Path：Add Source → Auto Crawl → Extract → New Knowledge → Change → Diff → Review → Publish → Ask AI → Correct Citation
- [ ] Zero-API Demo（无 key 全 Mock 可展示）
- [ ] 统一视觉（Enterprise/Clean/Info-dense/Evidence-first）+ 组件-API 绑定全检
- [ ] 稳定版：固定 5 Sources / 20 Documents / 3 Changes / 1 Conflict

---

### 进度记录（2026-09）
- ✅ EPIC 0：现有原型审计 + 2.0 规划（EXISTING_SYSTEM_AUDIT / TASKS / DECISIONS）
- ✅ EPIC 4+5：ChangeEvent + 变更检测 + **Change Radar / Diff Viewer**（行级高亮）
- ✅ EPIC 6+8：知识治理生命周期（approve/reject/edit/publish/archive + 状态机）
- ✅ EPIC 9：AI 问答升级（融合评分 + Answer Guard + Evidence citation + Freshness 分级）
- ✅ EPIC 10：**Knowledge Health 综合评测** + 首页 TODAY/健康度仪表
- ✅ EPIC 11：**对外中台 API**（/api/*）+ **Campus Knowledge MCP**（/api/mcp，JSON-RPC）
- ✅ EPIC 1/12 冒烟：docker compose 全 healthy，前端 25 页 / 全站 12 页 200，后端全部端点非 500，组件-API 绑定无遗漏
- 端到端 Golden Path 已打通：Add Source → Auto Crawl → Extract → Change → Diff → Review → Publish → Ask AI → Correct Citation
- 剩余(可选增强)：EPIC 2(Source 自动发现) / EPIC 3(Crawler PDF/DOCX/CSV) / EPIC 7(Conflict Merge) / EPIC 10 剩余(部门视角/校领导驾驶舱)

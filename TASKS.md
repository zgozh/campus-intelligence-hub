# TASKS — 开发任务拆分（EPIC 0–12）

> 原则：每个 EPIC 能跑、能演示、再 commit、再进入下一步；禁止本地模型/GPU；模型走 Provider Adapter。

---

## EPIC 0 — 现状审计 + OSS 侦察 ✅（进行中）

产出：`CURRENT_SYSTEM_AUDIT.md` / `OSS_REUSE.md` / `ARCHITECTURE.md` / `docs/adr/ADR-001` `ADR-002` / `TASKS.md`
验收：五份文档齐全且基于真实代码，Basjoo 已克隆并深读。

## EPIC 1 — Basjoo 原版启动

- 将 Basjoo 代码拷入 `campus-intelligence-hub`（backend/frontend-nextjs/scrapling-service/docker-compose 等）
- 收敛 docker-compose 为 `docker compose up -d --build`（含 mock 默认可跑）
- 验收：`docker compose up -d` 后 `http://localhost:3000` 打开，登录/建 Agent/URL 抓取/知识库/问答跑通

## EPIC 2 — Campus Shell（品牌与语义改造）

- 改 Brand/Sidebar/术语：Basjoo→校务智汇中台；Agent→校务助手（保留单默认 Agent，砍多租户）
- 删除 widget / 配额 / 计费
- 验收：界面文案校务化，多租户入口收敛

## EPIC 3 — Source 域

- 实现 `Source` + `CollectionJob` 数据模型与 API（增删改查、Run Now/Pause/日志、Job 状态机）
- 复用 Basjoo `IndexJob`/`URLSource` 改造
- 验收：Sources 页 + Jobs 页可操作，Job 状态流转正确

## EPIC 4 — 自动采集器

- 迁移 gzhu/gznews 站点适配器 + 采集引擎到 `collectors/`
- 接入 scrapling-service；支持 website/url/list_page/manual/file
- 验收：添加官网/URL/列表页 → Run Now → 真实抓取入库

## EPIC 5 — 文档管道

- Fetch → Parse → Normalize → Fingerprint(content_hash) → Diff(版本检测) → Index
- 迁移 parser/extract、dedup、splitter/writer
- 验收：重复内容不入库；标题同正文异→新版本；单元测试覆盖 fingerprint/version

## EPIC 6 — Knowledge Object

- 实现 Classifier(5类型)/Extractor(时间/地点/部门/截止/材料)/Curator(KO+tags+relations+summary) 三 Agent
- 迁移 rules.py 规则打标 + 六大专题域 + validity.py 有效期
- 验收：文档→结构化 KO（type/department/effective_from/to/facts/confidence/version）

## EPIC 7 — Freshness / Conflict

- 版本新旧切换（OLD→EXPIRED，NEW→ACTIVE）；问答优先 ACTIVE，历史版本按需
- Conflict 检测（同字段多来源值不一致）
- 验收：过期知识降权/切换正确；冲突被标记

## EPIC 8 — Search + Ask AI

- Hybrid Retrieve(dense+sparse→归一化→时间衰减→过期降权→断崖截断) + 外部 rerank + citation + freshness/conflict-aware answer
- 迁移 hybrid.py + prompts + 流式 SSE
- 验收：Ask AI 给结论+当前版本+依据+更新时间+来源部门，引用率 100%；冲突时标注不一致

## EPIC 9 — Review Queue

- 低置信(<0.75)或冲突 → 审核队列；左原文/中AI抽取/右证据；Approve/Reject/Edit
- 验收：审核通过后知识生效、问答更新

## EPIC 10 — Knowledge Radar

- 今日新增/更新/待审/将过期/来源异常/冲突 + 部门活跃度图表
- 验收：Radar 页数据正确、可视化

## EPIC 11 — Digest

- 定时日报/周报（新增通知/变化政策/将截止/更新部门/异常），Markdown/PDF/网页
- 验收：生成可读 Digest 并展示

## EPIC 12 — 演示 / 评测 / 最终集成

- Golden Demo 18 步真实验证（clone→env→docker→source→crawl→knowledge→review→ask→digest）
- Mock 模式 + RESET_DEMO/SEED_DEMO + docker-compose.demo.yml
- 单元/集成/E2E(5 黄金路径) + 20 题演示清单复测
- 验收：3–5 分钟演示路径跑通，一条 docker 命令起全栈

---

## P0（必须）/ P1（建议）/ P2（可选）

- P0：Docker 一键、无本地模型、云 API、Mock、官网/URL 采集、文件导入、AI 分类/抽取、去重、版本、引用问答、过期处理、冲突检测、Review、Radar
- P1：日报/周报、混合检索、Model Usage、SSE 采集日志、Playwright E2E、Demo Reset
- P2：微信公众号、邮件采集、MCP、知识图谱可视化、多学校配置

# 提示词：校务智汇中台（Campus Intelligence Hub 2.0）本轮重构方案设计

> 用途：把本文件全文复制给 Kimi K3，产出「六章节」重构方案。方案落地实现由本地编码模型按第六章逐条执行。
> 版本：v3.1 提示词（2026-09-08）

---

你作为高级软件架构师，对下面提供的现有项目进行完整重构分析。

**严格遵守下面输出规则：**

1. 不要直接生成完整业务实现代码，可以少量伪代码、函数签名用于说明接口，禁止输出完整业务逻辑代码。
2. 输出全部使用 markdown 结构化，分成下面 6 个章节，不要省略章节。
3. 只依据本文档提供的项目事实做判断；信息不足处**不要臆造**，在「## 一」末尾集中列出「待确认问题清单」（每条给出：待确认点、为什么影响方案、需要谁提供什么）。
4. 本轮改造范围是「既有系统的缺陷修复 + 交互与流程重构 + 参数可配置化 + 实时化」，**不是重写**。请明确标注哪些改动属于就地修复、哪些属于新增模块、哪些明确不做（YAGNI）。
5. 任何方案都必须满足本文「九、硬性约束」全部条目，若某需求与约束冲突，请在对应章节明确写出取舍建议。

---

## 一、项目背景与定位

- 项目名称：校务智汇中台（Campus Intelligence Hub 2.0）。
- 参赛背景：广州大学第二届「庆园杯」AI 创新应用大赛，赛道类别 ③ 面向校务管理的 AI 自动数据采集与知识管理中台。
- 目标形态：**一键 docker 部署**（单机 `docker compose up -d`），**不依赖本机模型/GPU**，模型能力全部走云端 API；通过复用成熟开源项目最大化效率（前端后台骨架来自 Basjoo，MIT 协议）。
- 核心能力闭环：多源自动采集 → 内容解析/去重/变更检测（变更雷达 + Diff）→ 知识治理（发布/审核/归档/冲突检测与消解）→ 融合检索（语义 + 关键词 + 权威度 + 新鲜度 + 时效衰减）+ Rerank + 路由 + GraphRAG → 防幻觉问答（Evidence-first 引用 + Answer Guard）→ Knowledge Health 健康度 → 公开 API + MCP 对外开放 → 文件入库 → 自动化（定时巡检 / 主动推送 / 告警 / 校务快讯 / 洞察报告 / Agent 智能体中心 / 决策日志时间线）。
- 已具备的"自动化 + Agent 化"叙事：三层 Agent 闭环（采集 Agent / 知识治理 Agent / 问答运营 Agent），每次运行落库 `DecisionLog`，前端提供"决策时间线"回放。

## 二、现有技术栈与运行事实（不可变更）

**后端** `backend/`
- Python + FastAPI（`backend/main.py` 负责 app 工厂、中间件 CORS/i18n/限流/body-size、路由挂载 `/api/admin` 与 `/api/v1`、scheduler/Redis 启停）。
- 异步 SQLAlchemy（`backend/database.py` + `backend/models.py` 为 system-of-record），PostgreSQL（部分能力兼容 SQLite 测试库）；`create_all` **不会** ALTER 已存在表，新增列必须走幂等迁移脚本（现例：`backend/scripts/migrate_add_fields.py`）。
- Redis（限流/缓存兜底）、Qdrant（向量库）、Scrapling 独立微服务（`scrapling-service/`，curl_cffi + readability，端口 8001）。
- 调度：APScheduler（`backend/services/scheduler.py`，含 `CampusInsightScheduler` 每日 01:00、`CampusBriefScheduler` 每 6h 并顺带 `check_alerts`）。
- LLM/检索模型：DashScope —— `qwen-plus`（生成）、`text-embedding-v3`（1024 维）、`gte-rerank-v2`（重排，非 OpenAI 兼容端点，失败即降级保留融合序）。统一入口 `backend/services/llm_service.py: get_llm_service`，**无 API Key 时必须 Mock 降级**，主链路永远可演示。
- 流式先例（重要）：`backend/api/v1/endpoints.py` 使用 `from fastapi.responses import StreamingResponse`，`media_type="text/event-stream"`（L1483 附近）——SSE 是项目既有模式，**不需要引入任何新框架**。

**前端** `frontend-nextjs/`
- Next.js 14 App Router + TypeScript（严格类型，禁 `any`）+ antd + ECharts（`echarts-for-react`）+ `react-markdown`（封装在 `src/components/DashboardMarkdown.tsx`）。
- 集中式 API 客户端：`src/services/api.ts`（bearer 鉴权、locale 透传、SSE 解析）。
- 视图集中在 `src/views/`，共享组件在 `src/components/`，布局 `src/components/AdminLayout.tsx`（侧边菜单 + Header 通知铃铛）。
- 测试：vitest + React Testing Library（现有渲染测试 mock `api` 与 `react-router-dom`）。

**部署与验证**
- `docker compose up -d --build backend frontend`；容器：`campus-backend` / `campus-frontend` / `campus-postgres` / `campus-qdrant` / `campus-redis` / `campus-scrapling`。
- 后台登录：`POST /api/admin/login`，账号 `admin@campus.local` / `campus123456`（super_admin）。
- 后端测试：`cd backend && pytest`（`--ignore=tests/integration`）；前端：`cd frontend-nextjs && npm run typecheck && npm run test`。

## 三、代码结构（真实目录，节选与本轮相关部分）

```
campus-intelligence-hub/
├─ backend/
│  ├─ main.py                     # app 工厂/中间件/路由挂载/调度启停
│  ├─ config.py                   # pydantic-settings 全局配置
│  ├─ database.py                 # async engine/sessionmaker
│  ├─ models.py                   # 全部 ORM 模型（system-of-record）
│  ├─ api/
│  │  ├─ v1/
│  │  │  ├─ source_endpoints.py    # 校务相关全部端点（prefix=/api/v1）
│  │  │  ├─ endpoints.py           # Basjoo 原生端点（含 SSE 先例）
│  │  │  └─ mcp_endpoints.py       # MCP 工具（7 个）
│  │  └─ admin_auth.py             # /api/admin/login 等
│  ├─ services/                    # ★ 全部业务逻辑
│  │  ├─ collection_service.py     # 采集任务执行（抓取→解析→去重→入库）
│  │  ├─ source_monitor.py         # 数据源监控快照
│  │  ├─ source_brief_service.py   # 校务快讯生成
│  │  ├─ alert_service.py          # 巡检告警规则
│  │  ├─ notify_service.py         # 站内通知/Webhook 推送
│  │  ├─ insight_generator.py      # 洞察报告生成
│  │  ├─ digest_service.py         # 日报
│  │  ├─ radar_service.py          # 变更雷达 + Knowledge Health
│  │  ├─ agent_orchestrator.py     # 三层 Agent 闭环编排 + 决策落库
│  │  ├─ kg_service.py             # 知识图谱构建/问答
│  │  ├─ ask_service.py            # 融合问答 + 防幻觉
│  │  ├─ search_service.py         # 融合检索打分
│  │  ├─ review_service.py         # 审核
│  │  ├─ demo_seed.py              # 一键演示数据
│  │  └─ scheduler.py              # APScheduler 定时任务
│  ├─ agents/                      # reranker / router / review_advisor / kg_extractor / ko_ingest
│  ├─ scripts/migrate_add_fields.py# 幂等迁移脚本范例
│  └─ tests/                       # pytest（conftest 提供 client/public_client）
├─ frontend-nextjs/
│  └─ src/
│     ├─ services/api.ts           # 全部前端接口封装（含类型定义）
│     ├─ components/
│     │  ├─ AdminLayout.tsx        # 布局 + Header 通知铃铛
│     │  ├─ DashboardMarkdown.tsx  # Markdown 渲染封装
│     │  └─ GraphForce.tsx         # ECharts 力导向图
│     └─ views/
│        ├─ Overview.tsx  Sources.tsx  KnowledgeObjects.tsx
│        ├─ KnowledgeGraph.tsx  Review.tsx  Conflicts.tsx
│        ├─ AskAI.tsx  Changes.tsx  Digests.tsx
│        ├─ Insights.tsx  Notifications.tsx  ClosedLoop.tsx  Jobs.tsx
├─ scripts/  eval_grounding.py / demo.ps1 / regression.ps1
├─ eval/questions.json             # 30 问评测集
└─ docker-compose.yml
```

**必须遵守的分层规范（AGENTS.md）**：业务逻辑只放 `backend/services/`；路由保持"薄"（只做参数校验与委派，不写 DB 逻辑）；模型统一在 `backend/models.py`；前端视图在 `src/views/`、共享件在 `src/components/`；Python 4 空格 snake_case，TypeScript 2 空格 PascalCase；Conventional Commits。

## 四、本轮相关现有实现索引（请以此为改造基线）

| 位置 | 职责 | 关键内容（函数/端点/字段） |
|---|---|---|
| `frontend-nextjs/src/components/AdminLayout.tsx` L147–183 | Header 通知中心 | `<Popover trigger="click" placement="bottomRight">` 直接包裹 `<Badge count={unread}><Button type="text" icon={<BellOutlined/>}/></Badge>`；content 内为 `List` + `markRead(n.id)` + `new Date(n.created_at).toLocaleString()` |
| `frontend-nextjs/src/views/Insights.tsx` L114–126 | 历史洞察报告 | antd `Collapse`，`label: \`${h.created_at} · ${h.content.split("\n")[0]?.slice(0,40)}\``（**原始时间串 + 原始 Markdown 首行**） |
| `frontend-nextjs/src/views/Sources.tsx` | 数据源管理 | L26–32 `COLUMN_OPTIONS` 硬编码 4 项；L18–24 `PAGE_OPTIONS`；L56–63/L249 `loadMonitor`、L70–78 `genBrief`；L244–277 监控卡片 + 快讯卡片（`DashboardMarkdown`）；L340–368 采集弹窗（页数档位 + 栏目下拉 + 说明） |
| `backend/api/v1/source_endpoints.py` | 校务端点全集 | L89 `GET /sources/monitor`；L99 `POST /sources/brief`（生成后 `push_notification`）；L111 `GET /sources/brief`；L128 `/notifications`、L149 `/notifications/unread-count`、L158 `/notifications/{id}/read`；L172 `/alerts`、L181 `/alerts/check`；L340 `POST /sources/{id}/run`（query 参数 `max_pages=1`、`column=None`；**任务开始前即写 `source.last_crawled_at`**）；L384 `/jobs`；L820 `POST /closed-loop/run`；L830 `GET /agents/decisions`；L877/888 `/insights` |
| `backend/services/source_monitor.py` | 监控快照 | `monitor_sources(db, recent_days=7)` 返回 `{items:[{source_id,name,status,last_crawled_at,new_count,recent_titles}], total_new, sources}`；`last_crawled_at` 直接取 `Source.last_crawled_at` |
| `backend/services/collection_service.py` | 采集执行 | `run_collection(job_id)`：`_pick_adapter(source)` → `CrawlEngine().fetch_source(base_url, adapter, max_pages)` → `if column: articles=[a for a in articles if a.column == column]`（**等值过滤**）→ 按 `normalized_url` 查重、`content_hash` 去重、变更则 `version+1` 新版本 |
| `backend/services/agent_orchestrator.py` | 闭环编排 | `run_closed_loop(db, collect)`：三阶段（采集/知识治理/问答运营）各产出 `decisions[]`，统一 `run_id` 落库 `DecisionLog`，返回 `{run_id, stages, summary, status}` |
| `backend/models.py` | 数据模型 | 见下节清单 |
| `frontend-nextjs/src/services/api.ts` L1037/L1107/L1206/L1210 | 前端接口 | `monitorSources(recentDays)`、`runSource(id,maxPages?,column?)`、`runClosedLoop(collect=false)`、`listDecisions(limit=10)` |

**现有数据模型（`backend/models.py`）**：`KnowledgeObject`（无 `content` 列，正文在 `summary`/`facts`）、`Conflict`、`ReviewTask`、`Digest`、`ChangeEvent`、`KGEntity`、`KGRelation`、`InsightReport`、`BriefReport`、`Notification`（含 `kind/title/content/read/created_at`）、`DecisionLog`（`run_id/agent/decision/detail/status/created_at`，**无起止时间与耗时**）、`Source`（含 `last_crawled_at`）、`RawDocument`（含 `title/content/content_hash/version/publish_time/column/department/normalized_url`）、`CollectionJob`（含 `status/params/stage_trace/started_at/completed_at/error_message`）。

## 五、已确认的问题现象清单（缺陷诊断输入）

> 以下均为**用户实测复现**的现象，已定位到具体代码位置；请你给出根因分析、影响面与修复方案（含回归防护）。

**P1｜右上角通知铃铛点击无反应（点不开）**
- 现象：Header 右上角通知铃铛按钮点击后无任何面板弹出。
- 证据：`AdminLayout.tsx` L147–183，`<Popover trigger="click">` 的直接子元素是 `<Badge><Button/></Badge>`；`notifications`/`unread` 的加载在 `useEffect` 内以 `try/catch` 静默兜底，异常时界面无任何反馈。
- 期望：点击必定展开通知面板；面板内容为最新 N 条（`kind` 标签 + 标题 + 本地化时间）；支持标记已读、跳转"全部通知"；未读数及时更新；接口异常时有可见降级提示而非"静默无事发生"。

**P2｜时间未本地化 + Markdown 未清洗（多处）**
- 现象（用户原话）：校务洞察的"历史洞察报告"标题显示为 `2026-09-08T14:07:42.033674+00:00 · **校务知识洞察**`；数据源管理里"一键生成校务快讯"之后的校务快讯同样存在"没有转义"的文本；用户明确表示"还有一些地方的文本也是没有转义"。
- 证据：`Insights.tsx` L119 直接把后端 ISO（含微秒）与 `content` 首行原文拼成 Collapse 标题；同类风险点还有 `Sources.tsx` 快讯卡片/通知标题、`AdminLayout.tsx` 通知项标题、`Notifications.tsx`、`Digests.tsx`、`ClosedLoop.tsx` 决策详情、`Changes.tsx`（此处已有局部 `stripMd` 处理）。
- 期望：**系统性**解决，而非逐处打补丁——统一"展示层适配"（时间格式化 + 行内 Markdown 清洗 + 正文 Markdown 渲染）并全站复用；后端在生成侧提供干净的 `title` 字段（不让前端从正文首行推断标题），时间字段统一带时区 ISO 8601。请给出该统一层的落点与迁移清单（列出需要改动的文件与位置）。

**P3｜"刷新监控"无反应；"最近采集时间"仍是很早之前的测试时间**
- 证据：`Sources.tsx` L249 `onClick={loadMonitor}`（L59–66）；后端 `GET /sources/monitor` → `source_monitor.monitor_sources`，`last_crawled_at` 取 `Source.last_crawled_at`；该字段仅在 `POST /sources/{id}/run`（`source_endpoints.py` L358）**任务开始前**写入一次，调度/闭环链路是否同步维护需核实；页面上"数据源列表表格的 last_crawled_at 列"与"监控卡片的 last_crawled_at"来自两次独立请求，存在不一致可能；接口无 `refreshed_at` 回显，前端无"确实刷新成功"的可观察反馈。
- 期望：明确"最近采集时间"的唯一真源与更新时机（区分"开始抓取时间/完成时间/成功时间"，建议在 `CollectionJob` 已有 `started_at/completed_at` 基础上做一致化），监控接口返回快照时间；刷新按钮给出确定反馈（快照时间更新 + 表格同步刷新 + 异常可见）；排查是否存在缓存、未 `await`、异常静默吞掉、或采集任务实际失败导致时间未推进。

**P4｜"一键运行闭环"阻塞式等待（体验缺陷）**
- 现象：点击后界面"卡住"，等待一段时间后下方所有内容一次性渲染出来。
- 证据：`ClosedLoop.tsx` L87 `setResult(await api.runClosedLoop(collect))` —— 单次同步 HTTP 请求承载"采集 → 治理 → 图谱 → 日报 → 洞察 → 健康度"全链路，前端只能整体 loading。
- 期望：改为**实时流式**驱动：后端按阶段推送事件（SSE，复用项目既有 `StreamingResponse(media_type="text/event-stream")` 模式），前端收到即渲染；首个事件快速返回（先出"已启动/阶段开始"），单步完成即更新；支持断线后按 `run_id` 补齐已落库决策（回放），保证"实时视图"与"历史回放"数据结构一致。

**P5｜闭环参数不可配置（需改为"运行配置面板"）**
- 现象：`ClosedLoop.tsx` L142 只有一个 `<Checkbox checked={collect}>包含实时采集（会访问已配置数据源）</Checkbox>`，其余参数全部写死在服务端。
- 期望：
  1. 点击「一键运行闭环」**先弹出运行配置面板**，面板中列出闭环各操作（阶段）当前的"设计数据/参数"（例如：是否实时采集、参与采集的数据源、每源抓取条数或页数、内容类型（栏目）、时间范围、是否强制重建知识图谱、是否生成日报/洞察、是否推送站内通知、是否归档过期知识、健康度阈值等），**允许用户就地修改**这些数据来改变本次闭环流程；
  2. 把"包含实时采集（会访问已配置数据源）"勾选框**移入该面板**；
  3. 勾选实时采集后，**展开**数据源多选 + 采集数量 + 内容类型 + 时间段等选项；
  4. 面板内点「确定并开始」才真正启动闭环（启动前做参数校验与风险提示，如"将访问 N 个外部站点"）；
  5. **强烈建议**：由后端提供**配置 Schema**（字段名/类型/默认值/枚举/校验规则/分组），前端按 Schema 动态渲染表单，避免前后端硬编码漂移（后续新增参数前端零改动）。请你在方案中评估该 Schema 化设计是否值得、边界在哪。

**P6｜Agent 决策时间线需实时流式追加 + 显示每步实际完成时间**
- 现象：目前运行结束后由 `loadDecisions()` 一次性拉取 `GET /agents/decisions` 整体渲染；`DecisionLog` 无完成时间/耗时语义。
- 期望：
  1. 操作过程中**每完成一步就沿时间线继续弹出**（线随步骤生长），而不是等全部完成才显示；
  2. 每一步**右侧显示实际完成时间**（本地化，如 `14:07:42`，建议附耗时 `1.2s`）；
  3. 区分态：进行中 / 成功 / 部分成功 / 失败（现有 `status` 已有 ok/partial/error 语义，可扩展）；
  4. 运行结束后仍可从数据库回放历史运行（与实时视图同构）。

**P7｜采集面板「采集内容筛选（栏目）」只有"全部内容"，没有其它类型可选**
- 证据：`Sources.tsx` L26–32 `COLUMN_OPTIONS` 为硬编码 4 项（通知公告/新闻动态/办事指南/规章制度）；后端 `POST /sources/{id}/run` 的 `column` 仅做等值过滤（`collection_service.py` L71–72 `a.column == column`），实际 `column` 取值来自适配器/解析器（`ParsedArticle.column`），与前端硬编码选项**不对齐** → 要么选不到、要么选了筛不出数据。
- 期望：实现**栏目动态发现**——依据该数据源历史 `RawDocument.column` 的真实分布（含条数统计），叠加适配器可识别的栏目结构（必要时 LLM 归类），前端下拉实时拉取"该源实际可用的栏目"及其计数；选择后的过滤语义与发现结果严格一致；接口缓存/失效策略明确。

**P8｜采集缺少时间范围筛选**
- 现状：`POST /sources/{id}/run` 只有 `max_pages` 与 `column`，无时间维度；采集链路按页抓取，不做发布时间过滤。
- 期望：采集面板（以及 P5 的闭环配置面板）支持"发布时间/更新时间区间"筛选——提供快捷项（近 7 天 / 近 30 天 / 自定义起止日期）+ "仅采集晚于上次采集水位的新内容"；后端在采集服务中支持 `since` / `until`（或 `days`）并**在入库前按 `publish_time` 过滤**；过滤条件写入 `CollectionJob.params` 与 `stage_trace`，保证过程可解释、可回溯。

**P9｜请在诊断中一并评估的其它潜在问题（不限于此）**
- 时间字段时区/格式在前后端多处不一致（`isoformat()` 带/不带时区、微秒精度、展示层各自 `new Date()`）；
- 通知未读状态实时性（Header 未读数是否会陈旧）；
- 长任务无取消、无并发/重复点击防护（项目已有共享 `TaskLock` 先例，需评估闭环/采集是否纳入）；
- 长耗时端点（闭环、采集）超时与幂等（重复点击是否会产生重复运行/重复数据）；
- "列表标题/摘要类文本"的转义问题缺乏测试护栏，容易回归；
- 现有 `create_all` 不含 ALTER，新增字段若无迁移脚本将静默失效。

## 六、本轮需求清单（写成可验收的条目）

**R1** 通知中心可用（P1）：点击展开、列表正确、已读可操作、异常可见、未读及时更新。
**R2** 统一的展示层适配（P2）：抽出行之有效的时间格式化 + 行内 Markdown 清洗 + 正文渲染三件套，全站列表标题/摘要/通知/折叠头复用；产出"需要改动的文件清单"；后端补干净 `title` 与标准时间字段。
**R3** 数据源监控刷新可用且语义明确（P3）：明确唯一真源与更新时机、返回快照时间、前端刷新有确定反馈、表格与卡片数据一致。
**R4** 闭环实时流式执行（P4）：SSE 推送阶段事件，前端增量渲染，无阻塞卡顿，首事件快返回，失败可见，支持按 `run_id` 回放。
**R5** 闭环运行配置面板（P5）：面板展示并可修改各阶段参数，采集勾选移入面板并带数据源/数量/类型/时间段子配置，确定后启动，参数经校验并在运行记录中留痕（可复现）。
**R6** 决策时间线实时追加 + 每步完成时间（P6）：步骤完成即出现，右侧显示完成时刻与耗时，四态可视，历史可回放。
**R7** 采集栏目动态发现（P7）：下拉来自该源真实可用栏目（带计数），过滤语义一致。
**R8** 采集时间范围筛选（P8）：支持区间与快捷项，入库前过滤，条件留痕。
**R9** 回归防护：为 R1/R2/R6/R7 补最小必要的后端接口测试与前端渲染测试，防止同类问题复发。
**R10** 文档同步：受影响的能力说明、演示脚本、验收步骤同步更新（项目已有 `README.md` / `DEMO_SCRIPT.md` / `EVAL_REPORT.md` / `ARCHITECTURE.md` / `OSS_REUSE.md` 文档体系）。

## 七、我方候选增强建议（请你逐条评估：采纳 / 改造后采纳 / 不采纳，并说明理由）

- **O1 展示层适配模块**：`frontend-nextjs/src/utils/format.ts`（时间/文本/Markdown/状态色）单一出口 + 测试护栏。
- **O2 配置 Schema 化**：`GET /api/v1/config-schema/{closed_loop|collection}` 返回字段定义与默认值，前端动态表单；后端 `run_closed_loop` / `run_collection` 统一按 schema 校验入参。
- **O3 运行可观测**：引入"运行记录"概念（`run_id` + 状态 + 开始/结束/耗时 + 参数快照 + 结果摘要 + 可取消），闭环与采集共用；前端提供运行历史列表与回放。
- **O4 采集礼貌与安全**：域级限速、robots 尊重、失败重试与退避、单次采集配额上限（均可配置），并遵循项目既有 SSRF 防护（`backend/services/url_safety.py`）。
- **O5 增量水位（watermark）**：以数据源为粒度记录"已采集到的时间水位/已见 URL 集合"，默认增量、可强制全量；与"最近采集时间"语义统一（呼应 P3/P8）。
- **O6 通知中心体验**：未读实时（SSE 或轻量轮询）+ 分类筛选（快讯/告警/洞察）+ 全部已读 + 点击跳转对应页面。
- **O7 演示友好**：保留并强化"无 API Key 也能完整演示"的确定性降级链路；一键演示数据 + 一键全链路运行 + 生成可截图的结果页（比赛演示需要）。

## 八、明确不做（除非你能给出强理由）

- 不重写技术栈、不迁移框架、不引入消息队列/工作流引擎/前端状态管理库。
- 不引入 WebSocket（SSE 已够）、不引入向量库替换、不引入新的模型供应商。
- 不做多租户/权限体系扩张（当前为单管理员演示形态，除非与本次需求强相关）。
- 不做与上述 P/R 无关的大范围重构（避免方案膨胀）。

## 九、硬性约束

1. **技术栈不得变更**：后端 FastAPI + 异步 SQLAlchemy + PostgreSQL + Redis + Qdrant + Scrapling；前端 Next.js 14 App Router + TypeScript + antd + ECharts + react-markdown；模型走 DashScope（`qwen-plus` / `text-embedding-v3` / `gte-rerank-v2`）。
2. **不得引入额外重型第三方库**：禁止 Celery/Kafka/Airflow/LangChain/LangGraph/各类 Agent SDK、React Query/Zustand/Redux、Socket.IO 等；实时推送一律用 FastAPI `StreamingResponse` + SSE（项目已有先例），前端用原生 `EventSource` 或 `fetch` 流式读取；动态表单用 antd 现有能力实现。
3. **兼容原有对外接口**：既有 REST 端点路径与响应字段保持向后兼容（只允许**新增**端点或**新增**字段，不得删除/改名）；MCP 工具契约与公开 API 不得破坏。
4. **数据库变更必须幂等可迁移**：`create_all` 不会 ALTER 既有表；新增表/列必须提供幂等迁移脚本（沿用 `backend/scripts/migrate_add_fields.py` 风格），且重复执行安全。
5. **分层规范**：业务逻辑只在 `backend/services/`，路由保持薄；模型集中在 `backend/models.py`；前端视图/组件/接口分层不变。
6. **无 Key 可演示**：任何新链路必须有确定性降级（Mock/规则兜底），不得因模型或外部站点不可用而 500；外部依赖失败要"降级 + 可见提示"。
7. **部署约束**：单机 `docker compose up -d` 一键起，不得新增中间件容器；Windows 开发 + Linux 部署都要能跑。
8. **性能约束**：闭环全流程（含一次真实采集）目标 P95 ≤ 60s，不含采集时 ≤ 15s；流式**首个事件 ≤ 1.5s**；监控/列表类接口 P95 ≤ 500ms；采集并发与页数上限可配置且有硬上限。
9. **代码与文案风格**：中文注释/文案与现状一致；Python 4 空格 snake_case，TS 2 空格 PascalCase、显式类型、禁 `any`；Conventional Commits（`feat:`/`fix:`/`refactor:`/`docs:`）。
10. **可测试**：每个模块必须给出单元/接口/渲染测试要点（后端 pytest，前端 vitest + RTL），并说明如何在本地与容器中验证。
11. **安全**：所有外部 URL 处理必须复用 `backend/services/url_safety.py`（SSRF 防护），不得绕过。

## 十、输出格式（严格执行）

输出全部使用 markdown，**必须包含且不省略**下面 6 个章节；章节标题保持原样：

## 一、原有项目现状与问题诊断
梳理现有项目架构、业务逻辑。列出：致命缺陷、耦合问题、可维护性问题、潜在bug、性能问题，区分【必须修复】和【建议优化】。
（要求：必须逐条覆盖本文档「五、已确认的问题现象清单」P1–P9，并额外给出你独立发现的问题；每条给出：现象、根因判断、影响面、修复方向、验证方式、优先级。）

## 二、本次重构总体目标与硬性约束
写明业务目标；同时列出硬性约束：技术栈不能变更、兼容原有对外接口、部署环境约束、性能约束、不要引入额外重型第三方库。

## 三、重构后整体架构设计
1. 输出完整项目目录树结构（标注新增/修改/删除）
2. 描述各个组件之间数据流、调用关系（重点：SSE 实时流、配置 Schema 驱动、采集参数链路、监控数据真源）
3. 列出新增/移除的第三方依赖（预期：绝大多数为"无新增"，若确需新增请给出不可替代的理由与体积/维护性评估）

## 四、模块拆分与模块职责定义
将系统拆分为高内聚低耦合的独立模块。
每个模块说明：模块职责，该模块依赖哪些其他模块，哪些外部模块依赖本模块。

## 五、完整接口契约规格
所有模块对外暴露的函数、API接口、数据结构体。
写明：函数/接口名称，输入参数，输出数据结构，异常返回，数据类型定义。
这份契约是后续编码的标准，所有模块必须严格遵守这份契约。
（要求：至少覆盖 ① 闭环运行配置 Schema 与启动/流式事件契约（事件类型、字段、顺序、错误语义、回放）② 采集参数契约（含栏目发现与时间范围）③ 监控快照契约 ④ 通知中心契约 ⑤ 决策日志/运行记录契约 ⑥ 展示层适配函数的 TS 签名契约。事件名与字段名一旦确定不得在实现阶段随意更改。）

## 六、分模块开发任务清单
每一条任务对应一个独立模块，任务描述必须完整独立，可以直接复制粘贴给编码模型进行开发。
每条任务包含：
- 模块名称
- 模块职责
- 需要遵守的接口契约
- 业务逻辑要求
- 输入输出说明
- 单元测试验证要点

（要求：按依赖顺序排列，标注任务间前置关系与可并行关系；每条任务明确涉及的文件路径；区分【必须修复】与【建议优化】；并在末尾给出"验收清单"——按本文档 R1–R10 逐条给出可执行的验证命令或操作步骤。）

输出完成后，不需要编写实现代码。我后续会把每一条【分模块开发任务清单】单独交给编码模型逐个实现。

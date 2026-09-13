# 提示词：校务智汇中台 v2.2「收口与加固」方案设计

> 用途：把本文件全文复制给 Kimi K3，产出「六章节」方案。实现由本地编码模型按第六章逐条执行。
> 版本：v2.2 提示词（2026-09-13）
> 上游：v3.1 提示词 → `REFACTOR_PLAN_V2.md`（T1–T15 已全部落地，见该文件「七、实现记录」）

---

你作为高级软件架构师，对下面这个**已上线并完成过一轮重构**的项目做第二轮（收口与加固）分析。

**严格遵守下面输出规则：**

1. 不要直接生成完整业务实现代码，可以少量伪代码、函数签名用于说明接口，禁止输出完整业务逻辑代码。
2. 输出全部使用 markdown 结构化，分成下面 6 个章节，不要省略章节。
3. 只依据本文档提供的事实做判断；信息不足处**不要臆造**，在「## 一」末尾集中列出「待确认问题清单」（每条给出：待确认点、为什么影响方案、需要谁提供什么）。
4. 本轮范围是「验证手段补强 + 已知缺口收口 + 残留清理 + 安全与工程治理」，**不是新功能开发、不是重写**。请对每条给出：就地修复 / 新增小模块 / 明确不做（YAGNI）。
5. 任何方案必须满足「九、硬性约束」全部条目；与需求冲突处要写出取舍理由。
6. 本轮的**第一优先级不是写代码，而是让"用户说的问题"可被真实复现与判定**——请特别重视第「五、A」节。

---

## 一、项目背景与当前状态

- 项目：校务智汇中台（Campus Intelligence Hub 2.0）。FastAPI + Next.js 14 + antd + Qdrant/PostgreSQL/Redis + Scrapling + DashScope（qwen-plus / text-embedding-v3 / gte-rerank-v2）。单机 `docker compose up -d` 一键部署，无本机模型/GPU。
- 上一轮（v2.1）已完成 `REFACTOR_PLAN_V2.md` 的 T1–T15 并推送：闭环 SSE 流式执行、运行记录与回放、配置 Schema 驱动的运行配置面板、实时决策时间线（每步完成时刻+耗时）、展示层统一适配（时间/Markdown 清洗）、通知中心修复、监控时间真源收敛、栏目动态发现、采集时间范围过滤、采集礼貌与 SSRF 校验。
- 上一轮验证基线（可作为本轮回归基线）：后端 `pytest --ignore=tests/integration` → 386 passed / 32 skipped / 2 xfailed；前端 `npm run typecheck` exit 0、`npm run test` 28 文件 191 用例通过、`npm run build` 通过；真机冒烟 `scripts/smoke_refactor.ps1` → 32/32；6 容器健康。
- 已存在的自有验证工具（**请在此基础上扩展，不要另起炉灶**）：
  - `scripts/smoke_refactor.ps1`：真机接口冒烟（32 项断言，PowerShell 5.1，需 UTF-8 BOM）。
  - `scripts/browser_probe.mjs`：**零依赖真实浏览器探针**（本机 Edge/Chrome 无头 + CDP + Node 内置 WebSocket）。可点击指定元素、分别用"合成 click"与"真实鼠标事件 `Input.dispatchMouseEvent`"对比、采集 console 错误/未捕获异常/4xx 资源、输出元素与弹层几何与命中测试结果。
  - `frontend-nextjs` 的 vitest + RTL 渲染测试；后端 pytest（`tests/conftest.py` 提供 `client`/`public_client`）。

## 二、技术栈与运行事实（不可变更）

- 后端：Python + FastAPI（`backend/main.py` 挂 `/api/admin` 与 `/api/v1`；`config_endpoints.py` 提供 `/config-schema/{name}` 与 `/sources/{id}/columns`；`closed_loop_endpoints.py` 提供 `/closed-loop/stream`、`/closed-loop/runs*`、取消）；异步 SQLAlchemy；`models.py` 为 system-of-record；APScheduler 定时任务。
- 关键既有实现：`services/run_service.py`（运行记录生命周期/互斥/取消/回放物化）、`services/agent_orchestrator.py`（三层闭环编排，决策产生即落库 + 事件回调）、`services/config_schema_service.py`（两份 Schema 与校验）、`services/column_discovery_service.py`、`services/collection_service.py`（采集 + 时间过滤 + 时间真源）、`services/source_monitor.py`、`services/notify_service.py`、`services/text_utils.py`（`clean_title`）。
- 前端：Next.js 14 App Router；`src/components/AdminLayout.tsx`（侧边菜单 + Header 通知铃铛 Popover）、`src/components/{SchemaForm,RunConfigModal,DecisionTimeline,DashboardMarkdown,GraphForce}.tsx`；`src/utils/format.ts`（`formatDateTime/formatTime/stripInlineMd/truncateText/statusColor/displayTitle`）；`src/services/api.ts` 为集中式客户端（含 `streamClosedLoop` 流式读取器）。
- 部署：`docker compose up -d --build backend frontend`；容器 `campus-backend/frontend/postgres/qdrant/redis/scrapling`；后台账号 `admin@campus.local / campus123456`；登录 `POST /api/admin/login`；前端鉴权状态在 `localStorage` 的 **`token` 与 `admin` 两个键**（缺一即视为未登录）。
- 前端镜像为**构建产物**：改前端后必须重建镜像；而**用户已打开的标签页不会自动换 JS**——这是排查"改了但用户说没好"的第一嫌疑，见「五、A」。

## 三、代码结构（与本轮相关部分）

```
campus-intelligence-hub/
├─ backend/
│  ├─ api/v1/{source_endpoints,config_endpoints,closed_loop_endpoints,ask_endpoints,schemas}.py
│  ├─ services/{run_service,agent_orchestrator,config_schema_service,column_discovery_service,
│  │            collection_service,source_monitor,notify_service,text_utils,alert_service,
│  │            scheduler,source_brief_service,digest_service,radar_service,review_service}.py
│  ├─ collectors/{base,engine,gzhu,gznews,gzhu_cms}.py     # 适配器 + 栏目映射 + 采集礼貌/SSRF
│  ├─ scripts/migrate_run_records_and_fields.py            # 幂等迁移范例
│  ├─ tests/                                               # pytest（本轮新增 10 个测试文件）
│  └─ models.py  config.py  main.py
├─ frontend-nextjs/
│  ├─ src/services/api.ts        # 集中式 API + SSE 读取器 + 全部类型定义
│  ├─ src/utils/format.ts        # 展示层唯一出口（6 函数）
│  ├─ src/components/            # AdminLayout / SchemaForm / RunConfigModal / DecisionTimeline …
│  ├─ src/views/                 # Overview Sources Jobs KnowledgeObjects KnowledgeGraph Changes
│  │                            #   Radar Review AskAI Insights ClosedLoop Digests Notifications …
│  └─ tests/unit/                # vitest + RTL
├─ scripts/{smoke_refactor.ps1,browser_probe.mjs}
├─ REFACTOR_PLAN_V2.md           # v2.1 方案 + 实现记录（任务/契约偏差/追加缺陷/性能实测/未做项）
├─ PROMPT_KIMI_REFACTOR.md       # v3.1 提示词（上一轮）
└─ README.md ARCHITECTURE.md DEMO_SCRIPT.md EVAL_REPORT.md OSS_REUSE.md
```

**分层规范（AGENTS.md）**：业务逻辑只在 `backend/services/`，路由保持薄；模型集中在 `backend/models.py`；前端视图/组件/接口分层不变；Python 4 空格 snake_case，TS 2 空格 PascalCase、显式类型、禁 `any`；Conventional Commits。

## 四、上一轮已修复的内容（不要重复设计，只需按需回归）

闭环 SSE 流式 + 运行记录与回放 + 配置 Schema 动态表单；决策即时落库与耗时展示；展示层统一适配与全站迁移；通知中心 Popover 修复（受控 + 原生 span 子节点）、30s 未读轮询、失败可见重试、点击 `link` 跳转、一键全部已读、kind 分类 Tabs；监控时间真源收敛（`last_crawled_at`/`last_success_at` 统一在 `collection_service` 维护）与 `refreshed_at` 快照；栏目动态发现（适配器按列表页推导 + 历史分布计数 + TTL 缓存）；采集时间范围/仅新内容/条数上限；采集礼貌（请求间隔可配）与 SSRF 校验；洞察/快讯干净 title。

## 五、本轮要解决的问题与缺口（**A 为最高优先级**）

### A. 验证手段不足导致"用户说没好、我说已修好"（必须解决）

**A1｜真实案例复盘（请以此设计机制，不要只当成一次性 bug）**：用户报"右上角通知铃铛点了没反应"。第一轮我基于 **jsdom 渲染测试**判定"已修复"并交付；用户复测仍报"依旧点了没反应"。随后用真实浏览器（CDP）取证发现：
- 部署产物**确实**含新代码（可在容器 `/.next/static` 中 grep 到新字符串）；
- 在**全新加载的页面**上用真实鼠标事件点击，通知面板正常打开（364×811、`display:block`、可见、内容正确、无 console 报错），`/overview`、`/sources`、`/closed-loop`、`/knowledge-graph`、`/notifications` 五条路由全部 PASS；
- 期间还发现我第一版探针**判定逻辑本身是错的**：antd 弹层关闭后节点仍留在 DOM 且 `display:none`，用 `document.querySelector('.ant-popover')` 是否存在来判定"打开了"会把"没打开"误判成 PASS。
- 由此得出两条结论：①jsdom 通过 ≠ 用户点得开；②"重建镜像"≠"用户标签页换代码"（用户未硬刷新时跑的是旧 bundle）。

**要求**（这是本轮核心交付）：
1. 设计**真实浏览器验证的制度化方案**：把 `scripts/browser_probe.mjs` 扩展为可复用的**多路由 × 多关键交互**冒烟（至少覆盖：通知铃铛开合、采集弹窗打开与栏目下拉、闭环配置面板打开与「确定并开始」、闭环时间线生长、Notifications 页分类切换），并给出**稳定的判定口径**（弹层必须 `display!=none && rect.width>0 && rect.height>0`；交互必须用 `Input.dispatchMouseEvent` 真实鼠标事件，不能只用 `element.click()`）。
2. 评估是否引入 Playwright（`@playwright/test` 作为 **devDependency**）与继续"零依赖 CDP 探针"的取舍：给出体积/维护成本/CI 可用性对比与推荐（注意：不得引入任何**运行时**新依赖）。
3. 设计**"部署版本可见性"**机制以根除"用户跑着旧 bundle 却以为没修好"：给出低成本方案（例如前端构建期注入版本号/commit hash，在布局或设置页可见；或响应头/`/api/v1/version`；以及在通知面板类组件上加 `data-build` 标记），并说明缓存策略（静态 chunk 内容哈希 + HTML 不缓存）。
4. 给出**用户端排查清单**（可交给非技术用户执行）：硬刷新、DevTools 禁缓存刷新、关标签重开、检查 console 报错、确认所在路由、确认同页其它按钮是否可点、浏览器/窗口宽度矩阵。

### B. 上一轮识别但未处理的缺口（逐条给方案）

- **B1｜`api.ts` 冻结导致错误语义丢失（必须修复）**：`streamClosedLoop` 在非 2xx 时只 `throw new Error(await parseErrorResponse(response))`，于是 **409 拿不到 `run_id`**（前端只能用 `listClosedLoopRuns` 兜底猜）、**422 的 `detail:[{field,message}]` 结构丢失**（前端按 `"; "` 拆字符串展示）。要求：设计向后兼容的结构化错误（例如新增 `ApiError` 类携带 `status`/`detail`/`run_id`，保留 `.message` 字符串兼容既有调用方），并列出所有受影响调用点与迁移方式。
- **B2｜栏目发现只在"恰好选中 1 个数据源"时加载（必须修复）**：多源时只能"留空=不限"。设计多源栏目并集（每源计数、同名合并、来源标注），并明确后端是否新增"跨源栏目"接口或复用现有接口批量参数。
- **B3｜闭环性能未达标（必须修复或明确接受）**：目标"不含采集 ≤15s"，实测 **16.9–18.6s**（两次真实 LLM 生成：日报 + 洞察）。给出优化方案（并行化、复用同一运营数据快照、按需降级、流式分批返回等）与预期收益，并明确"若无法达标则如何对外表述"。
- **B4｜`date` 字段不回填（建议优化）**：为避开 dayjs 依赖使用非受控 DatePicker，导致程序化写入的日期串不回显。给出不引入新依赖的受控实现方案（antd 自带 dayjs 是否可直接用？给出判断依据与风险）。
- **B5｜`run_error` 后 `streamClosedLoop` 仍 resolve 为 `ok`（必须修复）**：前端目前靠监听 `run_error` 事件自行抑制成功提示。给出归一化方案（返回结构化终态）。
- **B6｜残留的"时间自行格式化 / 裸 Markdown 渲染"清单（必须清理）**，至少包含：
  - 自行格式化时间：`src/views/Jobs.tsx`（`fmtTime`）、`src/views/Changes.tsx`（本地 `formatTime`）、`src/components/DiffViewer.tsx`、`src/views/FileUploadManagement.tsx`、`src/views/Sessions.tsx`、`src/views/URLManagement.tsx`、`src/views/AgentSettings 2.tsx`（疑似编辑器残留副本，请评估是否应删除）。
  - 未清洗/未渲染的 Markdown：`src/views/KnowledgeObjects.tsx`（表格 title 列、Drawer title、正文用 `whiteSpace:pre-wrap` 纯文本）、`src/views/AskAI.tsx`（引用 title/summary）、`src/views/Sessions.tsx` 与 `src/components/ChatPanel.tsx`（引用标题、消息正文）、`src/views/URLManagement.tsx`（采集页标题）、`src/views/ClosedLoop.tsx`（`Alert message` 与阶段 detail）。
  - 要求：统一走 `format.ts` 与 `DashboardMarkdown`，并说明"哪些位置应当渲染 Markdown、哪些应当清洗成纯文本"的判定规则（避免一律 Markdown 带来的注入/排版风险）。
- **B7｜工具重复与死代码（建议优化）**：`src/utils/textSanitizer.ts` 的 `sanitizePlainText/hasMarkdownFormatting` 与 `format.ts` 功能重叠且**当前无调用方**（评估删除或改为薄封装）；`KIND_ZH` 在 `AdminLayout.tsx` 与 `Notifications.tsx` 重复；`Sources.tsx` 仍有本地 `statusColor`；`DashboardMarkdown.tsx` 存在 `any`（与禁 `any` 约定冲突）。
- **B8｜通知中心体验收口（建议优化）**：`expiring`（临期）类通知无独立 Tab；`markNotificationRead` 无"已读即跳过"优化；多标签页下轮询重复请求是否需要协调（当前按不需要设计，请复核并给出结论）。
- **B9｜测试基建问题（建议优化）**：antd `Modal` 在 jsdom 关闭后不卸载内容（leave 动画不结束），导致同名文案重复命中，现有测试用 `within(...)` 限定作用域规避——请评估是否有更干净的通用做法（含是否需要 jsdom 层补齐 `matchMedia`/动画 API），并给出测试编写约定。
- **B10｜文档漂移（必须修复）**：`AGENTS.md`/`CLAUDE.md` 中若干描述与现状不符（例如声称根目录有 `package.json` 与 `npm run test:e2e`，实际根目录没有；`docs/` 被 gitignore 但文档体系提到 `docs/plans`、`docs/specs`）。要求：给出一份"文档与仓库现状一致性核查清单 + 修订方案"，明确哪些文档应当由 CI 或脚本校验。

### C. 安全与工程治理（需要你给出明确建议与取舍）

- **C1｜鉴权放宽（高，需决策）**：`backend/api/endpoints/auth.py` 中 `register` 在 `admin_count>0` 时仍会创建普通管理员（可注册多个管理员）；`require_super_admin` 的注释写明"展示项目：所有已登录账号均可用用户管理，不再限制 super_admin"，因此 support 角色可管理用户。现状已用 `xfail(strict=False)` 记录（`tests/test_api.py`）。请给出：演示模式与生产模式的**开关化方案**（例如 `DEMO_RELAX_AUTH=true` 默认开启、生产模板默认关闭）、收紧后的角色矩阵、以及最小回归测试；并说明对本项目"无 Key 可演示、开箱即用"目标的影响。
- **C2｜基线遗留测试的最终处置（需决策）**：`tests/test_url_indexing.py` 整文件 skip（其调用的 `/api/v1/urls:*` 与 legacy index 端点已由 KB 文档管道取代）。请给出去留建议（删除 / 保留 skip / 迁移为 KB 管道的等价用例），并说明对覆盖率与 CI 的影响。
- **C3｜迁移执行策略（必须修复）**：目前新增列依赖人工执行 `backend/scripts/migrate_run_records_and_fields.py`（`create_all` 不会 ALTER 既有表）。请设计"升级既有库"的自动化路径（容器启动时执行？幂等且失败可控？与多副本竞争如何互斥？回滚策略？），并明确新部署与升级部署两条路径。
- **C4｜生产部署检查清单（建议优化）**：限流（登录 5 次/300s 之外是否需要更细粒度）、密钥强制（`REQUIRE_SECRET_KEY`）、HTTPS/`SERVER_DOMAIN`、CORS 白名单（当前 `ALLOWED_ORIGINS=*`）、日志与审计、备份（`backend-data`/`postgres-data`）等，给出一份可执行的发布前 checklist。

## 六、本轮需求清单（可验收写法）

**R1** 建立真实浏览器交互回归（多路由 × 关键交互），判定口径统一、可一键运行、失败能定位（含截图或 DOM 快照证据）。
**R2** 部署版本可见 + 缓存策略明确，用户能自行确认"我跑的是不是最新版"。
**R3** 结构化 API 错误（至少 409/422），不再靠字符串猜测；`run_error` 终态归一化。
**R4** 多源栏目并集（含计数与来源），单源行为不回归。
**R5** 闭环性能达标或给出可接受降级方案（含真机复测数据）。
**R6** 残留时间格式化/Markdown 渲染清单**清零**，并给出"该渲染 vs 该清洗"的判定规则与测试护栏。
**R7** 重复工具与死代码清理（textSanitizer/KIND_ZH/本地 statusColor/`any`）。
**R8** 通知中心收口（临期 Tab、已读跳过、多标签页结论）。
**R9** 文档与仓库现状一致（含一致性核查清单）。
**R10** 鉴权放宽开关化（演示开、生产关）+ 角色矩阵与回归测试；遗留测试处置明确。
**R11** 迁移自动化 + 生产发布 checklist。
**R12** 全部改动保持既有基线不回归（后端 pytest、前端 typecheck/test/build、`smoke_refactor.ps1` 32/32、真实浏览器探针全 PASS）。

## 七、明确的坑与既有约定（请直接复用，避免重复踩）

1. **测试中的 DB 绑定**：`from database import engine/AsyncSessionLocal` 是**导入时快照**；`configure_database()` 会重绑定 `database.engine/AsyncSessionLocal`。测试与服务里必须用 `database.engine` / `database.AsyncSessionLocal` 动态取，否则会写进另一个库（本项目真实发生过：测试把残留 `running` 行写进生产库，导致闭环端点被互斥锁永久 409）。
2. **SQLite 时间精度**：测试库 `CURRENT_TIMESTAMP` 只到秒，按 `created_at` 排序会让同秒内记录退化为按 uuid 主键排序；需要顺序语义时用显式写入的 `finished_at`（微秒）。
3. **路由冲突**：FastAPI 同路径同方法重复注册时，后注册者永不可达；新增流式端点必须用新路径（上一轮 `/closed-loop/stream` 即因此）。
4. **SSE 与请求会话**：长任务（SSE 执行体）必须使用**自己的 DB 会话**，不能复用请求作用域会话，否则客户端断线后依赖回收会让执行中途拿到已关闭会话。
5. **`create_all` 不 ALTER**：新增列必须幂等迁移脚本，且要能在 SQLite 测试库跑通（`PRAGMA table_info` 分支）。
6. **jsdom 不能证明"点得开"**：判定弹层要用 `display!=none && rect>0`；`element.click()` 与真实鼠标事件要分别验证（前者证明处理器挂上、后者证明没被遮挡）。
7. **antd 细节**：两个中文字的按钮会插入空格（`重试` → `重 试`），testing-library 需宽松匹配；`Modal` 在 jsdom 关闭后不卸载内容。
8. **登录态注入**：E2E/探针必须同时写 `localStorage.token` 与 `localStorage.admin`，否则被判定未登录跳 `/login`。
9. **PowerShell 脚本**：本机只有 Windows PowerShell 5.1（无 `pwsh`），含中文的 `.ps1` 必须存为 **UTF-8 with BOM**，否则按 ANSI 解析直接语法报错；控制台输出乱码仅影响显示，接口返回的中文是正确的。
10. **前端镜像重建 ≠ 用户刷新**：重建容器后必须提示用户硬刷新；已在打开状态的标签页仍跑旧 bundle。

## 八、明确不做（除非你能给出强理由）

- 不重写技术栈、不迁移框架、不新增**运行时**第三方依赖；实时推送继续用 SSE（不引 WebSocket）。
- 不引入消息队列/工作流引擎/前端状态管理库；不引入除"开发/测试依赖"之外的浏览器自动化重依赖（若引入 Playwright 需给出明确理由与体积评估，并保证 `npm ci --omit=dev` 的部署路径不受影响）。
- 不做与 A/B/C 无关的大范围重构（避免方案膨胀）。
- 不做多租户/权限体系扩张（只做 C1 的开关化收紧，不新增角色维度）。

## 九、硬性约束

1. **技术栈不得变更**：FastAPI + 异步 SQLAlchemy + PostgreSQL + Redis + Qdrant + Scrapling；Next.js 14 App Router + TypeScript + antd + ECharts + react-markdown；模型走 DashScope。
2. **零新增运行时依赖**：SSE 用既有 `StreamingResponse`；前端流式用原生 `fetch`/`ReadableStream`；动态表单用 antd 现有能力；真实浏览器验证优先复用零依赖 CDP 探针。
3. **接口向后兼容**：既有 REST 端点路径与响应字段只增不改；结构化错误必须保留 `.message` 兼容；MCP 七工具契约不动。
4. **数据库变更幂等可迁移**：新表/新列须有幂等迁移，重复执行安全，且提供升级既有库的自动化路径（C3）。
5. **分层规范不变**：逻辑在 `backend/services/`，路由薄，模型集中 `models.py`；前端 views/components/services/utils 分层不变。
6. **无 Key 可演示**：任何新链路必须有确定性降级（Mock/规则兜底），外部依赖失败要"降级 + 可见提示"，绝不 500 主链路。
7. **部署约束**：单机 `docker compose up -d` 一键起，不新增中间件容器；Windows 开发 + Linux 部署均可跑。
8. **性能约束**：闭环（不含采集）目标 ≤15s（当前 16.9–18.6s，需给出收敛方案或明确的接受理由）；SSE 首事件 ≤1.5s；监控/列表接口 P95 ≤500ms。
9. **风格**：中文注释文案；Python 4 空格 snake_case；TS 2 空格 PascalCase、显式类型、禁 `any`；Conventional Commits。
10. **可测试**：每模块给出单元/接口/渲染/真机验证要点，并说明本地与容器两种验证路径；R1 的真实浏览器验证必须能在 CI 或本地一键跑（并说明前置条件：需先起栈、需登录态）。
11. **安全**：外部 URL 一律过 `backend/services/url_safety.py`；新增对外入口必须做鉴权与限流评估。

## 十、输出格式（严格执行）

输出全部使用 markdown，**必须包含且不省略**下面 6 个章节；章节标题保持原样：

## 一、原有项目现状与问题诊断
梳理现有项目架构、业务逻辑。列出：致命缺陷、耦合问题、可维护性问题、潜在bug、性能问题，区分【必须修复】和【建议优化】。
（要求：必须逐条覆盖本文档「五、A/B/C」全部条目 A1、B1–B10、C1–C4，并额外给出你独立发现的问题；每条给出：现象、根因判断、影响面、修复方向、验证方式、优先级。对 A1 必须给出"为什么第一轮会误判 PASS"的机制性解释与防复发设计。）

## 二、本次重构总体目标与硬性约束
写明业务目标；同时列出硬性约束：技术栈不能变更、兼容原有对外接口、部署环境约束、性能约束、不要引入额外重型第三方库。

## 三、重构后整体架构设计
1. 输出完整项目目录树结构（标注新增/修改/删除）
2. 描述各组件之间数据流与调用关系（重点：真实浏览器验证链路、版本可见性、结构化错误传播、多源栏目并集、迁移自动化）
3. 列出新增/移除的第三方依赖（明确区分运行时依赖与开发/测试依赖，并给出体积与部署影响评估）

## 四、模块拆分与模块职责定义
将系统拆分为高内聚低耦合的独立模块。每个模块说明：模块职责、依赖哪些其他模块、哪些外部模块依赖本模块。
（要求：把"真实浏览器验证"、"版本可见性"、"结构化错误"、"迁移执行器"各自作为独立模块定义，不要混进现有模块。）

## 五、完整接口契约规格
所有模块对外暴露的函数、API接口、数据结构体。写明：函数/接口名称、输入参数、输出数据结构、异常返回、数据类型定义。这份契约是后续编码的标准。
（要求至少覆盖：① 真实浏览器验证脚本的 CLI 契约与结果 JSON 结构（含判定口径、证据字段、失败分类）② 结构化错误类型（字段、兼容策略、各端点错误码映射）③ 版本信息接口/注入契约 ④ 多源栏目接口契约（新增或扩展现有）⑤ 迁移执行器契约（幂等、并发互斥、失败语义、回滚）⑥ 鉴权开关配置项与角色矩阵表。事件名/字段名/错误码一旦确定不得在实现阶段随意更改。）

## 六、分模块开发任务清单
每一条任务对应一个独立模块，任务描述必须完整独立，可以直接复制粘贴给编码模型进行开发。
每条任务包含：
- 模块名称
- 模块职责
- 需要遵守的接口契约
- 业务逻辑要求
- 输入输出说明
- 单元测试验证要点

（要求：按依赖顺序排列，标注前置关系与可并行关系；每条任务明确涉及的文件路径；区分【必须修复】与【建议优化】；对涉及用户可见行为的任务，必须指明"真机验证方式"（用 `scripts/browser_probe.mjs` 或扩展后的验证脚本如何断言）；末尾给出"验收清单"——按本文档 R1–R12 逐条给出可执行的验证命令或操作步骤。）

输出完成后，不需要编写实现代码。我后续会把每一条【分模块开发任务清单】单独交给编码模型逐个实现。

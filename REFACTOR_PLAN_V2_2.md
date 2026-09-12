# 校务智汇中台（Campus Intelligence Hub 2.0）v2.2「收口与加固」方案

> 版本：v1.0（2026-09-13） · 依据「v2.2 提示词」产出 · 供编码模型按第六章逐条执行
> 上游：v3.1 提示词 → `REFACTOR_PLAN_V2.md`（T1–T15 已落地，见其「七、实现记录」）
> 性质：验证手段补强 + 已知缺口收口 + 残留清理 + 安全与工程治理。**不是新功能开发、不是重写。**
> 事实基线：提示词所述事实 + 仓库抽样核验（`REFACTOR_PLAN_V2.md` §7、`scripts/browser_probe.mjs`、`api.ts`、`backend/api/endpoints/auth.py`、`tests/test_url_indexing.py`、`frontend-nextjs/src/views/` 目录）

---

## 一、原有项目现状与问题诊断

### 1.0 当前状态速览

上一轮（v2.1）已交付：闭环 SSE 流式 + 运行记录/回放 + Schema 配置面板 + 实时决策时间线 + 展示层统一适配 + 通知中心修复 + 监控时间真源 + 栏目动态发现 + 采集时间过滤。验证基线：后端 386 passed / 32 skipped / 2 xfailed；前端 28 文件 191 用例；真机冒烟 32/32。

本轮要收口的核心矛盾：**上一轮"已修复"的判定手段（jsdom + 接口冒烟）不足以证明"用户点得开、跑得是新代码"**，外加一批已识别未处理的缺口（B 类）与治理项（C 类）。

---

### A. 验证手段不足（最高优先级）

**A1｜"用户说没好、我说已修好"的机制性诊断 【必须修复 · 最高】**

- **为什么第一轮会误判 PASS（机制性解释，三层叠加）**：
  1. **判定层错误**：jsdom 渲染测试证明的是"React 组件树里事件处理器已挂上"，而用户的故障是"真实浏览器里点击无反应"——两者不等价。jsdom 无布局引擎（无命中测试、无遮挡、无 `pointer-events` 计算、无真实弹层定位），`element.click()` 直接触发 React 合成事件，绕过了"浏览器到底把点击派发给谁"这一整条真实链路。
  2. **探针判定口径错误**：第一版探针用 `document.querySelector('.ant-popover')` 的**存在性**判定"打开了"。但 antd 弹层关闭后节点仍留在 DOM（`display:none`），存在性检查把"从未打开"误判成 PASS。这是测试工具本身的假阳性。
  3. **部署层错觉**：前端镜像是构建产物。重建镜像只让**新加载**的页面拿到新 bundle；用户已打开的标签页跑的是内存中的旧 JS。于是出现"容器里 grep 得到新代码、全新页面 PASS、用户仍报故障"的三方矛盾——三方都没错，跑的不是同一份代码。
- **影响面**：所有"用户可见行为"类修复的交付可信度；比赛演示现场无法容忍此类误判。
- **修复方向（防复发设计，即 R1/R2/R3 的制度化）**：
  1. **判定口径统一并写死在工具里**：弹层"可见"必须同时满足三条 —— ① `getComputedStyle(el).display !== "none"`；② `getBoundingClientRect()` 宽高均 > 0；③ **与视口有足够交集**（`visibleHeightRatio > 0.5`，即在视口内的可见高度占比过半）。
     ⚠️ 第 ③ 条是实现期新增的**必需**条件：仅凭 ①② 仍会假阳性——真实缺陷正是"面板有正常尺寸 364×811、`display:block`，但被放在视口上方 6760px"（见 A5）。交互触发一律用 `Input.dispatchMouseEvent`（真实命中测试），`element.click()` 仅作对照项；每条断言保留证据（rect、display、viewport、visibleHeightRatio、inlineStyle、截图路径）。
  2. **场景化多路由冒烟**：把 `browser_probe.mjs` 从"单页面单元素探针"升级为"场景运行器"——场景 = 路由 + 登录态注入 + 有序步骤（点击/等待/断言），覆盖 §五.A 要求的五组关键交互。
  3. **版本可见性**（见 A2）：让用户和开发者能一眼确认"当前跑的是哪个构建"，从根上消除"旧 bundle 误报"。
  4. **交付纪律**：凡涉及用户可见交互的修复，验收必须以真实浏览器场景 PASS 为准，jsdom 测试仅作回归护栏（此纪律写入 AGENTS.md 与任务验收清单）。
- **验证方式**：`node scripts/browser_smoke.mjs` 全场景 PASS；故意构造失败（改选择器）能正确报 FAIL 并产出证据文件。

**A2｜部署版本不可见 【必须修复 · 高】**
- 现象：无法回答"用户浏览器里跑的是不是最新构建"。
- 修复方向：三层可见——① 前端构建期注入 `BUILD_ID`（git short hash + 构建时间），在 AdminLayout 侧边栏底部常驻显示，且给布局根节点与通知面板挂 `data-build` 属性（探针可断言）；② 后端新增 `GET /api/v1/version`（公开、只读、无敏感信息），前端启动时比对自身 BUILD_ID 与后端 version，不一致时 Header 显示黄色"前后端版本不一致"提示；③ 缓存策略明确：Next 静态 chunk 自带内容哈希（长缓存安全），**HTML 必须不缓存**——nginx 对 `text/html` 响应加 `Cache-Control: no-cache`（需核查现状并补齐）。
- 验证方式：重建镜像后硬刷新，页面底部 BUILD_ID 变化；探针场景断言 `data-build` 与 `/api/v1/version` 同 commit。

**A3｜Playwright 引入评估 【评估项 → 结论：本轮不引入】**

| 维度 | 零依赖 CDP 探针（现状扩展） | Playwright（devDependency） |
|---|---|---|
| 安装体积 | 0（复用本机 Edge/Chrome） | npm 包 ~50MB + 浏览器下载 ~300MB（可用系统 Chrome 通道减免） |
| 维护成本 | 场景 JSON + 一个 runner（~300 行），协议面窄 | API 稳定、文档好，但多一套测试语法与版本升级 |
| CI 可用性 | 需 CI 镜像含 Chrome（或挂通道）；本项目 CI 轻量，够 用 | 官方 Docker 镜像开箱即用，跨浏览器矩阵强 |
| 满足本轮需求 | 完全满足（单浏览器、5 组场景、截图证据） | 过剩（跨浏览器矩阵、trace viewer 用不上） |
| 部署影响 | 无（纯脚本） | 无（devDependency，`npm ci --omit=dev` 不装） |

- **结论：继续扩展零依赖 CDP 探针，不引入 Playwright**。触发重评的条件写入文档：需要跨浏览器矩阵（Firefox/Safari）、需要移动端视口模拟、场景数超过 ~20 个导致自研 runner 维护成本反超。

**A4｜用户端排查清单 【必须修复 · 中】**
- 交付一份可交给非技术用户的一页清单（写入 `README.md` 故障排查节 + `DEMO_SCRIPT.md` 附录）：
  1. 硬刷新（Ctrl+F5）；2. DevTools → Network 勾选 Disable cache 后刷新；3. 关掉标签页重开（不是刷新，是全新加载）；4. 看页面左下角 BUILD_ID 是否与发布说明一致；5. F12 Console 有无红字报错（截图反馈）；6. 确认当前路由；7. 同页其它按钮是否可点（区分"整页失去交互=hydration 失败"与"单个按钮问题"）；8. 换浏览器/窗口宽度复测。

**A5｜通知铃铛"点了没反应"的真因：Popover 被定位到 -1000vh 【已在开工前修复 · 最高】**
- **现象**：用户报"右上角铃铛点了没反应"，且在我基于 jsdom 判定"已修复"并重建镜像后**依旧**如此。
- **真机取证（`scripts/browser_probe.mjs`，真实窗口尺寸，无 Emulation）**：点击后 `.ant-popover` 的 `display:block`、尺寸正常 `364×811`，但 `getBoundingClientRect().top = -6760px`，而 `-6760 = -1000 × 视口高度(676px)`；`visibleHeightRatio = 0`（完全在视口外）。五种窗口尺寸（1024×768 → 1920×1080）与四个路由全部复现；强制 resize 触发 rc-align 重新对齐后仍是 `-1000vh`。
- **定位**：inline style 为 `--arrow-x: 348px; --arrow-y: -6px; inset: -6760px 24px auto auto`——横向对齐正确（`right:24px`、箭头 x 正确），**只有纵向偏移错**，即 `useAlign` 产出的 `offsetY` 本身等于 `-1000vh`。`@rc-component/trigger/es/Popup/index.js` L74-77 的"隐藏待对齐"初值正是 `left:-1000vw; top:-1000vh`，而 antd 5.29.3 + `@rc-component/trigger` 2.3.1（版本匹配、无错配）下该值未被正确覆盖。
- **已试无效的方案**（避免重复投入）：① `autoAdjustOverflow={false}`（仍 -1000vh）；② 给面板加 `max-height: 50vh` 内部滚动（高度从 811 降到 435，位置不动）；③ 强制 resize 触发重新对齐（不生效）；④ 排除"面板高于视口"（1308px 高视口下仍复现）。
- **本轮改法（已完成并真机验证）**：把通知面板由 `Popover` 改为 antd **`Drawer`（placement="right"）**——`position: fixed`、不经过 rc-align 数学，天然可见且可滚动（顺带解决"通知多时面板 800px+ 超过视口"的 UX 问题）。保留铃铛为触发器、保留 kind 中文标签/时间格式化/失败重试/一键全部已读/点击 `link` 跳转等既有能力。
- **验证证据**：`node scripts/browser_probe.mjs --url http://localhost:3000/<route> --window 1366x768 --expect ".ant-drawer"` → `/overview`、`/sources`、`/closed-loop`、`/insights` 四路由均 `open=true, visibleHeightRatio=1`，无 console 报错；前端 `npm run typecheck` 0 错、AdminLayout 渲染测试 6/6 通过。
- **遗留待办（写入实现任务）**：① 该缺陷属 antd/rc-trigger 侧问题，需在 T-依赖 任务中评估"升级 antd 补丁版本后是否恢复 Popover"（用探针回归证明），本方案不锁定 antd 版本变更；② 探针的"视口交集"判定口径（A1-1 第③条）必须落地，否则同类缺陷仍会被判成 PASS；③ 其它使用 Popover/Tooltip 的位置（如 Sources 的失败原因 Tooltip）需用同一探针资产做一次巡检，确认是否存在同类定位问题。

---

### B. 上一轮识别但未处理的缺口

**B1｜`api.ts` 冻结导致错误语义丢失 【必须修复 · 高】**
- 根因：`streamClosedLoop` 非 2xx 时 `throw new Error(await parseErrorResponse(response))`（已核验 api.ts L1292），HTTP 状态码与响应体结构被拍平成字符串。后果：409 拿不到 `run_id`（前端只能 `listClosedLoopRuns` 猜最新一条——并发/时序下不可靠）；422 的 `[{field,message}]` 数组被拼成 `"; "` 分隔字符串，表单无法按字段定位错误。
- 修复方向：新增 `ApiError extends Error`，携带 `status: number`、`detail: unknown`（原始 detail 结构）、`payload: unknown`（完整响应体）、便捷访问器 `runId?: string` / `fieldErrors?: {field,message}[]`。`.message` 保持与现状相同的字符串（既有 catch 方零改动）。`api.request()` 与 `streamClosedLoop` 统一改抛 `ApiError`。
- 受影响调用点与迁移：`ClosedLoop.tsx`（409 → 用 `err.runId` 直接定位冲突运行并提示"查看进行中的运行"）；`RunConfigModal.tsx`（422 → `fieldErrors` 映射到 Form.Item validateStatus）；其余 catch 方仅消费 `.message`，**无需改动**（逐个 grep 确认并列入任务）。
- 验证方式：单测构造 409/422 Response 断言结构化字段；既有 191 用例全绿（兼容性证明）。

**B2｜栏目发现只在单源时加载 【必须修复 · 中】**
- 根因：`GET /sources/{id}/columns` 以单源为路径参数，闭环配置面板多选数据源后无法获得可用栏目。
- 修复方向：**新增**跨源接口 `GET /api/v1/sources/columns?source_ids=a,b,c`（不复用单源路径避免语义混淆）：返回同名栏目合并并集，`count` 为各源合计，`sources: [{source_id, count}]` 标注来源分布；`source_ids` 为空 = 全部 active 源。单源接口保持不变（行为不回归）。过滤语义明确：多源采集带 column 时对各源分别做等值过滤（栏目只存在于部分源时，其它源自然筛空，属预期行为，写进接口注释与面板 hint）。
- 验证方式：后端单测（合并/计数/来源标注/空参）；前端渲染测试多选后下拉刷新。

**B3｜闭环性能未达标（16.9–18.6s vs 目标 ≤15s） 【必须修复或明确接受 · 高】**
- 根因：日报与洞察为**两次串行真实 LLM 生成**，且各自独立拉取运营数据。
- 修复方向（按收益排序）：
  1. **并行化**：治理阶段完成后，`gen_digest` 与 `gen_insight` 用 `asyncio.gather` 并行（两者无数据依赖，只读库 + 写各自表）。预期收益：总耗时从"两次 LLM 相加"降为"取最大值"，实测口径下约 18.6s → 10–12s。
  2. **复用运营数据快照**：日报与洞察的数据基础（监控/健康度/变更统计）抽成单次查询的共享快照对象传入两个生成器，消除重复查询（次要收益，主要为一致性：两份报告基于同一时刻数据）。
  3. **事件语义不变**：两个生成并行期间各产自己的 `stage_decision`，事件流按完成先后到达（回放按 `finished_at` 排序已支持非顺序到达）。
  4. **兜底表述**：并行化后真机复测若仍 >15s（LLM 端延迟不可控），则对外口径改为"不含采集 P50 ≤15s（依赖 LLM 端延迟），Mock 模式 ≤5s"，并在配置面板提供"跳过洞察生成"开关（已有 `gen_insight` 字段，无需新增）。
- 验证方式：单测断言两生成器被并行调度（记录调用时间戳重叠）；真机复测两次取中位数写入实现记录。

**B4｜`date` 字段不回填 【建议优化 · 低】**
- 判断依据：antd v5 的 DatePicker **官方绑定 dayjs**，dayjs 已作为 antd 的直接依赖存在于 node_modules——`import dayjs from "dayjs"` 在功能上安全。风险是"幽灵依赖"（未在自己 package.json 声明），包管理器变动时可能丢失。
- 方案：改为受控实现（value 为 `dayjs | null`，onChange 转 ISO 串），**并在 `frontend-nextjs/package.json` 的 dependencies 中显式声明 `dayjs`（版本对齐 antd 实际安装版本）**。声明既有传递依赖不算"新增运行时依赖"（node_modules 内容与镜像体积零变化），但消除了幽灵依赖风险。若评审坚持零声明，则退化为：自行实现受控原生 `<input type="date">` 包装组件（体积更小、样式与 antd 略异）。推荐前者。
- 验证方式：渲染测试——程序化传入 since/until 后 DatePicker 回显正确日期。

**B5｜`run_error` 后 `streamClosedLoop` 仍 resolve 为 ok 【必须修复 · 中】**
- 根因：流读取器只在传输层失败时 reject，业务层 `run_error` 事件被当普通事件吞掉，调用方靠自行监听抑制成功提示（语义颠倒）。
- 修复方向：归一化终态——`streamClosedLoop` 的返回类型改为 `Promise<StreamResult>`：`{run_id: string, terminal: "run_finished" | "run_error", status: "ok" | "partial" | "error", summary: string}`。流内收到 `run_finished`/`run_error` 即以此 resolve；流异常中断按既有逻辑转回放补齐后 resolve（terminal 取回放终态）；HTTP 层失败 reject `ApiError`（与 B1 统一）。调用点（`ClosedLoop.tsx`）按 `terminal` 分支提示，删除事件监听抑制 hack。
- 验证方式：单测 mock 三种终态流；渲染测试断言 run_error 时显示失败提示而非"执行完成"。

**B6｜残留"时间自行格式化 / 裸 Markdown"清单 【必须修复 · 中】**
- 判定规则（冻结，写入 `format.ts` 文件头注释与 AGENTS.md）：
  - **清洗成纯文本**（`displayTitle`/`stripInlineMd`）：一切**标题类、列表单元格、引用标题、Drawer/Modal 标题、Alert message、Tooltip**——特征是"来源不可控 + 行内展示 + 空间有限"，渲染 Markdown 会带来排版崩坏与注入面。
  - **渲染 Markdown**（`DashboardMarkdown`）：一切**正文类、系统/LLM 生成的长文**——快讯/洞察/日报正文、问答回答、决策 detail（若为 LLM 产出的多行 Markdown）、知识对象正文 Drawer 内容区。注意 `DashboardMarkdown` 必须保持禁用 raw HTML（react-markdown 默认不渲染 HTML，禁止使用 `rehype-raw`）。
  - **时间一律 `formatDateTime`/`formatTime`**，禁止任何组件内自行 `new Date().toLocaleString()` / 自写 fmt 函数。
- 迁移清单（全部清零）：时间——`Jobs.tsx`（删本地 `fmtTime`）、`Changes.tsx`（删本地 `formatTime`）、`DiffViewer.tsx`、`FileUploadManagement.tsx`、`Sessions.tsx`、`URLManagement.tsx`、`AgentSettings 2.tsx`（**先评估删除**：已核验该文件存在于 views/，文件名带空格+序号是典型编辑器"另存为"残留，任务中先 grep 引用方，无引用则删除，有引用则合并差异后删除）；Markdown——`KnowledgeObjects.tsx`（表格 title 列、Drawer title 走 displayTitle，正文区改 DashboardMarkdown）、`AskAI.tsx`（引用 title/summary 清洗）、`Sessions.tsx`/`ChatPanel.tsx`（引用标题清洗、消息正文维持现状判定：用户输入纯文本不渲染，助手/系统长文渲染）、`URLManagement.tsx`（采集页标题清洗）、`ClosedLoop.tsx`（Alert message 与阶段 detail：summary 清洗、detail 若是 LLM 多行文本走 DashboardMarkdown）。
- 验证方式：对清单每个文件加/改渲染测试断言无 `**` 残留、时间格式统一；`grep -rn "toLocaleString\|fmtTime" src/` 为零（纳入 B10 一致性脚本）。

**B7｜工具重复与死代码 【建议优化 · 低】**（已抽样核验属实）
- `src/utils/textSanitizer.ts`：已核验**零调用方** → 删除（不薄封装——与 format.ts 双出口迟早再漂移）。
- `KIND_ZH` 重复（AdminLayout.tsx / Notifications.tsx）→ 提取到 `src/utils/constants.ts`（新）单一出口。
- `Sources.tsx` 本地 `statusColor` → 删除，import format.ts。
- `DashboardMarkdown.tsx` L22 `({ inline, children }: any)` → 用 react-markdown components 的实际 prop 类型显式标注（`{ inline?: boolean; children?: React.ReactNode }`），消除禁 `any` 违例。
- 验证方式：typecheck 0 错；`grep -rn ": any" src/` 归零（既有豁免除外，写入约定）。

**B8｜通知中心体验收口 【建议优化 · 低】**
- `expiring` 临期 Tab：Notifications.tsx 的 kind Tabs 补齐（brief/insight/expiring/system 四项全）。
- 已读即跳过：`markNotificationRead` 调用前查本地状态，已读则不发请求；后端 `/read` 端点天然幂等（重复置 true 无副作用），无需改。
- 多标签页结论（复核）：维持"每标签页独立 30s 轮询、不协调"——通知是低频只读 + 幂等写，重复请求成本可忽略，引入 BroadcastChannel/leader election 属于过度设计。结论写入实现记录，附重新触发评估的条件（轮询间隔 <10s 或接口变重时）。

**B9｜测试基建：jsdom 弹层与动画 【建议优化 · 低】**
- 现状：`Modal` 关闭后 jsdom 不卸载内容（rc 动画不结束），同名文案重复命中，测试用 `within()` 限定规避。
- 方案（通用做法，不再逐测试打补丁）：在 vitest setup 文件统一补齐 jsdom 缺口——`matchMedia` mock、`ResizeObserver` mock；约定**portal 组件断言一律用 `within(screen.getByRole("dialog"))` / `within(document.body)`**；对"关闭后应消失"的断言，组件侧优先 `destroyOnClose`（antd 原生支持、零依赖），测试侧用 `waitFor` + `queryBy*` 宽松判定。测试编写约定写入 `tests/unit/README.md`（新）：含"两字按钮空格"（`重 试`）宽松匹配、登录态注入、弹层判定口径与真机探针的分工（jsdom=回归护栏，探针=交付判定）。

**B10｜文档漂移 【必须修复 · 中】**（部分已核验：根目录确无 `package.json`；`docs/` 在 gitignore）
- 一致性核查清单 + 修订方案：
  1. `AGENTS.md`：删除"根目录 package.json / `npm run test:e2e` / `docs/plans`、`docs/specs`"等与现状不符的段落；补充本轮新事实（`/closed-loop/stream`、`browser_smoke.mjs`、版本可见性、测试约定、`DEMO_RELAX_AUTH`）。
  2. `CLAUDE.md`：同步修订同样段落。
  3. 机械化校验：`scripts/docs_check.ps1`（新，UTF-8 BOM）：断言文档中引用的路径/脚本真实存在（路径白名单逐个 Test-Path）、`grep -rn "toLocaleString" frontend-nextjs/src/` 为零、`grep -c ": any"` 不增。纳入 `verify_all` 编排（见 D1），失败即非零退出。
- 验证方式：docs_check 通过；故意改坏一处路径能报出。

---

### C. 安全与工程治理

**C1｜鉴权放宽开关化 【必须修复 · 高】**（已核验 `auth.py` L157 注释与 L215/281 admin_count 逻辑属实）
- 方案：新增配置项 `DEMO_RELAX_AUTH: bool = True`（`config.py`，env 可覆盖）。语义：
  - `True`（演示模式，默认）：维持现状——register 在已有管理员时仍可注册普通管理员；`require_super_admin` 放行所有已登录账号。保证"无 Key 可演示、开箱即用"不受任何影响。
  - `False`（生产模式）：register 仅允许 bootstrap 首个管理员（`admin_count>0` → 403 `{detail: "注册已关闭，请联系管理员创建账号"}`）；`require_super_admin` 恢复真实校验（非 super_admin → 403）。
- 角色矩阵（生产模式生效；演示模式全列"放行"）：用户管理增删改=super_admin；查看用户列表=super_admin；其余管理操作=已登录 admin；公开问答/检索=public_client 既有口径不动。
- 部署模板：`docker-compose.yml` 不设置该变量（默认演示）；`DEPLOY-GUIDE.md` 生产章节明确要求 `DEMO_RELAX_AUTH=false`。
- 回归测试：两种模式参数化——`DEMO_RELAX_AUTH=false` 时原 2 个 xfail 用例转为**必须通过**（xfail 移除，改断言 403）；`=true` 时断言现状行为。测试内用 monkeypatch 改 settings 后重挂依赖覆盖。
- 取舍说明：不做角色维度扩张（不引入新角色、不做资源级 ACL），只做"演示/生产"两档开关——符合"不做多租户/权限体系扩张"。

**C2｜`tests/test_url_indexing.py` 处置 【需决策 → 建议：删除 + 等价迁移】**
- 建议：删除整文件（其目标端点已被 KB 文档管道取代，保留 skip 只制造噪音与"看起来有覆盖"的错觉）；**同时**核查 KB 文档管道（`kb_document_endpoints.py` + `kb_document_processor.py`）是否已有等价测试覆盖上传→解析→入 Qdrant→状态流转——若有则在删除提交信息中注明等价用例位置；若无则补 2 个最小用例（上传 txt → ready；非法类型 → 400/422）。对 CI 影响：skipped 数 -7，passed 数视补用例 +0~2；覆盖率口径不降。
- 若用户倾向保守：保留 skip 但把 skip 理由从 docstring 提升为文件级 `pytestmark` 并在 CI 报告中显式列出——作为备选写入任务，推荐前者。

**C3｜迁移执行自动化 【必须修复 · 高】**
- 方案：**启动时迁移执行器（migration runner）**。
  - 落点：`backend/services/migration_runner.py`（新），在 `main.py` startup 事件中、调度器启动**之前**调用；迁移清单为有序注册表（name → 幂等 async 函数），执行记录落 `schema_migrations` 表（name PK, applied_at）——已执行的跳过，未执行的依次执行。
  - 并发互斥：PostgreSQL 用 `SELECT pg_advisory_lock(<固定常量>)` 包裹整个 runner（多副本/重复启动安全；拿不到锁的实例等待后重查记录）；SQLite（测试）无 advisory lock，单进程语义天然安全，分支注释说明。
  - 失败语义：任一迁移失败 → 记录日志 + **中止启动**（fail fast；幂等保证重启重试安全），绝不"带病启动"。
  - 既有脚本处理：`migrate_run_records_and_fields.py` 的内容注册进 runner（保留脚本本体作为手动运维入口，内部调同一批函数，不双份实现）。
  - 新部署 vs 升级部署：新部署 `create_all` 建全量结构后 runner 仅写执行记录（秒过）；升级部署 runner 补差量。两条路径同一入口。
  - 回滚策略：迁移只增不删（additive-only 纪律）；需要毁结构时走"新列/新表 + 代码切换 + 观察期 + 后续版本清理"的 expand-contract，不做 down 迁移。写入 DEPLOY-GUIDE。
- 验证方式：单测——空库跑两遍 runner（第二遍零执行）；人为插入部分执行记录模拟升级库；模拟失败迁移断言进程中止语义（函数抛错）且重跑可续。

**C4｜生产部署检查清单 【建议优化 · 中】**
- 产出 `DEPLOY-GUIDE.md` 新增「发布前 checklist」章节（可勾选、每项含验证命令）：
  1. `DEMO_RELAX_AUTH=false`；2. `SECRET_KEY`/`ENCRYPTION_KEY` 强随机且 `REQUIRE_SECRET_KEY=true`（既有配置项，核查默认）；3. `ALLOWED_ORIGINS` 收紧为实际域名（当前 `*`）；4. HTTPS 终止与 `SERVER_DOMAIN`；5. 登录限流现状（5 次/300s）复核 + 对 `/closed-loop/stream`、`/sources/{id}/run` 等重端点评估是否纳入既有 rate-limit 中间件（结论：纳入，按既有 helper 配 10 次/60s，防误触连点）；6. 数据卷备份（`backend-data`/`postgres-data` 的 `docker run --rm -v ... tar` 命令模板）；7. 迁移执行器日志检查（启动日志出现 `migrations applied: n`）；8. 烟雾验证三连：smoke_refactor.ps1 → browser_smoke.mjs → 手动演示动线；9. 日志级别与访问日志保留；10. 版本可见（页面 BUILD_ID == 发布 tag）。

---

### 1.9 独立发现的问题（提示词之外）

- **D1（必须修复 · 小）**：验证手段分散（pytest / vitest / smoke_refactor.ps1 / browser_probe.mjs / docs_check），无一键编排入口 → 新增 `scripts/verify_all.ps1`（UTF-8 BOM）：按序执行 后端 pytest → 前端 typecheck/test/build → 真机 smoke → 浏览器场景冒烟 → docs_check，任一失败即停并打印失败阶段；作为 R12 的统一验收命令。
- **D2（建议优化 · 小）**：`/api/v1/version` 若需公开访问，注意不泄露敏感信息（只返回 version/commit/build_time/environment 枚举）；若决定挂到 `/api/admin` 下鉴权，则探针与前端比对逻辑需带 token——推荐公开只读最小信息版（版本号不构成攻击面）。
- **D3（建议优化 · 小）**：`browser_probe.mjs` 的登录态依赖环境变量手填 token——场景运行器应内置"自动登录"步骤（调 `POST /api/admin/login` 拿 token 再注入 localStorage 两键），降低使用门槛与 CI 化难度。

### 1.10 待确认问题清单

1. **antd 实际安装的 dayjs 版本号**：决定 B4 显式声明的 version range（需要：实现者执行 `npm ls dayjs` 后把版本写进任务 T7 的验收标准）。
2. **nginx 现状是否已对 HTML 响应禁缓存**：决定 A2 缓存策略是"补齐"还是"确认即可"（需要：运维/实现者查看 `nginx/` 配置中 `text/html` 与 `/.next/static` 的 Cache-Control）。
3. **`AgentSettings 2.tsx` 是否有引用方**：决定删除还是合并（需要：实现者 grep；本方案按"无引用则删"预写）。
4. **KB 文档管道现有测试覆盖度**：决定 C2 是否需要补 2 个等价用例（需要：实现者 `ls backend/tests | grep kb`）。
5. **比赛演示环境的浏览器**：若评委现场只用 Edge/Chrome，则 CDP 探针完全覆盖；若可能用 Safari/Firefox，A3 的 Playwright 结论需重评（需要：用户确认演示设备矩阵）。

---

## 二、本次重构总体目标与硬性约束

### 2.1 业务目标

1. **验得出**：凡用户可见的交互修复，交付判定从"jsdom 通过"升级为"真实浏览器场景 PASS + 版本可见"（R1/R2）。
2. **收得拢**：B1–B10 已知缺口逐条清零，展示层残留归零、错误语义结构化、多源栏目可用、性能达标或有明确降级口径（R3–R9）。
3. **管得住**：鉴权演示/生产两档开关化、迁移自动化、文档与仓库机械化一致、发布前 checklist 可执行（R10/R11）。
4. **不回归**：R12 全基线绿（含新增浏览器场景冒烟）。

### 2.2 硬性约束（对应提示词第九节，全部接受）

1. 技术栈不变（FastAPI/Next.js 14/antd/Qdrant/PG/Redis/Scrapling/DashScope）。
2. 零新增运行时依赖：浏览器验证复用零依赖 CDP 探针；B4 的 dayjs 为**既有传递依赖的显式声明**（体积零变化），视为不违反本条并在任务中注明理由。
3. 接口向后兼容：只增不改；`ApiError` 保留 `.message` 兼容；MCP 七工具不动。
4. 数据库变更幂等可迁移，且提供启动时自动化迁移路径（C3）。
5. 分层规范不变。
6. 无 Key 可演示：鉴权开关默认演示档；性能降级口径明确。
7. 单机 compose 一键起，不新增中间件容器；Windows/Linux 均可跑。
8. 性能：闭环不含采集 ≤15s（并行化收敛，否则按 B3-4 口径对外）；SSE 首事件 ≤1.5s；监控/列表 P95 ≤500ms。
9. 风格约束不变（含禁 `any`——本轮顺带清零既有违例）。
10. 每模块给出测试要点与本地/容器两种验证路径；浏览器冒烟一键可跑并写明前置（起栈 + 自动登录）。
11. 外部 URL 过 `url_safety.py`；新增对外入口（`/api/v1/version`、`/sources/columns`）做鉴权与限流评估（version 公开只读、columns 鉴权同单源接口）。

### 2.3 改动性质汇总

- **就地修复**：B1/B5（api.ts 错误与终态）、B3（并行化）、B6（残留清零）、B7（死代码）、B8（通知收口）、B9（测试基建）、B10（文档）、C1（鉴权开关）、C3（迁移自动化）。
- **新增小模块**：`scripts/browser_smoke.mjs`（场景运行器）、`GET /api/v1/version` 与构建注入、`GET /api/v1/sources/columns`、`backend/services/migration_runner.py`、`scripts/verify_all.ps1`、`scripts/docs_check.ps1`。
- **明确不做（YAGNI）**：Playwright（附重评条件）、WebSocket、多标签页协调、角色维度扩张、down 迁移、跨浏览器矩阵。

---

## 三、重构后整体架构设计

### 3.1 目录树（标注 新增/修改/删除；仅列本轮涉及）

```
campus-intelligence-hub/
├─ backend/
│  ├─ config.py                                  【修改】+DEMO_RELAX_AUTH（默认 true）
│  ├─ main.py                                    【修改】startup 调用 migration_runner（调度器之前）；
│  │                                                    挂载 version 路由
│  ├─ api/
│  │  ├─ endpoints/auth.py                       【修改】register/require_super_admin 按开关分档
│  │  └─ v1/
│  │     ├─ config_endpoints.py                  【修改】+GET /sources/columns（跨源并集）；
│  │     │                                            +GET /version（或独立 version_endpoints.py）
│  │     └─ closed_loop_endpoints.py             【不变】（B5 纯前端归一化；409 体已含 run_id）
│  ├─ services/
│  │  ├─ migration_runner.py                     【新增】注册表 + schema_migrations + advisory lock
│  │  ├─ column_discovery_service.py             【修改】+discover_columns_multi(source_ids)
│  │  ├─ agent_orchestrator.py                   【修改】日报/洞察 gather 并行 + 共享运营快照
│  │  ├─ insight_generator.py                    【修改】接受共享快照参数（默认自查，兼容）
│  │  └─ digest_service.py                       【修改】同上
│  ├─ scripts/migrate_run_records_and_fields.py  【修改】改为调用 migration_runner 的注册函数
│  └─ tests/
│     ├─ test_migration_runner.py                【新增】
│     ├─ test_auth_modes.py                      【新增】演示/生产两档参数化
│     ├─ test_columns_multi.py                   【新增】
│     ├─ test_orchestrator_parallel.py           【新增】
│     ├─ test_url_indexing.py                    【删除】（C2，KB 等价用例按核查结果补）
│     └─ test_api.py                             【修改】2 个 xfail 转为按模式断言
├─ frontend-nextjs/
│  ├─ package.json                               【修改】dependencies 显式声明 dayjs（版本对齐 antd）
│  ├─ next.config.js（或 prebuild 脚本）          【修改】构建期注入 NEXT_PUBLIC_BUILD_ID/COMMIT/BUILD_TIME
│  ├─ src/
│  │  ├─ build-info.ts                           【新增】构建期生成（或被注入常量模块）
│  │  ├─ services/api.ts                         【修改】ApiError 类 + StreamResult 终态 + version/columns 接口
│  │  ├─ utils/
│  │  │  ├─ format.ts                            【修改】文件头写入"渲染 vs 清洗"判定规则注释
│  │  │  ├─ constants.ts                         【新增】KIND_ZH 单一出口
│  │  │  └─ textSanitizer.ts                     【删除】
│  │  ├─ components/
│  │  │  ├─ AdminLayout.tsx                      【修改】BUILD_ID 常驻显示 + data-build + KIND_ZH 引用
│  │  │  ├─ SchemaForm.tsx                       【修改】date 字段受控（dayjs）+ 多源栏目联动
│  │  │  ├─ RunConfigModal.tsx                   【修改】422 fieldErrors 映射表单
│  │  │  ├─ DashboardMarkdown.tsx                【修改】消除 any
│  │  │  └─ DiffViewer.tsx / ChatPanel.tsx       【修改】时间/Markdown 走统一出口
│  │  └─ views/
│  │     ├─ ClosedLoop.tsx                       【修改】StreamResult 分支 + 409 用 err.runId
│  │     ├─ Jobs/Changes/FileUploadManagement/Sessions/
│  │     │  URLManagement/KnowledgeObjects/AskAI.tsx 【修改】残留清零（B6 清单）
│  │     ├─ AgentSettings 2.tsx                  【删除】（确认无引用后）
│  │     └─ Notifications.tsx                    【修改】expiring Tab + KIND_ZH 引用
│  └─ tests/unit/
│     ├─ setup.ts（或既有 setup）                 【修改】matchMedia/ResizeObserver mock
│     ├─ README.md                               【新增】测试编写约定
│     └─ apiError.test.ts / schemaForm.test.tsx  【新增/修改】
├─ scripts/
│  ├─ browser_smoke.mjs                          【新增】场景运行器（基于 browser_probe.mjs 内核）
│  ├─ browser_scenarios.json                     【新增】场景定义（路由×交互×断言）
│  ├─ verify_all.ps1                             【新增】一键验收编排（UTF-8 BOM）
│  ├─ docs_check.ps1                             【新增】文档/约定一致性校验（UTF-8 BOM）
│  └─ browser_probe.mjs                          【保留】单点诊断用途，冒烟走新运行器
├─ nginx/                                        【修改】text/html 响应 Cache-Control: no-cache（按核查补齐）
├─ AGENTS.md / CLAUDE.md                         【修改】B10 修订 + 新约定（真机判定纪律）
├─ README.md / DEMO_SCRIPT.md / DEPLOY-GUIDE.md  【修改】排查清单 / 演示动线 / 生产 checklist
└─ REFACTOR_PLAN_V2_2.md                         【新增】本文件
```

### 3.2 数据流与调用关系（五条重点链路）

**① 真实浏览器验证链路**

```
scripts/verify_all.ps1
   └─▶ node scripts/browser_smoke.mjs --report out/probe-report.json
         ① 读 browser_scenarios.json（场景数组）
         ② 自动登录：POST /api/admin/login → token → 注入 localStorage{token, admin}
         ③ 启动本机 Edge/Chrome headless + CDP
         ④ 逐场景：goto 路由 → settle(等 hydration)
            → 逐步骤执行：realClick(Input.dispatchMouseEvent) / waitFor / assert
            → 判定口径：弹层 display!=none && rect.w>0 && rect.h>0
            → 采集：console error / 未捕获异常 / 4xx5xx 资源
            → 失败时 Page.captureScreenshot 存证 + DOM 快照片段
         ⑤ 输出 JSON 报告 + 退出码（0 全过 / 1 有 FAIL / 2 运行器自身错误）
断言示例：通知面板打开、采集弹窗+栏目下拉（含计数文案）、配置面板打开与
        「确定并开始」后 run_started 事件出现、时间线条目数随时间增长、
        Notifications 页 Tab 切换后列表 kind 过滤生效、页面 data-build == /api/v1/version.commit
```

**② 版本可见性**

```
构建期：git rev-parse --short HEAD + 时间 → next.config env 注入 / 生成 build-info.ts
运行期：AdminLayout 渲染 BUILD_ID（侧边栏底部）+ <div data-build={BUILD_ID}>
        前端启动 → GET /api/v1/version {version, commit, build_time}
        → commit 不一致 → Header 黄色 Tag「前后端构建不一致，请硬刷新」
探针：场景前置断言 data-build === version.commit（不一致直接 FAIL，分类 STALE_BUNDLE）
缓存：/.next/static/* 长缓存（内容哈希）；text/html → no-cache（nginx 补齐）
```

**③ 结构化错误传播**

```
后端：409 {detail, run_id} / 422 {detail:[{loc,msg}...]}（FastAPI 默认）→ 端点层归一化为
      {detail: [{field, message}]}（config 校验处自定义，其余沿用 FastAPI 格式并做适配）
前端 api.ts：request()/streamClosedLoop 非 2xx → 读 body → throw new ApiError(status, body)
      ApiError.runId（409 时取 body.run_id）
      ApiError.fieldErrors（422 时归一 FastAPI loc→field）
      ApiError.message 保持原字符串（既有 catch 零改动）
调用方：RunConfigModal 按 fieldErrors 标红字段；ClosedLoop 按 runId 提示并跳转回放
终态：streamClosedLoop resolve {run_id, terminal, status, summary}（B5）
```

**④ 多源栏目并集**

```
SchemaForm source_ids onChange → GET /api/v1/sources/columns?source_ids=a,b
  → column_discovery_service.discover_columns_multi：
      逐源复用单源发现（含缓存）→ 按 value 合并 {value, count:Σ, sources:[{source_id,count}]}
  → 返回 {columns:[...], generated_at, cached}
提交：config.column 透传 → 编排器/采集端点对各源分别等值过滤（注释写明语义）
```

**⑤ 迁移自动化**

```
容器/进程启动 → main.py startup
  → migration_runner.run(database.engine)
      PG: pg_advisory_lock(0xC1A0)  → 查 schema_migrations → 逐条执行未应用的注册迁移
          （每条幂等；失败→日志+抛错中止启动；重启安全重试）
      SQLite: 无锁直跑（单进程）
  → 日志 "migrations applied: n, skipped: m"
  → 通过后继续启动调度器与路由服务
手动入口：python backend/scripts/migrate_run_records_and_fields.py → 调同一注册表（不双份实现）
```

### 3.3 新增/移除第三方依赖

- **运行时依赖：零新增、零移除。**（dayjs 为 antd 既有传递依赖的显式声明：node_modules 与镜像体积零变化，消除幽灵依赖风险；如评审否决声明，则 T7 退化为原生 date input 包装。）
- **开发/测试依赖：零新增。**（不引入 Playwright；浏览器验证继续零依赖 CDP。）
- 部署影响评估：`npm ci --omit=dev` 路径、镜像构建、compose 服务集合均不变。

---

## 四、模块拆分与模块职责定义

| 模块 | 职责 | 依赖 | 被依赖 |
|---|---|---|---|
| **browser_smoke（新，独立验证模块）** | 场景化真实浏览器冒烟：自动登录、场景执行、统一判定口径、证据采集（截图/DOM/console/资源）、JSON 报告与退出码 | browser_scenarios.json；本机 Edge/Chrome + CDP | verify_all.ps1、交付验收 |
| **browser_scenarios.json（新，声明层）** | 场景声明：路由、步骤（action/selector/expect）、断言类型白名单 | 无 | browser_smoke |
| **version_visibility（新，跨端小模块）** | 构建期注入 BUILD_ID/COMMIT/TIME；前端展示与 `data-build`；后端 `GET /api/v1/version`；不一致提示 | git（构建期）、config.py | AdminLayout、browser_smoke（STALE_BUNDLE 判定）、探针/用户 |
| **api_error（改，前端 api.ts 内聚模块）** | `ApiError` 类型（status/detail/payload/runId/fieldErrors）与 `StreamResult` 终态归一化 | 无（纯类型+解析） | 全部 api 调用方（默认兼容）、RunConfigModal、ClosedLoop |
| **column_discovery（改）** | 单源发现（既有）+ `discover_columns_multi` 并集合并（计数求和、来源标注、复用单源缓存） | models、适配器 | config_endpoints（新跨源接口）、SchemaForm |
| **migration_runner（新，独立模块）** | 迁移注册表、schema_migrations 记录、PG advisory lock、失败中止、手动脚本同一入口 | database、models | main.py startup、migrate_run_records_and_fields.py |
| **auth_modes（改）** | DEMO_RELAX_AUTH 两档：register bootstrap 限制、require_super_admin 真实校验（生产档） | config.py | auth.py 路由、test_auth_modes |
| **orchestrator_perf（改）** | 日报/洞察 gather 并行 + 共享运营数据快照 | digest_service、insight_generator、radar/monitor | agent_orchestrator |
| **test_conventions（新，文档+setup）** | vitest setup 补齐 jsdom 缺口；tests/unit/README.md 编写约定 | vitest | 全部前端测试 |
| **docs_consistency（新）** | docs_check.ps1 机械化校验 + AGENTS/CLAUDE/README 修订 | Test-Path/grep | verify_all.ps1 |
| **verify_all（新，编排）** | 一键验收编排：pytest → typecheck/test/build → smoke_refactor → browser_smoke → docs_check | 上述全部 | 交付验收（R12） |

---

## 五、完整接口契约规格

> 事件名/字段名/错误码为**冻结契约**，实现阶段不得更改。如需变更先修订本文件。

### 5.1 真实浏览器验证：CLI 契约与结果 JSON

**CLI**：`node scripts/browser_smoke.mjs [--scenario <name|all>] [--base-url http://localhost:3000] [--api-url http://localhost:8000] [--report <path>] [--headed] [--settle 3500]`
前置：栈已起（或 `--api-url` 可达）；登录由运行器自动完成（`POST {api-url}/api/admin/login`，账号从 env `PROBE_USER`/`PROBE_PASS`，缺省 `admin@campus.local`/`campus123456`）。
退出码：`0` 全场景 PASS；`1` 存在 FAIL；`2` 运行器自身错误（浏览器缺失/登录失败/协议错误）。

**场景 JSON（browser_scenarios.json）**：

```jsonc
{
  "version": 1,
  "scenarios": [
    {
      "name": "notification-bell",
      "route": "/overview",
      "steps": [
        {"action": "assert_build_sync"},                                  // data-build == /api/v1/version.commit
        {"action": "real_click", "selector": "[aria-label=\"通知中心\"]"},
        {"action": "assert_overlay", "selector": ".ant-popover",
         "expect": {"visible": true, "min_width": 200, "contains_text": "通知中心"}},
        {"action": "real_click", "selector": "body", "at": {"x": 10, "y": 10}},
        {"action": "assert_overlay", "selector": ".ant-popover", "expect": {"visible": false}}
      ]
    }
  ]
}
```

**断言类型白名单**（实现时不得扩张语义，只可新增类型）：`assert_build_sync` / `assert_overlay`（display≠none 且 rect 宽高>0 且可选 contains_text）/ `assert_text` / `assert_count_grows`（选择器命中数在 timeout 内增加，用于时间线生长）/ `assert_no_console_errors`。

**结果 JSON（--report）**：

```jsonc
{
  "tool": "browser_smoke", "version": 1,
  "base_url": "...", "build_id": "...", "backend_commit": "...",
  "started_at": "<iso>", "duration_ms": 12345,
  "scenarios": [
    {"name": "...", "route": "...", "status": "PASS|FAIL|ERROR",
     "failure_class": "STALE_BUNDLE|INTERACTION|RUNTIME_JS|RESOURCE|ASSERTION|PROBE",
     "steps": [{"action": "...", "selector": "...", "status": "PASS|FAIL",
                "evidence": {"display": "block", "rect": {"w": 364, "h": 811},
                             "screenshot": "out/shots/notification-bell-step2.png"}}],
     "console_errors": ["..."], "failed_resources": ["..."]}
  ],
  "summary": {"total": 5, "pass": 5, "fail": 0, "error": 0}
}
```

**failure_class 分类语义**：`STALE_BUNDLE`=前后端构建不一致；`INTERACTION`=真实鼠标事件未达预期（遮挡/不可点）；`RUNTIME_JS`=console error/未捕获异常；`RESOURCE`=4xx/5xx 资源；`ASSERTION`=其余断言失败；`PROBE`=运行器自身问题（不计入被测系统结论）。

### 5.2 结构化错误类型（前端）

```ts
export class ApiError extends Error {
  readonly status: number;            // HTTP 状态码
  readonly payload: unknown;          // 完整响应体（解析失败为 null）
  readonly detail: unknown;           // body.detail ?? body
  readonly runId?: string;            // status===409 且 body.run_id 存在时
  readonly fieldErrors?: { field: string; message: string }[];
                                      // status===422：兼容 FastAPI {loc,msg} 与自定义 {field,message}
  constructor(status: number, payload: unknown, fallbackMessage: string);
  // this.message 与现行 parseErrorResponse 输出完全一致（兼容既有 catch）
}
export interface StreamResult {
  run_id: string;
  terminal: "run_finished" | "run_error";
  status: "ok" | "partial" | "error";
  summary: string;
}
// streamClosedLoop(config, onEvent): Promise<StreamResult>
//   HTTP 非 2xx → reject ApiError；收到 run_finished/run_error → resolve；
//   流中断 → 回放补齐后按终态 resolve；AbortController → reject DOMException(AbortError)
```

**端点错误码映射（冻结）**：`POST /closed-loop/stream` → 409 `{detail, run_id}`；422 配置校验 `{detail:[{field,message}]}`。`POST /sources/{id}/run` → 409 `{detail, job_id}`。`GET /config-schema/{name}` → 404 `{detail}`。其余端点维持现状（FastAPI 默认 422 由 ApiError 适配层归一）。

### 5.3 版本信息接口/注入契约

- `GET /api/v1/version`（公开、只读、无鉴权、无限流敏感信息）→ `200 {"version": "2.2.0", "commit": "<git short>", "build_time": "<iso>", "environment": "demo|prod"}`。取不到 git 信息时 commit 为 `"unknown"`，不得 500。
- 前端注入：构建期常量 `BUILD_ID`（= commit 或 `"dev"`）、`BUILD_TIME`。`AdminLayout` 侧边栏底部渲染 `版本 {BUILD_ID}`；布局根节点 `<div data-build={BUILD_ID}>`；通知 Popover 容器同挂 `data-build`。
- 不一致提示：前端 `BUILD_ID !== version.commit`（且双方均非 unknown/dev）→ Header 黄色 Tag「构建不一致，请硬刷新」。
- 缓存：`text/html` 响应 `Cache-Control: no-cache`；`/_next/static/` 维持长缓存。

### 5.4 多源栏目接口契约

`GET /api/v1/sources/columns?source_ids=src_a,src_b`（鉴权同 `/sources/{id}/columns`）→

```jsonc
{
  "columns": [
    {"value": "通知公告", "label": "通知公告 (52)", "count": 52,
     "sources": [{"source_id": "src_a", "count": 47}, {"source_id": "src_b", "count": 5}]}
  ],
  "source_ids": ["src_a", "src_b"],
  "generated_at": "<iso>",
  "cached": false
}
```

- `source_ids` 缺省/空串 = 全部 active 源；单一 id 时返回与单源接口同构数据（外加 sources 标注），**单源既有端点行为不变**。
- 错误：`400 {detail:"source_ids 格式错误"}`；不存在的 id 静默忽略（与"留空=全部"容错一致）并记入响应 `ignored_source_ids`。
- 过滤语义（注释冻结）：多源采集携带 column 时对各源分别等值过滤；仅部分源拥有该栏目时其它源筛空为预期行为。

### 5.5 迁移执行器契约

```python
# backend/services/migration_runner.py
MIGRATIONS: list[tuple[str, Callable[[AsyncEngine], Awaitable[None]]]]
  # 注册表：("20260912_run_records_and_fields", fn), ... 名称即执行记录主键，单调追加不得改名/改序
async def run_migrations(engine: AsyncEngine) -> dict:
    # 返回 {"applied": [name...], "skipped": [name...]}
    # PG: BEGIN; SELECT pg_advisory_lock(126112) ... 释放于连接关闭
    # 逐条：schema_migrations 无记录 → 执行 fn → 插记录 → commit；有记录 → skipped
    # 任一 fn 抛错 → 回滚该条、记日志、原样上抛（启动中止）；已应用的不回滚（幂等可重入）
```

- `schema_migrations`：`name String(100) PK`、`applied_at DateTime(tz) server_default`。
- 手动入口：`python backend/scripts/migrate_run_records_and_fields.py` → `asyncio.run(run_migrations(engine))` 打印结果，与 startup 同一注册表。
- 回滚语义：无 down 迁移；additive-only；毁结构走 expand-contract（写进 DEPLOY-GUIDE）。

### 5.6 鉴权开关配置项与角色矩阵

- 配置：`DEMO_RELAX_AUTH: bool = True`（env 覆盖；`config.py` Settings 字段，默认 True=演示）。
- 行为矩阵：

| 操作 | DEMO_RELAX_AUTH=true（默认/演示） | =false（生产） |
|---|---|---|
| 首个管理员注册（bootstrap） | 允许 | 允许 |
| 后续注册 `POST /register` | 允许（普通管理员） | **403 `注册已关闭，请联系管理员创建账号`** |
| 用户管理（增/删/改/角色） | 所有已登录 admin | **仅 super_admin，其余 403** |
| 查看用户列表 | 所有已登录 admin | 仅 super_admin |
| 其余管理端点 | 已登录 admin（不变） | 已登录 admin（不变） |
| 公开问答/检索/MCP | 不变 | 不变 |

---

## 六、分模块开发任务清单

> 按依赖顺序；⇄ 可并行。涉及用户可见行为的任务均注明真机验证方式（T3 完成后一律以 browser_smoke 场景断言为准）。

---

### T1【必须修复】ApiError 结构化错误 + StreamResult 终态归一化（B1+B5/R3） —— 前置：无

- **模块职责**：api_error（§四）。
- **涉及文件**：`frontend-nextjs/src/services/api.ts`、`frontend-nextjs/tests/unit/apiError.test.ts`（新）、`ClosedLoop.tsx`、`RunConfigModal.tsx`。
- **契约**：§5.2 全部。
- **业务逻辑要求**：`ApiError` 实现（message 与现行 parseErrorResponse 逐字符一致）；`request()` 与 `streamClosedLoop` 非 2xx 统一 throw ApiError；422 归一同时支持 FastAPI `{detail:[{loc,msg}]}` 与自定义 `{detail:[{field,message}]}`（loc 取末段为 field）；`streamClosedLoop` 改返 `StreamResult`（流中断→回放补齐→按终态 resolve）；`ClosedLoop.tsx` 用 `terminal` 分支提示、409 catch 用 `err.runId` 提供"查看进行中运行"入口；`RunConfigModal.tsx` 422 → `fieldErrors` 映射 Form 字段错误。
- **输入输出**：见契约。
- **测试要点**：单测构造 409/422/500 Response 断言字段；FastAPI 与自定义两种 422 形状；`.message` 兼容快照；StreamResult 三终态 + 中断回放；既有 191 用例全绿（回归证明）。
- **真机验证**：T3 后由场景"closed-loop-run"覆盖（冲突 409 路径手动 curl 验证 run_id 提示）。

---

### T2【必须修复】版本可见性（A2/R2） —— 前置：无（⇄ T1）

- **模块职责**：version_visibility。
- **涉及文件**：`frontend-nextjs/next.config.js`（或新增 `scripts/gen-build-info.mjs` + prebuild）、`src/build-info.ts`（新）、`src/components/AdminLayout.tsx`、`backend/api/v1/config_endpoints.py`（或新 `version_endpoints.py`）+ `main.py` 挂载、`backend/config.py`、`nginx/`（按核查补 no-cache）、后端 `tests/test_version.py`（新）。
- **契约**：§5.3。
- **业务逻辑要求**：后端 version 从环境变量/`.git`（容器内无 .git 时读构建期写入的 env，取不到返回 unknown 不 500）；前端构建期注入（Docker 构建时 git 不可用 → compose/Dockerfile 传 build-arg，本地 dev 退化为 "dev"）；不一致黄色提示（双方均 known 才比对）；AdminLayout 侧边栏底部 `版本 {BUILD_ID}` + `data-build`。
- **测试要点**：后端单测（200 结构/unknown 兜底）；前端渲染测试（BUILD_ID 渲染、不一致 Tag 出现）。
- **真机验证**：重建镜像硬刷新后页面版本变化；T3 场景 `assert_build_sync` 全路由 PASS。

---

### T3【必须修复】browser_smoke 场景运行器（A1/R1，本轮核心交付） —— 前置：T2（assert_build_sync 依赖）

- **模块职责**：browser_smoke + browser_scenarios.json（§四）。
- **涉及文件**：`scripts/browser_smoke.mjs`（新，复用 `browser_probe.mjs` 的 CDP 内核：启动浏览器、WS 连接、真实鼠标事件、几何采集）、`scripts/browser_scenarios.json`（新）。
- **契约**：§5.1 全部（CLI/场景 JSON/结果 JSON/退出码/failure_class）。
- **业务逻辑要求**：自动登录（api-url 登录 → localStorage 双键注入）；场景数组顺序执行、相互隔离（每场景全新页面 + 新 CDP target）；判定口径写死（display≠none && rect>0）；真实鼠标事件为默认点击方式（合成 click 仅作对照字段记录）；失败时截图（`Page.captureScreenshot`）+ 保存弹层 outerHTML 片段；console error/未捕获异常/4xx5xx 资源逐场景收集；`assert_count_grows` 用于时间线生长（轮询选择器命中数，timeout 内增加即 PASS）。
- **首批五个场景**（写入 scenarios.json）：① notification-bell（§5.1 示例）；② collect-modal（/sources → 打开采集弹窗 → 栏目下拉出现且含 `(n)` 计数文案）；③ closed-loop-config（/closed-loop → 打开配置面板 → 勾选实时采集展开子配置 → 取消关闭）；④ closed-loop-run（确定并开始 → `assert_count_grows` 时间线条目 2 分钟内增长 ≥2 → 出现完成时刻文本）；⑤ notifications-tabs（/notifications → 切换 Tab → 列表 kind 过滤生效）。
- **测试要点**：运行器自测——对已知好页面全 PASS；故意改错选择器得 FAIL 且 evidence 齐全；`--scenario` 过滤生效；退出码三种路径。
- **真机验证**：本任务即真机验证手段本身；验收=`node scripts/browser_smoke.mjs --report out/probe.json` 退出码 0。

---

### T4【必须修复】verify_all 编排 + 用户排查清单（A4/D1/R1·R2 辅助） —— 前置：T3

- **涉及文件**：`scripts/verify_all.ps1`（新，UTF-8 BOM）、`README.md`、`DEMO_SCRIPT.md`。
- **业务逻辑要求**：verify_all 按序执行并打印阶段横幅：后端 pytest（容器或本地，参数化）→ 前端 typecheck/test/build → smoke_refactor.ps1 → browser_smoke（栈可达时）→ docs_check（T12 就绪后接入，未就绪时跳过并提示）；任一阶段非零即停，末尾打印总耗时与结论。README 增「用户端排查清单」（A4 八条原文）；DEMO_SCRIPT 增演示前检查（BUILD_ID、探针全 PASS、硬刷新提醒）。
- **测试要点**：脚本在 PowerShell 5.1 解析无误（BOM）；各阶段失败能正确冒泡退出码。
- **真机验证**：`powershell -File scripts/verify_all.ps1` 全程绿。

---

### T5【必须修复】多源栏目并集（B2/R4） —— 前置：无（⇄ T1–T4，前端联动部分依赖 T1）

- **涉及文件**：`backend/services/column_discovery_service.py`、`backend/api/v1/config_endpoints.py`、`backend/tests/test_columns_multi.py`（新）、`frontend-nextjs/src/services/api.ts`、`src/components/SchemaForm.tsx`（source_ids onChange 联动加载栏目）、`RunConfigModal.tsx`。
- **契约**：§5.4。
- **业务逻辑要求**：`discover_columns_multi` 逐源复用单源发现（吃既有 TTL 缓存）后按 value 合并；`ignored_source_ids`；单源既有端点零改动；前端 source_ids 变化即重拉（防抖 300ms）；栏目 hint 注明"多源时各源分别过滤"。
- **测试要点**：合并/求和/来源标注/空参/忽略未知 id；单源回归（既有 18 用例全绿）；前端联动渲染测试。
- **真机验证**：T3 场景② 扩展断言（多选两源后下拉出现合并计数）。

---

### T6【必须修复】闭环性能并行化（B3/R5） —— 前置：无（⇄）

- **涉及文件**：`backend/services/agent_orchestrator.py`、`digest_service.py`、`insight_generator.py`、`backend/tests/test_orchestrator_parallel.py`（新）。
- **业务逻辑要求**：治理阶段完成后 `asyncio.gather(gen_digest, gen_insight)`（各自 try/except 降级语义不变；决策落库与事件回调在各自协程内按完成时刻发生，回放按 finished_at 排序已兼容乱序到达）；共享运营数据快照（监控/健康/变更统计单次查询构造 dict，传入两个生成器；生成器签名加可选参数 `_snapshot=None`，缺省自查，保持旧调用兼容）；取消检查点不受影响。
- **测试要点**：单测断言两生成器执行区间重叠（记录 start/end 时间戳）；任一生成失败另一照常；快照对象被两生成器复用（查询计数）。
- **真机验证**：真机 `POST /closed-loop/stream`（collect=false，真实 Key）连测两次取中位数写入实现记录；目标 ≤15s，未达标则按 B3-4 口径写明并在面板补提示。

---

### T7【建议优化】date 字段受控回显（B4） —— 前置：无（⇄）

- **涉及文件**：`frontend-nextjs/package.json`（dependencies +dayjs，版本=`npm ls dayjs` 实测）、`src/components/SchemaForm.tsx`、对应渲染测试。
- **业务逻辑要求**：date 类型字段改受控：`value ? dayjs(value) : null` ↔ onChange `d ? d.format("YYYY-MM-DD") : null`；SchemaForm 程序化重置/回填（打开回放配置、默认值）后 DatePicker 正确回显；提交值仍为 ISO 串（后端契约不变）。
- **测试要点**：渲染测试——初始值回显、清空、选择后提交体为 `YYYY-MM-DD`；typecheck。

---

### T8【必须修复】残留清零：时间格式化 + Markdown 判定规则迁移（B6/R6） —— 前置：T1（⇄ T5–T7）

- **涉及文件**（迁移清单冻结）：`Jobs.tsx`、`Changes.tsx`、`DiffViewer.tsx`、`FileUploadManagement.tsx`、`Sessions.tsx`、`URLManagement.tsx`、`KnowledgeObjects.tsx`、`AskAI.tsx`、`ChatPanel.tsx`、`ClosedLoop.tsx`；`AgentSettings 2.tsx`（先 grep 引用：无引用→删除；有引用→合并后删除，结果记入实现记录）；`format.ts` 文件头注释写入判定规则。
- **契约**：§一.B6 判定规则（清洗 vs 渲染 vs 时间唯一出口）。
- **业务逻辑要求**：清单文件全部改走 `formatDateTime/formatTime/displayTitle/stripInlineMd/DashboardMarkdown`；删除本地 fmt/strip 实现；DashboardMarkdown 维持不渲染 raw HTML。
- **测试要点**：每文件至少一条渲染断言（无 `**` 残留 / 时间格式 `YYYY-MM-DD HH:mm:ss`）；`grep -rn "toLocaleString" src/` 为零（纳入 docs_check）。
- **真机验证**：T3 场景①②⑤ 顺带覆盖通知/采集弹窗/通知页；KnowledgeObjects/AskAI 走人工过一遍（写入验收步骤）。

---

### T9【建议优化】死代码与重复工具清理（B7/R7） —— 前置：T8（避免交叉冲突，可同批提交）

- **涉及文件**：删 `src/utils/textSanitizer.ts`；新建 `src/utils/constants.ts`（KIND_ZH）；改 `AdminLayout.tsx`、`Notifications.tsx`、`Sources.tsx`、`DashboardMarkdown.tsx`（消除 `any`）。
- **测试要点**：typecheck 0 错；既有渲染测试全绿；`grep -rn ": any" src/` 仅剩既有豁免清单（写入 tests/unit/README.md）。

---

### T10【建议优化】通知中心收口（B8/R8） —— 前置：T8（⇄ T9）

- **涉及文件**：`Notifications.tsx`（expiring Tab 补齐）、`AdminLayout.tsx`（markRead 前本地已读判断）。
- **测试要点**：Tabs 四项渲染与过滤；已读项点击不发请求（mock 计数）。
- **真机验证**：T3 场景⑤ 覆盖 Tab 切换。

---

### T11【建议优化】前端测试基建与编写约定（B9） —— 前置：无（⇄ 全部）

- **涉及文件**：`frontend-nextjs/tests/unit/setup.ts`（或既有 setup 文件）、`frontend-nextjs/tests/unit/README.md`（新）。
- **业务逻辑要求**：setup 补齐 `matchMedia`、`ResizeObserver` mock；README 写入：portal/Modal 断言用 `within(getByRole("dialog"))`、"两字按钮空格"宽松匹配（`{ name: /重\s*试/` }）、登录态注入、弹层判定口径与真机探针分工（jsdom=回归护栏、browser_smoke=交付判定）、`destroyOnClose` 约定。
- **测试要点**：新增一个 Modal 开合样例测试作为模板；既有 191 用例全绿。

---

### T12【必须修复】文档一致性与机械化校验（B10/D1/R9） —— 前置：T8/T9（grep 规则依赖其清零）

- **涉及文件**：`AGENTS.md`、`CLAUDE.md`、`README.md`（同步修订）、`scripts/docs_check.ps1`（新，UTF-8 BOM）。
- **业务逻辑要求**：AGENTS/CLAUDE 删除失实段落（根 package.json、npm run test:e2e、docs/plans/specs），补充新事实（/closed-loop/stream、browser_smoke、版本可见、DEMO_RELAX_AUTH、测试约定、迁移自动化）；docs_check 校验：文档引用路径存在、`toLocaleString`/`fmtTime` grep 为零、`: any` 不增、scenarios.json 中路由在前端路由表存在。
- **测试要点**：docs_check 全过；人为改坏一处即报错。

---

### T13【必须修复】鉴权开关化 + 遗留测试处置（C1+C2/R10） —— 前置：无（⇄）

- **涉及文件**：`backend/config.py`、`backend/api/endpoints/auth.py`、`backend/tests/test_auth_modes.py`（新）、`backend/tests/test_api.py`（2 个 xfail 改造）、`backend/tests/test_url_indexing.py`（删除）、KB 管道等价用例（按核查补 `backend/tests/test_kb_document_pipeline.py`）、`DEPLOY-GUIDE.md`。
- **契约**：§5.6。
- **业务逻辑要求**：开关两档行为按矩阵实现；生产档 403 文案冻结（§5.6）；xfail 移除改为按模式断言（monkeypatch settings + 依赖覆盖重挂）；C2 删除文件并在提交信息注明等价覆盖位置（或补齐 2 用例后删除）。
- **测试要点**：两档参数化全绿；全量 pytest 绿（skipped 数变化写入实现记录）。
- **真机验证**：smoke_refactor.ps1 全绿（默认演示档行为不变）。

---

### T14【必须修复】迁移自动化 + 生产发布 checklist（C3+C4/R11） —— 前置：无（⇄ T13）

- **涉及文件**：`backend/services/migration_runner.py`（新）、`backend/main.py`（startup 调用，调度器之前）、`backend/scripts/migrate_run_records_and_fields.py`（改为调注册表）、`backend/tests/test_migration_runner.py`（新）、`DEPLOY-GUIDE.md`（升级/新部署两路径 + §一.C4 checklist 全文）。
- **契约**：§5.5。
- **测试要点**：空库两遍（第二遍全 skipped）；预插部分记录模拟升级库；失败迁移上抛且重跑可续；SQLite 分支跑通；advisory lock 常量固定。
- **真机验证**：`docker compose up -d --build backend` 启动日志出现 `migrations applied: n`；重启容器日志 `applied: 0`；既有库升级实测一次（备份后执行）。

---

### T15【必须修复】全基线回归 + 实现记录回写（R12） —— 前置：T1–T14

- **业务逻辑要求**：`scripts/verify_all.ps1` 全程绿；`REFACTOR_PLAN_V2_2.md` 回写「七、实现记录」（任务对账/契约偏差/性能复测中位数/未做项）；smoke_refactor.ps1 如有新端点（version/columns）按既有风格补断言（保持 32→N/N）。
- **真机验证**：verify_all 退出码 0；probe-report.json 全 PASS；版本可见三连（页面 BUILD_ID、/api/v1/version、git tag 一致）。

---

### 任务依赖与并行图

```
T1,T2,T6,T7,T11,T13,T14 可立即并行
T2 ──▶ T3 ──▶ T4
T1 ──▶ T8 ──▶ T9,T10        T5 与 T1–T4 并行（前端联动依赖 T1）
T8,T9,T12(依赖 T8/T9 清零结果) 
全部 ──▶ T15
```

---

### 验收清单（R1–R12 逐条）

| 需求 | 验证命令 / 操作 |
|---|---|
| R1 真实浏览器回归 | `node scripts/browser_smoke.mjs --report out/probe.json` 退出码 0；报告含 5 场景 PASS 与截图证据；故意改错一选择器复跑得 FAIL 且 failure_class/evidence 正确。 |
| R2 版本可见 | 重建镜像 → 硬刷新 → 页面左下 BUILD_ID == `git rev-parse --short HEAD`；`curl localhost:8000/api/v1/version` 同 commit；不硬刷新的旧标签页出现"构建不一致"提示（或按排查清单操作后一致）；`curl -I` 首页 HTML 含 `Cache-Control: no-cache`。 |
| R3 结构化错误 | 前端单测全绿；手动：`curl -X POST /closed-loop/stream` 连发两次，第二次 409 体含 run_id；面板提交非法配置得 422 且字段级标红；`run_error` 场景（断 Key 且强制非降级路径模拟）前端显示失败而非"完成"。 |
| R4 多源栏目 | pytest test_columns_multi；配置面板多选两源后栏目下拉显示合并计数与来源；单源行为回归（既有用例 + 场景②）。 |
| R5 闭环性能 | 真机 `POST /closed-loop/stream`（collect=false）两次中位数 ≤15s 写入实现记录；未达标则实现记录写明口径（P50/依赖 LLM/Mock ≤5s）且面板有说明。 |
| R6 残留清零 | `grep -rn "toLocaleString\|fmtTime" frontend-nextjs/src/` 输出为空；B6 清单文件渲染测试全绿；KnowledgeObjects/AskAI 人工过一遍无 `**` 残留。 |
| R7 死代码 | textSanitizer.ts 不存在；KIND_ZH 单出口；`npm run typecheck` 0 错；`: any` grep 结果 == 豁免清单。 |
| R8 通知收口 | Tabs 四项切换过滤正确；已读项点击无重复请求（测试 mock 计数）；多标签页结论已写入实现记录。 |
| R9 文档一致 | `powershell -File scripts/docs_check.ps1` 退出码 0；AGENTS/CLAUDE 失实段落已删。 |
| R10 鉴权与遗留测试 | `DEMO_RELAX_AUTH=false pytest tests/test_auth_modes.py` 全绿（403 断言）；`=true` 全绿；test_url_indexing.py 已删且等价覆盖位置在提交信息注明；全量 pytest 绿。 |
| R11 迁移与发布 | 容器重启日志 `migrations applied: 0, skipped: n`；既有库升级实测成功；DEPLOY-GUIDE checklist 可逐项勾选执行。 |
| R12 基线不回归 | `powershell -File scripts/verify_all.ps1` 退出码 0（pytest / typecheck / test / build / smoke N/N / browser_smoke / docs_check 全绿）。 |

---

> 方案完。实现阶段以「第五章契约」为冻结标准；契约变更必须先修订本文件。执行顺序按第六章依赖图，T3（浏览器场景运行器）是本轮第一优先级交付。

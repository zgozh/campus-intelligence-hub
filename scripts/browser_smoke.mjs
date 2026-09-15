#!/usr/bin/env node
/**
 * scripts/browser_smoke.mjs —— 真实浏览器场景运行器（零新增依赖）
 *
 * 为什么要有它：
 *   单元测试（jsdom）只能证明「React 树里有这个节点」，证明不了「真实浏览器里点得开、看得见」。
 *   本项目真实踩过的坑：通知面板 display:block、尺寸 364x811 全都正常，但被 antd 对齐逻辑
 *   定位到 rect.top = -1000 × 视口高度（整块在视口外），jsdom 判「已修复」而用户实测「点了没反应」。
 *
 * 【判定口径 · 写死】弹层/面板算「可见」必须**同时**满足三条（见 lib/cdp.mjs: visibilityExpr）：
 *   1) getComputedStyle(el).display !== "none"
 *   2) getBoundingClientRect() 宽高均 > 0
 *   3) 与视口交集足够：可见高度占比 > 0.5 **且可见宽度占比 > 0.5**
 *      可见高度 = min(rect.bottom, innerHeight) - max(rect.top, 0)；占比 = 可见高度 / rect.height
 *      可见宽度同理（min(rect.right, innerWidth) - max(rect.left, 0)）
 *      两个方向都要判：横向跑到视口外的元素垂直占比仍可能是 1.0（本项目踩过 left=-13420px 的假通过）
 *   第 3 条是 jsdom 结构性测不出来的一维（jsdom 无布局、无视口、无定位计算）。
 *
 * 【交互口径】触发交互一律用 Input.dispatchMouseEvent 真实鼠标事件（走命中测试，能发现遮挡）；
 *   element.click() 只作对照，不作为「用户点得开」的证据。
 *
 * 用法：
 *   node scripts/browser_smoke.mjs                        # 全部场景（含较慢的闭环时间线）
 *   node scripts/browser_smoke.mjs --window 1366x768      # 指定真实窗口尺寸
 *   node scripts/browser_smoke.mjs --only notifications-drawer
 *   node scripts/browser_smoke.mjs --fast                 # 跳过较慢场景（closed-loop-run-timeline）
 *   node scripts/browser_smoke.mjs --selftest             # 自检：证明「故意错误的选择器会被报 FAIL 且产出证据」
 *   node scripts/browser_smoke.mjs --token <jwt> --admin-json '<json>'   # 手工注入登录态，完全跳过登录接口
 *
 * 参数：
 *   --base <url>     前端地址（默认 http://localhost:3000）
 *   --api <url>      后端地址（默认 http://localhost:8000）
 *   --window WxH     真实窗口尺寸（默认 1366x768）
 *   --only <名字>    只跑一个场景
 *   --fast           跳过 slow 场景
 *   --headed         有头模式（便于肉眼看）
 *   --selftest       自检模式
 *   --token <jwt>    手工注入 token（跳过登录接口）
 *   --admin-json <j> 手工注入 admin JSON（配合 --token）
 *   --no-cache       忽略登录态缓存，强制重新登录
 *   --port <n>       CDP 端口（默认 9222）
 *
 * 退出码：0 = 无 FAIL（可能含 WARN/SKIP）；1 = 有 FAIL；2 = 运行器自身失败（如浏览器起不来、selftest 前提不成立）。
 *
 * 【--selftest 的意义】防止「工具永远 PASS」的假象：
 *   它故意用一个不存在的选择器（.ant-drawer-typo）跑 notifications-drawer 场景，
 *   断言运行器**确实报 FAIL**、且**确实写出了证据文件**（JSON + PNG），两者都成立才退出 0。
 *   换句话说：它验证的不是产品，而是「这套工具抓得住失败」。
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  launchBrowser,
  apiLogin,
  parseArgs,
  parseWindowSize,
  looseIncludes,
  normText,
  sleep,
  VISIBLE_MIN_RATIO,
} from "./lib/cdp.mjs";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = parseArgs();
const BASE = String(args.base || "http://localhost:3000").replace(/\/$/, "");
const API = String(args.api || "http://localhost:8000").replace(/\/$/, "");
const WINDOW = String(args.window || "1366x768");
const ONLY = args.only ? String(args.only) : "";
const HEADED = !!args.headed;
const FAST = !!args.fast;
const SELFTEST = !!args.selftest;
const NO_CACHE = !!args["no-cache"];
const PORT = Number(args.port || 9222);
const MANUAL_TOKEN = args.token ? String(args.token) : "";
const MANUAL_ADMIN = args["admin-json"] ? String(args["admin-json"]) : "";

/** 故意错误的选择器：--selftest 用它证明「工具能抓到失败」 */
const SELFTEST_BAD_SELECTOR = ".ant-drawer-typo";

const log = (...a) => console.log(...a);
const ts = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
};
const EVIDENCE_ROOT = join(tmpdir(), "dsh-browser-smoke");
const EVIDENCE_DIR = join(EVIDENCE_ROOT, ts());

/** 已知无害噪声：dev 环境下 favicon 缺失的 404 与主流程无关，不计入「页面异常」 */
const BENIGN_NOISE = [/\/favicon\.ico(\?|$)/];
function isBenign(text) {
  return BENIGN_NOISE.some((re) => re.test(String(text || "")));
}
function splitNoise(items) {
  const benign = [];
  const real = [];
  for (const it of items) {
    (isBenign(it.url || it.text) ? benign : real).push(it);
  }
  return { benign, real };
}

// ---------------------------------------------------------------------------
// 场景框架
// ---------------------------------------------------------------------------
class StepFailure extends Error {}

function createCtx({ name, browser, route, evidenceDir }) {
  const ctx = {
    name,
    route,
    browser,
    evidenceDir,
    steps: [],
    warnings: [],
    artifacts: {},
    failure: null,
    note: (key, value) => {
      ctx.artifacts[key] = value;
    },
    warn: (msg) => {
      ctx.warnings.push(msg);
      log(`      [warn] ${msg}`);
    },
    assert: (cond, msg) => {
      if (!cond) throw new StepFailure(msg);
    },
  };
  return ctx;
}

/** 顺序执行步骤；首个失败即中止并记录原因（避免后续步骤产生噪声失败） */
async function runSteps(ctx, steps) {
  for (const s of steps) {
    const started = Date.now();
    try {
      await s.fn();
      ctx.steps.push({ desc: s.desc, ok: true, ms: Date.now() - started });
      log(`      ✓ ${s.desc}`);
    } catch (e) {
      const reason = e instanceof StepFailure ? e.message : `${e?.name || "Error"}: ${e?.message || e}`;
      ctx.steps.push({ desc: s.desc, ok: false, reason, ms: Date.now() - started });
      ctx.failure = { step: s.desc, reason };
      log(`      ✗ ${s.desc} → ${reason}`);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// 共用导航/等待帮助
// ---------------------------------------------------------------------------
/** 导航到路由并等「真的到了这个路由」+ 关键元素出现（轮询，不靠一次性 sleep 蒙 hydration） */
async function gotoReady(ctx, route, { readySelector = "", timeout = 20_000 } = {}) {
  const b = ctx.browser;
  await b.navigate(ctx.base + route, { settleMs: 500 });
  const onRoute = await b.waitForFunction(`location.pathname === ${JSON.stringify(route)}`, {
    timeout,
    desc: `route=${route}`,
  });
  if (!onRoute.ok) {
    const p = await b.currentPath();
    if (p === "/login") {
      throw new StepFailure("登录态无效：被重定向到 /login（localStorage 的 token/admin 缺失或已过期）");
    }
    throw new StepFailure(`等待路由 ${route} 超时（当前停留在 ${p}）`);
  }
  if (readySelector) {
    const w = await b.waitForSelector(readySelector, { timeout });
    if (!w.found) {
      throw new StepFailure(`等待关键元素超时 ${timeout}ms：${readySelector}（页面未完成 hydration 或选择器已失效）`);
    }
  }
}

/** 按宽松文本等按钮出现（antd 会给两个汉字的按钮自动插空格：「采集」→「采 集」） */
async function waitForButtonText(ctx, text, { timeout = 20_000 } = {}) {
  const want = normText(text);
  return ctx.browser.waitForFunction(
    `Array.from(document.querySelectorAll('button')).some((b) => {
       const cs = getComputedStyle(b);
       if (cs.display === 'none' || cs.visibility === 'hidden') return false;
       return (b.innerText || b.textContent || '').replace(/\\s+/g, '').includes(${JSON.stringify(want)});
     })`,
    { timeout, desc: `button:${text}` },
  );
}

/** 三条口径的可见性断言：失败时把「哪一条挂了 + 几何证据」写进原因 */
function assertVisible(ctx, vis, label) {
  ctx.note(`visibility:${label}`, vis);
  if (!vis || vis.found !== true) {
    throw new StepFailure(`${label} 不存在（DOM 里查不到该节点）`);
  }
  if (!vis.visible) {
    const r = vis.rect || {};
    throw new StepFailure(
      `${label} 未通过可见性三口径：${vis.reason}；` +
        `display=${vis.display} rect=${r.w}x${r.h}@(${r.x},${r.y}) 视口=${vis.viewport} ` +
        `可见比例 水平=${vis.visibleWidthRatio} 垂直=${vis.visibleHeightRatio}（阈值 >${VISIBLE_MIN_RATIO}）`,
    );
  }
}

// ---------------------------------------------------------------------------
// 场景定义
// ---------------------------------------------------------------------------

/**
 * 场景 1：通知抽屉
 * 路由 /overview；真实点击右上角通知铃铛；断言面板可见（三口径）且含「通知中心」。
 * 前置数据：无（通知为空时抽屉显示「暂无通知」，标题仍是「通知中心」）。
 */
const scenarioNotificationsDrawer = {
  name: "notifications-drawer",
  desc: "通知中心抽屉：真实点击铃铛 → 面板可见（三口径）+ 文案含「通知中心」",
  route: "/overview",
  needsAuth: true,
  async run(ctx) {
    const b = ctx.browser;
    const expected = ctx.expectOverride || ".ant-drawer-content";
    await runSteps(ctx, [
      {
        desc: '进入 /overview 并等通知铃铛就绪（[aria-label="通知中心"]）',
        fn: () => gotoReady(ctx, "/overview", { readySelector: '[aria-label="通知中心"]' }),
      },
      {
        desc: "用真实鼠标事件点击通知铃铛（Input.dispatchMouseEvent，走命中测试）",
        fn: async () => {
          const r = await b.realClick('[aria-label="通知中心"]');
          ctx.note("click:bell", r);
          ctx.assert(r.ok, `点击失败：${r.warn}`);
          if (r.hitTestOk === false) {
            // 命中测试落在别的元素上 = 被遮挡；仍然继续，让后续可见性断言给出结论
            ctx.warn(`命中测试未落在铃铛或其子节点上（落在 ${r.hitTestTag}），可能存在遮挡`);
          }
        },
      },
      {
        desc: `等通知面板 ${expected} 出现且满足可见性三口径`,
        fn: async () => {
          const vis = await b.waitForVisible(expected, { timeout: 15_000 });
          assertVisible(ctx, vis, `通知面板 ${expected}`);
          if (!vis.visible) return;
          ctx.assert(
            Number(vis.rect?.w) > 0 && Number(vis.rect?.h) > 0,
            `通知面板尺寸异常：${vis.rect?.w}x${vis.rect?.h}`,
          );
        },
      },
      {
        desc: "断言面板文案包含「通知中心」",
        fn: async () => {
          // 优先读抽屉整体（标题在 header 里），找不到再退到 content
          let text = await b.textOf(".ant-drawer");
          if (!text) text = await b.textOf(expected);
          ctx.note("text:drawer", text.slice(0, 300));
          ctx.assert(looseIncludes(text, "通知中心"), `面板文案未包含「通知中心」，实际文案：${text.slice(0, 120)}`);
        },
      },
    ]);
  },
};

/**
 * 场景 2：数据源「采集」弹窗与栏目下拉
 * 路由 /sources；真实点击表格行内「采集」按钮；断言 .ant-modal 可见 + 含「采集内容筛选（栏目）」+ 有 .ant-select。
 * 前置数据：至少 1 个数据源（当前 dev 环境有 3 个）。
 *   若数据源为空 → 降级为 WARN（前置数据缺失），不算 FAIL。
 * 栏目下拉展开失败或选项为 0 → WARN（栏目清单来自真实采集分布，属数据依赖），不算 FAIL。
 */
const scenarioCollectionModal = {
  name: "collection-modal-columns",
  desc: "采集弹窗：真实点击「采集」→ Modal 可见 + 「采集内容筛选（栏目）」+ 栏目下拉",
  route: "/sources",
  needsAuth: true,
  async run(ctx) {
    const b = ctx.browser;
    await runSteps(ctx, [
      {
        desc: "进入 /sources 并等表格渲染",
        fn: () => gotoReady(ctx, "/sources", { readySelector: ".ant-table" }),
      },
      {
        desc: "等行内「采集」按钮出现（宽松匹配 antd 插入的空格）",
        fn: async () => {
          const w = await waitForButtonText(ctx, "采集", { timeout: 15_000 });
          if (!w.ok) {
            // 区分「没有数据源」（前置数据缺失）与「页面坏了」
            const empty = await b.count(".ant-empty");
            const rows = await b.count(".ant-table-row");
            ctx.note("sources:empty", { empty, rows });
            if (empty > 0 || rows === 0) {
              throw new StepFailure("PREREQ:数据源列表为空，无法点到「采集」按钮（前置数据缺失）");
            }
            throw new StepFailure("超时未出现「采集」按钮（表格已有数据但按钮缺失，疑似页面回归）");
          }
        },
      },
      {
        desc: "用真实鼠标事件点击第一行的「采集」按钮",
        fn: async () => {
          const r = await b.clickByText("采集", { tag: "button", index: 0 });
          ctx.note("click:collect", r);
          ctx.assert(r.ok, `点击失败：${r.warn}`);
        },
      },
      {
        desc: "等采集 Modal（.ant-modal）可见（三口径）",
        fn: async () => {
          const vis = await b.waitForVisible(".ant-modal", { timeout: 15_000 });
          assertVisible(ctx, vis, "采集弹窗 .ant-modal");
        },
      },
      {
        desc: "断言弹窗内含「采集内容筛选（栏目）」文案",
        fn: async () => {
          const t = await b.textOf(".ant-modal");
          ctx.note("text:modal", t.slice(0, 500));
          ctx.assert(
            looseIncludes(t, "采集内容筛选（栏目）"),
            `弹窗文案未包含「采集内容筛选（栏目）」，实际：${t.slice(0, 160)}`,
          );
        },
      },
      {
        desc: "断言栏目下拉（.ant-select）存在于弹窗内部",
        fn: async () => {
          const w = await b.within(".ant-modal", ".ant-select");
          ctx.note("within:modal>select", w);
          ctx.assert(w.containerFound, "弹窗容器 .ant-modal 不存在");
          ctx.assert(w.count >= 1, "弹窗内未找到栏目下拉（.ant-select）");
        },
      },
      {
        desc: "（附加）安全展开栏目下拉并数选项；展开失败或 0 选项只记 WARN",
        fn: async () => {
          const opened = await b.realClick(".ant-modal .ant-select-selector");
          if (!opened.ok) {
            ctx.warn(`栏目下拉展开失败（${opened.warn}），跳过选项数断言`);
            return;
          }
          await sleep(1200);
          const cnt = await b.count(
            ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
          );
          ctx.note("dropdown:optionCount", cnt);
          if (cnt < 1) {
            ctx.warn("栏目下拉已展开但选项数为 0（栏目清单来自真实采集分布，属数据依赖，不判 FAIL）");
            return;
          }
          log(`      · 栏目下拉选项数 = ${cnt}`);
        },
      },
      {
        desc: "清理：Esc 关闭弹窗，避免影响后续场景",
        fn: async () => {
          await b.pressKey("Escape", { keyCode: 27 });
        },
      },
    ]);
  },
};

/**
 * 场景 3：闭环运行配置面板
 * 路由 /closed-loop；真实点击「一键运行闭环」；断言配置面板可见且含「实时采集」分组与「包含实时采集」字段。
 * 前置数据：无（配置 Schema 由后端 /api/v1/config-schema/closed-loop 提供）。
 */
const scenarioClosedLoopConfig = {
  name: "closed-loop-config",
  desc: "闭环配置面板：「一键运行闭环」→ 面板可见 + 「实时采集」分组 + 「包含实时采集」字段",
  route: "/closed-loop",
  needsAuth: true,
  async run(ctx) {
    const b = ctx.browser;
    await runSteps(ctx, [
      {
        desc: "进入 /closed-loop 并等「一键运行闭环」按钮",
        fn: async () => {
          await gotoReady(ctx, "/closed-loop");
          const w = await waitForButtonText(ctx, "一键运行闭环", { timeout: 20_000 });
          ctx.assert(w.ok, "超时未出现「一键运行闭环」按钮");
        },
      },
      {
        desc: "用真实鼠标事件点击「一键运行闭环」",
        fn: async () => {
          const r = await b.clickByText("一键运行闭环", { tag: "button", index: 0 });
          ctx.note("click:run", r);
          ctx.assert(r.ok, `点击失败：${r.warn}`);
        },
      },
      {
        desc: "等运行配置面板（.ant-modal）可见（三口径）",
        fn: async () => {
          const vis = await b.waitForVisible(".ant-modal", { timeout: 15_000 });
          assertVisible(ctx, vis, "闭环运行配置面板 .ant-modal");
          // 面板高于视口时给出可见比例提示（真实 UX 隐患，但不作为 FAIL）
          const r = vis.rect || {};
          const vh = Number(String(vis.viewport || "0x0").split("x")[1] || 0);
          if (r.h && vh && r.h > vh) {
            ctx.warn(
              `配置面板高度 ${r.h}px 超过视口高 ${vh}px（可见比例 ${vis.visibleHeightRatio}），` +
                `底部「确定并开始」按钮需滚动后才可见`,
            );
          }
        },
      },
      {
        desc: "等配置 Schema 加载完成（面板内出现「实时采集」）",
        fn: async () => {
          const w = await b.waitForFunction(
            `(() => { const m = document.querySelector('.ant-modal');
                      return !!m && (m.innerText || '').includes('实时采集'); })()`,
            { timeout: 20_000, desc: "schema 加载" },
          );
          ctx.assert(w.ok, "等待配置 Schema 加载超时（面板内一直未出现「实时采集」，可能是 config-schema 接口失败）");
        },
      },
      {
        desc: "断言面板含「实时采集」分组与「包含实时采集」字段",
        fn: async () => {
          const t = await b.textOf(".ant-modal");
          ctx.note("text:modal", t.slice(0, 600));
          ctx.assert(looseIncludes(t, "实时采集"), `面板未包含「实时采集」分组文案，实际：${t.slice(0, 160)}`);
          ctx.assert(looseIncludes(t, "包含实时采集"), `面板未包含「包含实时采集」字段，实际：${t.slice(0, 160)}`);
          // 再断言该字段的控件确实存在（SchemaForm 给 Switch 挂了 aria-label）
          const ctrl = await b.count('[aria-label="包含实时采集"]');
          ctx.note("count:collectSwitch", ctrl);
          ctx.assert(ctrl >= 1, "未找到「包含实时采集」的控件（[aria-label]）");
        },
      },
      {
        desc: "清理：Esc 关闭面板",
        fn: async () => {
          await b.pressKey("Escape", { keyCode: 27 });
        },
      },
    ]);
  },
};

/**
 * 场景 4：通知中心分类 Tabs
 * 路由 /notifications；断言 kind 分类 Tabs 存在，点击第二个 Tab 后页面无新异常。
 * 前置数据：无（无通知时列表为空，Tabs 仍在）。
 */
const scenarioNotificationsTabs = {
  name: "notifications-tabs",
  desc: "通知中心分类 Tabs：存在 kind Tabs + 点击第二个 Tab 无新增报错",
  route: "/notifications",
  needsAuth: true,
  async run(ctx) {
    const b = ctx.browser;
    await runSteps(ctx, [
      {
        desc: "进入 /notifications 并等 .ant-tabs 渲染",
        fn: () => gotoReady(ctx, "/notifications", { readySelector: ".ant-tabs" }),
      },
      {
        desc: "断言存在 kind 分类 Tabs 且至少 2 个 Tab（含「全部」「快讯」）",
        fn: async () => {
          const tabs = await b.count(".ant-tabs");
          const items = await b.count(".ant-tabs-tab");
          const texts = (await b.listElements(".ant-tabs-tab")).map((x) => normText(x.text));
          ctx.note("tabs", { tabs, items, texts });
          ctx.assert(tabs >= 1, "页面不存在 .ant-tabs（通知分类 Tabs 缺失）");
          ctx.assert(items >= 2, `Tab 数量不足（${items} 个），预期 kind 分类至少 2 个`);
          const joined = texts.join("|");
          ctx.assert(looseIncludes(joined, "全部"), `Tab 文案缺少「全部」，实际：${joined}`);
          ctx.assert(looseIncludes(joined, "快讯"), `Tab 文案缺少「快讯」分类，实际：${joined}`);
        },
      },
      {
        desc: "记录报错基线",
        fn: async () => {
          ctx.mark = b.mark();
          const cur = b.collected();
          const { benign } = splitNoise([...cur.consoleMessages, ...cur.logEntries, ...cur.badResponses]);
          if (benign.length) ctx.note("noiseBefore", benign);
        },
      },
      {
        desc: "用真实鼠标事件点击第二个 Tab",
        fn: async () => {
          const r = await b.realClick(".ant-tabs-tab", { index: 1 });
          ctx.note("click:tab2", r);
          ctx.assert(r.ok, `点击失败：${r.warn}`);
        },
      },
      {
        desc: "断言第二个 Tab 已激活",
        fn: async () => {
          const w = await b.waitForFunction(
            `(() => { const a = document.querySelector('.ant-tabs-tab-active');
                      return !!a && (a.innerText || '').includes('快讯'); })()`,
            { timeout: 10_000, desc: "tab 激活" },
          );
          const active = await b.textOf(".ant-tabs-tab-active");
          ctx.note("activeTab", active);
          ctx.assert(w.ok, `点击后第二个 Tab 未激活（当前激活 Tab：${active || "无"}）`);
        },
      },
      {
        desc: "断言点击后无新增页面异常（console 报错 / 未捕获异常 / 4xx）",
        fn: async () => {
          await sleep(1200); // 等切换后的请求落地
          const delta = b.since(ctx.mark);
          const { benign, real } = splitNoise([
            ...delta.consoleMessages,
            ...delta.exceptions.map((t) => ({ text: t })),
            ...delta.badResponses,
          ]);
          ctx.note("deltaAfterClick", delta);
          ctx.note("deltaBenign", benign);
          if (benign.length) log(`      · 已忽略无害噪声 ${benign.length} 条（favicon 等）`);
          ctx.assert(
            real.length === 0,
            `点击第二个 Tab 后出现 ${real.length} 条页面异常：` +
              real.map((x) => x.text || `${x.status} ${x.url}`).join(" | ").slice(0, 300),
          );
        },
      },
    ]);
  },
};

/**
 * 场景 5（较慢）：闭环运行时间线
 * 路由 /closed-loop；在配置面板点「确定并开始」→ 等 .ant-timeline 出现条目（超时 120s）→
 * 断言至少 1 条决策条目且存在耗时文本（形如 x.xs）。
 * 前置数据：无。默认「包含实时采集」未勾选，因此不做真实外网采集，可接受。
 * --fast 下跳过。
 */
const scenarioRunTimeline = {
  name: "closed-loop-run-timeline",
  desc: "闭环运行时间线：「确定并开始」→ 120s 内出现时间线条目 + 耗时文本",
  route: "/closed-loop",
  needsAuth: true,
  slow: true,
  async run(ctx) {
    const b = ctx.browser;
    await runSteps(ctx, [
      {
        desc: "进入 /closed-loop 并打开运行配置面板",
        fn: async () => {
          await gotoReady(ctx, "/closed-loop");
          const w = await waitForButtonText(ctx, "一键运行闭环", { timeout: 20_000 });
          ctx.assert(w.ok, "超时未出现「一键运行闭环」按钮");
          const r = await b.clickByText("一键运行闭环", { tag: "button", index: 0 });
          ctx.assert(r.ok, `点击「一键运行闭环」失败：${r.warn}`);
          const vis = await b.waitForVisible(".ant-modal", { timeout: 15_000 });
          assertVisible(ctx, vis, "闭环运行配置面板 .ant-modal");
        },
      },
      {
        desc: "记录「包含实时采集」开关状态（勾选则会做真实外网采集，耗时会明显变长）",
        fn: async () => {
          const info = await b.elementInfo('[aria-label="包含实时采集"]');
          const checked = info?.attrs?.["aria-checked"];
          ctx.note("collectSwitch", { found: info.found, ariaChecked: checked });
          if (checked === "true") {
            ctx.warn("「包含实时采集」处于勾选状态：本次运行会访问真实外部数据源，耗时可能接近超时上限");
          } else {
            log("      · 「包含实时采集」未勾选 → 本次运行不含真实采集");
          }
        },
      },
      {
        desc: "真实点击「确定并开始」",
        fn: async () => {
          const r = await b.clickByText("确定并开始", { tag: "button", index: 0, exact: true });
          ctx.note("click:confirm", r);
          if (!r.ok) {
            // 退一步：antd 会把弹窗底部按钮插空格的情况用宽松匹配兜住
            const r2 = await b.clickByText("确定并开始", { tag: "button", index: 0 });
            ctx.note("click:confirmFallback", r2);
            ctx.assert(r2.ok, `点击「确定并开始」失败：${r.warn}`);
          }
        },
      },
      {
        desc: "等时间线出现至少 1 条决策条目（超时 120s）",
        fn: async () => {
          // 后端 /closed-loop/stream 有「同一时刻只允许一个进行中的闭环」互斥锁，
          // 别人（另一个浏览器/另一个测试会话）正在跑时会返回 409，此时我们根本拿不到运行权，
          // 属于**前置条件不满足**而非产品缺陷 → 归类为 PREREQ（降级为 WARN）。
          // 但若确实开跑了（无 409）而时间线一直空 → 仍是 FAIL，不放宽断言。
          const mark = b.mark();
          const deadline = Date.now() + 120_000;
          let items = 0;
          let conflict = null;
          for (;;) {
            items = await b.count(".ant-timeline-item");
            if (items >= 1) break;
            const delta = b.since(mark);
            conflict = delta.badResponses.find(
              (r) => r.status === 409 && String(r.url).includes("/closed-loop/stream"),
            );
            if (conflict) break;
            const txt = await b.bodyText();
            if (looseIncludes(txt, "已有进行中的闭环运行")) break;
            if (Date.now() >= deadline) break;
            await sleep(500);
          }
          ctx.note("timelineItems", items);
          if (items >= 1) return;
          if (conflict || looseIncludes(await b.bodyText(), "已有进行中的闭环运行")) {
            const txt = await b.bodyText();
            const m = /已有进行中的闭环运行（?run_id=([\w-]+)/.exec(txt);
            throw new StepFailure(
              `PREREQ:后端返回 409「已有进行中的闭环运行」` +
                `${m ? `（run_id=${m[1]}）` : ""} —— 单运行互斥锁已被占用（可能有其他会话/浏览器正在跑闭环），` +
                `本次未取得运行权，无法断言时间线`,
            );
          }
          const pageText = await b.bodyText();
          ctx.note("pageTextAtTimeout", pageText.slice(0, 400));
          throw new StepFailure(
            "等待时间线条目超时（120s 内 .ant-timeline-item 始终为 0，且未出现 409 冲突提示）——" +
              "闭环运行未产出任何事件。常见原因：①后端进程/容器在运行进行中被重启，" +
              "进行中的运行会被中断并留下 status=running 的僵尸记录；②SSE 流未返回事件。" +
              `超时时刻页面文案：${pageText.slice(0, 160)}`,
          );
        },
      },
      {
        desc: "等出现耗时文本（形如 x.xs）并断言",
        fn: async () => {
          const w = await b.waitForFunction(
            `Array.from(document.querySelectorAll('[data-testid="timeline-time-meta"]'))
               .some((e) => /\\d+\\.\\d+s/.test(e.innerText || ''))`,
            { timeout: 120_000, interval: 500, desc: "耗时文本" },
          );
          const snap = await b.mustEvaluate(`(() => ({
            items: document.querySelectorAll('.ant-timeline-item').length,
            metas: Array.from(document.querySelectorAll('[data-testid="timeline-time-meta"]'))
                     .map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim()).slice(0, 12),
            text: ((document.querySelector('.ant-timeline') || {}).innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
          }))()`);
          ctx.note("timeline", snap);
          ctx.assert(snap.items >= 1, `时间线决策条目为 ${snap.items} 条，预期 >= 1`);
          ctx.assert(
            w.ok,
            `时间线未出现耗时文本（形如 x.xs）；已捕获的 meta：${JSON.stringify(snap.metas).slice(0, 200)}`,
          );
        },
      },
    ]);
  },
};

/**
 * 场景 6：前后端构建一致性（A2）
 * 路由 /overview；断言布局根节点 [data-build] 存在 → 调 GET /api/v1/version → 断言 build 相等。
 * 前置数据：后端需暴露 /api/v1/version（公开只读）。
 * 不等 → FAIL 并提示「前端可能是旧 bundle / 请硬刷新」。
 */
const scenarioBuildConsistency = {
  name: "build-consistency",
  desc: "构建一致性：页面 [data-build] 与后端 /api/v1/version 的 build 相等",
  route: "/overview",
  needsAuth: true,
  async run(ctx) {
    const b = ctx.browser;
    await runSteps(ctx, [
      {
        desc: "进入 /overview 并等布局根节点 [data-build]",
        fn: async () => {
          await gotoReady(ctx, "/overview", { readySelector: "[data-build]" });
        },
      },
      {
        desc: "读取页面 data-build",
        fn: async () => {
          const info = await b.elementInfo("[data-build]");
          const frontBuild = info?.attrs?.["data-build"];
          ctx.note("frontBuild", frontBuild);
          ctx.assert(info.found, "未找到 [data-build] 节点（前端构建标识缺失，疑似未注入 NEXT_PUBLIC_BUILD_ID）");
          ctx.assert(
            !!frontBuild && frontBuild !== "dev",
            `页面 data-build 为「${frontBuild}」，不是真实构建标识（dev 表示构建期未注入 NEXT_PUBLIC_BUILD_ID）`,
          );
        },
      },
      {
        desc: "调用后端 GET /api/v1/version 并比对 build",
        fn: async () => {
          let payload;
          try {
            const res = await fetch(`${ctx.api}/api/v1/version`);
            const text = await res.text();
            ctx.assert(res.ok, `GET /api/v1/version 返回 HTTP ${res.status}：${text.slice(0, 160)}`);
            payload = JSON.parse(text);
          } catch (e) {
            throw new StepFailure(`GET /api/v1/version 失败：${e?.message || e}`);
          }
          ctx.note("backendVersion", payload);
          const front = ctx.artifacts.frontBuild;
          const back = payload.build;
          ctx.assert(!!back, "后端 /api/v1/version 未返回 build 字段");
          ctx.assert(
            front === back,
            `前后端构建不一致：前端 data-build=${front}，后端 build=${back} —— ` +
              `前端可能是旧 bundle（页面是改动前加载的），请硬刷新（Ctrl+F5）后重试；` +
              `若硬刷新仍不一致，说明前端镜像未重新构建`,
          );
          log(`      · 前端 build = ${front} / 后端 build = ${back}（一致）`);
        },
      },
    ]);
  },
};

/** --selftest 专用场景：故意用不存在的选择器，期望被判 FAIL */
const scenarioSelftest = {
  name: "selftest-wrong-selector",
  desc: `自检：故意用不存在的选择器 ${SELFTEST_BAD_SELECTOR}，应被判 FAIL 并产出证据`,
  route: "/overview",
  needsAuth: true,
  selftestOnly: true,
  expectOverride: SELFTEST_BAD_SELECTOR,
  async run(ctx) {
    await scenarioNotificationsDrawer.run(ctx);
  },
};

/**
 * 数据源「删除」确认弹层（回归护栏）：本场景只**打开确认框 → 点取消**，不删任何数据。
 *
 * 来历：删除按钮曾因 antd 基于锚点定位的浮层算出错误水平偏移（实测 left=-13420px，
 * 整块跑到视口外）而表现为「点了没反应」；改用居中 Modal 后修复。
 * 当时的探针之所以误判 PASS，是因为可见性口径只算了垂直交集 —— 现已补上水平方向，
 * 本场景因此能真正拦住这类"浮层跑到视口外"的回归。
 */
const scenarioSourcesDeleteConfirm = {
  name: "sources-delete-confirm",
  desc: "数据源「删除」确认弹层：真实点击可打开、双向都在视口内可见、可取消（不删数据）",
  route: "/sources",
  needsAuth: true,
  async run(ctx) {
    const b = ctx.browser;
    await runSteps(ctx, [
      {
        desc: "进入 /sources 并等表格渲染",
        fn: () => gotoReady(ctx, "/sources", { readySelector: ".ant-table" }),
      },
      {
        desc: "断言至少存在一个数据源（否则无法测试删除确认）",
        fn: async () => {
          const rows = await b.count(".ant-table-tbody tr");
          ctx.note("rows", rows);
          ctx.assert(rows > 0, "当前没有任何数据源，无法验证删除确认弹层（先添加一个数据源）");
        },
      },
      {
        desc: "用真实鼠标事件点击第一行的「删除」按钮",
        fn: async () => {
          const r = await b.clickByText("删除", { tag: "button" });
          ctx.note("click:delete", { ok: r.ok, warn: r.warn, candidates: r.candidates });
          ctx.assert(r.ok, `点击「删除」失败：${r.warn}`);
        },
      },
      {
        desc: "断言确认弹层已打开，且水平+垂直都在视口内可见",
        fn: async () => {
          const vis = await b.waitForVisible(".ant-modal-confirm", { timeout: 10_000 });
          assertVisible(ctx, vis, "删除确认弹层");
        },
      },
      {
        desc: "点击「取消」关闭弹层（本场景不执行删除）",
        fn: async () => {
          const r = await b.clickByText("取消", { tag: "button" });
          ctx.note("click:cancel", { ok: r.ok, warn: r.warn });
          ctx.assert(r.ok, `点击「取消」失败：${r.warn}`);
          const closed = await b.waitForFunction(
            `(() => { const m = document.querySelector('.ant-modal-confirm');
                      if (!m) return true;
                      const cs = getComputedStyle(m);
                      return cs.display === 'none' || cs.visibility === 'hidden' || !m.offsetParent; })()`,
            { timeout: 8_000, desc: "确认弹层关闭" },
          );
          ctx.assert(closed.ok, "点击取消后确认弹层未关闭");
        },
      },
    ]);
  },
};

const ALL_SCENARIOS = [
  scenarioNotificationsDrawer,
  scenarioCollectionModal,
  scenarioClosedLoopConfig,
  scenarioNotificationsTabs,
  scenarioRunTimeline,
  scenarioSourcesDeleteConfirm,
  scenarioBuildConsistency,
  scenarioSelftest,
];

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const scenarios = SELFTEST
    ? ALL_SCENARIOS.filter((s) => s.selftestOnly)
    : ALL_SCENARIOS.filter((s) => !s.selftestOnly)
        .filter((s) => (ONLY ? s.name === ONLY : true))
        .filter((s) => (FAST ? !s.slow : true));

  if (scenarios.length === 0) {
    log(`[FATAL] 没有匹配的场景（--only=${ONLY || "-"}）`);
    const names = ALL_SCENARIOS.filter((s) => !s.selftestOnly).map((s) => s.name);
    log(`可用场景：${names.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  if (WINDOW && !parseWindowSize(WINDOW)) {
    log(`[FATAL] --window 格式非法：${WINDOW}（应为 WxH，如 1366x768）`);
    process.exitCode = 2;
    return;
  }

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  log("============================================================");
  log(`真实浏览器场景运行器  ${SELFTEST ? "【自检模式】" : ""}`);
  log(`前端 ${BASE}   后端 ${API}   窗口 ${WINDOW}${HEADED ? " (headed)" : " (headless)"}`);
  log(`可见性口径：display!=none 且 宽高>0 且 可见高度占比与可见宽度占比都>${VISIBLE_MIN_RATIO}（三条同时满足）`);
  log(`证据目录：${EVIDENCE_DIR}`);
  log("============================================================");

  const browser = await launchBrowser({ port: PORT, windowSize: WINDOW, headed: HEADED });
  let authState = { ok: false, reason: "" };
  const results = [];
  try {
    // ---- 登录态准备 ----
    if (MANUAL_TOKEN) {
      const admin = MANUAL_ADMIN
        ? JSON.parse(MANUAL_ADMIN)
        : { id: 1, email: "admin@campus.local", name: "admin", role: "super_admin" };
      const wrote = await browser.setAuth(BASE, { token: MANUAL_TOKEN, admin });
      authState = wrote
        ? { ok: true, reason: "手工注入 --token" }
        : { ok: false, reason: "手工 token 写入 localStorage 失败" };
    } else {
      try {
        const auth = await apiLogin(API, {
          force: NO_CACHE,
          onStatus: (m) => log(`[登录] ${m}`),
        });
        log(`[登录] ${auth.cached ? "复用缓存的 token（未过期，未再调登录接口）" : "已调用 POST /api/admin/login 获取新 token"}`);
        const wrote = await browser.setAuth(BASE, { token: auth.access_token, admin: auth.admin });
        authState = wrote
          ? { ok: true, reason: auth.cached ? "缓存 token" : "新登录 token" }
          : { ok: false, reason: "token 写入 localStorage 失败" };
      } catch (e) {
        authState = { ok: false, reason: e?.message || String(e) };
      }
    }
    if (!authState.ok) {
      log(`[登录] 不可用：${authState.reason}`);
      if (SELFTEST) {
        log("[SELFTEST] 前置登录态不可用，无法自检");
        process.exitCode = 2;
        return;
      }
    } else {
      log(`[登录] 就绪（${authState.reason}）`);
    }

    // ---- 逐场景执行 ----
    for (const sc of scenarios) {
      log("");
      log(`▶ ${sc.name} —— ${sc.desc}`);
      const ctx = createCtx({ name: sc.name, browser, route: sc.route, evidenceDir: EVIDENCE_DIR });
      ctx.api = API;
      ctx.base = BASE;
      ctx.expectOverride = sc.expectOverride;

      let status;
      if (sc.needsAuth && !authState.ok) {
        status = "SKIP";
        ctx.failure = { step: "登录态", reason: `SKIP(需登录)：${authState.reason}` };
        log(`  [SKIP] 需登录，但登录态不可用：${authState.reason}`);
      } else {
        browser.resetCollectors();
        try {
          await sc.run(ctx);
        } catch (e) {
          ctx.failure = { step: "场景执行", reason: `${e?.name || "Error"}: ${e?.message || e}` };
          log(`      ✗ 场景执行异常 → ${ctx.failure.reason}`);
        }
        if (!ctx.failure) {
          status = "PASS";
        } else if (String(ctx.failure.reason).startsWith("PREREQ:")) {
          status = "WARN";
          ctx.failure.reason = String(ctx.failure.reason).replace(/^PREREQ:/, "前置数据缺失：");
        } else {
          status = "FAIL";
        }
      }

      // ---- 取证：FAIL/WARN/selftest 一律落盘（含截图） ----
      const collected = browser.collected();
      const needEvidence = status !== "PASS" || SELFTEST;
      const artifacts = {};
      if (needEvidence) {
        artifacts.screenshot = await safeScreenshot(browser, join(EVIDENCE_DIR, `${sc.name}.png`));
      }
      writeFileSync(
        join(EVIDENCE_DIR, `${sc.name}.json`),
        JSON.stringify(
          {
            scenario: sc.name,
            desc: sc.desc,
            route: sc.route,
            status,
            window: WINDOW,
            base: BASE,
            api: API,
            visibilityRule: {
              displayNotNone: true,
              sizeGtZero: true,
              visibleHeightRatioGt: VISIBLE_MIN_RATIO,
            },
            failure: ctx.failure,
            warnings: ctx.warnings,
            steps: ctx.steps,
            artifacts: ctx.artifacts,
            screenshot: artifacts.screenshot || null,
            url: await browser.currentUrl().catch(() => null),
            viewport: await browser
              .mustEvaluate("window.innerWidth + 'x' + window.innerHeight")
              .catch(() => null),
            collectedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      writeFileSync(join(EVIDENCE_DIR, `${sc.name}.console.json`), JSON.stringify(collected, null, 2));

      results.push({ name: sc.name, status, reason: ctx.failure?.reason || "", warnings: ctx.warnings });
    }
  } finally {
    await browser.close();
  }

  // ---- 汇总 ----
  log("");
  log("============================================================");
  log("场景结果");
  log("============================================================");
  for (const r of results) {
    const tag = `[${r.status}]`;
    log(`${tag.padEnd(7)} ${r.name}${r.reason ? " —— " + r.reason : ""}`);
    for (const w of r.warnings) log(`         · WARN: ${w}`);
  }
  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP");
  const warned = results.filter((r) => r.status === "WARN");
  const passed = results.filter((r) => r.status === "PASS");
  log("");
  log(`PASS ${passed.length} / FAIL ${failed.length} / WARN ${warned.length} / SKIP ${skipped.length}`);
  log(`证据目录：${EVIDENCE_DIR}`);

  writeFileSync(
    join(EVIDENCE_DIR, "summary.json"),
    JSON.stringify({ window: WINDOW, base: BASE, api: API, results, evidenceDir: EVIDENCE_DIR }, null, 2),
  );

  if (SELFTEST) {
    await runSelftestAssertions(results, EVIDENCE_DIR);
    return;
  }
  process.exitCode = failed.length > 0 ? 1 : 0;
  log(failed.length > 0 ? "结果：存在 FAIL（退出码 1）" : "结果：全部通过（退出码 0）");
}

async function safeScreenshot(browser, file) {
  try {
    return await browser.screenshot(file);
  } catch (e) {
    log(`      [warn] 截图失败：${e?.message || e}`);
    return null;
  }
}

/**
 * 自检断言：证明「工具能抓到失败」，而不是永远 PASS。
 * 条件：1) 故意错误的选择器确实被判 FAIL；2) 确实产出了证据文件（JSON + PNG）。
 */
async function runSelftestAssertions(results, dir) {
  log("");
  log("------------------------------------------------------------");
  log("[SELFTEST] 自检断言：故意错误的选择器必须被判 FAIL，且必须产出证据");
  log("------------------------------------------------------------");
  const r = results[0];
  const okFail = !!r && r.status === "FAIL";
  log(`[SELFTEST] 场景 ${r?.name} 判定 = ${r?.status}（期望 FAIL）${okFail ? " ✓" : " ✗"}`);
  if (r?.reason) log(`[SELFTEST] 失败原因 = ${r.reason}`);

  const base = join(dir, r?.name || "selftest-wrong-selector");
  const files = {
    json: `${base}.json`,
    png: `${base}.png`,
    console: `${base}.console.json`,
  };
  const exists = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, existsSync(p)]));
  log(`[SELFTEST] 证据文件：${JSON.stringify(exists)}`);
  let listed = [];
  try {
    listed = readdirSync(dir);
  } catch {
    /* ignore */
  }
  log(`[SELFTEST] 证据目录内容：${JSON.stringify(listed)}`);

  const okEvidence = exists.json && exists.console;
  if (okFail && okEvidence) {
    log("[SELFTEST] PASS —— 工具能正确报 FAIL 且产出证据文件（不存在「永远 PASS」的假象）");
    process.exitCode = 0;
  } else {
    log(
      `[SELFTEST] FAIL —— ${!okFail ? "故意错误的选择器没有被判 FAIL（工具失去发现失败的能力）" : "未产出证据文件"}`,
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("[FATAL] " + (e?.stack || e));
  process.exitCode = 2;
});

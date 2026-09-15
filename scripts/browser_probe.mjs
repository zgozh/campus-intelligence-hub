/**
 * 真实浏览器诊断探针（CDP，零新增依赖）
 *
 * 背景：jsdom 渲染测试只能证明"React 里有这个按钮"，无法证明"真实浏览器里点得开"。
 * 本项目确实出现过"单测通过但用户实测点不开"（右上角通知铃铛），所以需要真机验证手段。
 *
 * 本脚本用本机 Edge/Chrome 无头模式 + CDP 做四件事：
 *  1) 采集运行时错误（console.error/warning、未捕获异常、Log 条目）——hydration 失败会让整页失去交互；
 *  2) 采集 4xx/5xx 资源（缺失 chunk 会导致交互脚本根本没加载）；
 *  3) 在**全新加载的页面**上先用「真实鼠标事件 Input.dispatchMouseEvent」点击目标（走命中测试，
 *     能发现遮挡/pointer-events 问题），再重载页面用「合成 .click()」点击做对照；
 *  4) 打印目标元素与被测弹层的几何/层级/可见性。
 *
 * 判定口径（重要）：antd 弹层关闭后节点仍留在 DOM 且 display:none，
 * **不能**用 document.querySelector('.ant-popover') 是否存在判定"打开了"，
 * 必须同时满足：display!=none、rect 宽高>0、且与视口交集足够（可见高度占比 > 0.5）。
 * 第三条是 jsdom 结构性测不出来的那一维（本项目真机踩过：面板尺寸正常但 top=-1000×视口高，整块在视口外）。
 *
 * 本文件已重构为复用 scripts/lib/cdp.mjs（CDP 客户端/浏览器生命周期/真实点击/等待/截图/可见性口径），
 * CLI 与输出结构保持不变；新增：未提供 token 时自动调用后端登录接口（带 token 缓存，避免触发登录限流）。
 *
 * 用法：
 *   node scripts/browser_probe.mjs --url http://localhost:3000/overview
 *   node scripts/browser_probe.mjs --url http://localhost:3000/overview --window 1366x768 --expect ".ant-drawer"
 * 参数：
 *   --url        目标页面（默认 http://localhost:3000/overview）
 *   --selector   要点击的元素（默认通知铃铛 [aria-label="通知中心"]）
 *   --expect     点击后应打开的弹层（默认 .ant-popover）
 *   --settle     进入页面后等待毫秒（默认 3500，等 hydration）
 *   --port       CDP 端口（默认 9222）
 *   --viewport   WxH：用 Emulation 覆盖视口（可能引入布局假象，慎用）
 *   --window     WxH：真实窗口尺寸（更接近用户环境，推荐）
 *   --headed     有头模式
 *   --token      login JWT（缺省读环境变量 PROBE_TOKEN；再缺省则自动登录）
 *   --admin      admin JSON（缺省读环境变量 PROBE_ADMIN；再缺省则随自动登录获取）
 *   --api        后端地址（默认 http://localhost:8000，自动登录用）
 *   --no-login   不注入任何登录态（调试登录页/公开页时用）
 * 退出码：0 = 真实鼠标点击能打开；1 = 不能；2 = 探针自身失败。
 */
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchBrowser, apiLogin, parseArgs, sleep } from "./lib/cdp.mjs";

const args = parseArgs();

const URL_TARGET = String(args.url || "http://localhost:3000/overview");
const SELECTOR = String(args.selector || '[aria-label="通知中心"]');
const EXPECT = String(args.expect || ".ant-popover");
const TOKEN = String(args.token || process.env.PROBE_TOKEN || "");
// AuthContext 同时要求 localStorage 的 token 与 admin（缺 admin 会被判未登录并跳 /login）
const ADMIN_JSON = String(args.admin || process.env.PROBE_ADMIN || "");
const SETTLE_MS = Number(args.settle || "3500");
const PORT = Number(args.port || "9222");
const VIEWPORT = String(args.viewport || ""); // 形如 1280x720
const WINDOW_SIZE = String(args.window || ""); // 形如 1280x720
const HEADED = !!args.headed;
const NO_LOGIN = !!args["no-login"];
const API_BASE = String(args.api || "http://localhost:8000");

/** 把 lib 的可见性判定结果映射成探针原有的报告结构（保持输出兼容） */
function toOpenState(vis) {
  if (!vis || vis.found !== true) {
    return { appeared: false, open: false, reason: vis?.reason || "元素不存在" };
  }
  const r = vis.rect || {};
  return {
    appeared: true,
    // 原语义：display!=none 且 visibility!=hidden 且宽高>0（不含视口交集，交集单独看 visibleHeightRatio）
    open: vis.rule.displayOk && vis.rule.sizeOk && !vis.visibilityHidden,
    display: vis.display,
    visibility: vis.visibility,
    opacity: vis.opacity,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    viewport: vis.viewport,
    clippedTop: vis.clippedTop,
    clippedBottom: vis.clippedBottom,
    clippedLeft: vis.clippedLeft,
    clippedRight: vis.clippedRight,
    visibleHeightRatio: vis.visibleHeightRatio,
    visibleWidthRatio: vis.visibleWidthRatio,
    // 新增（同口径）：三条口径是否同时满足 —— 与 browser_smoke.mjs 完全一致
    visibleByRule: vis.visible,
    rule: vis.rule,
    // 诊断用：定位/层级/动画态的原始证据，便于定位"为何在视口外"
    inlineStyle: vis.inlineStyle,
    position: vis.position,
    top: vis.top,
    left: vis.left,
    transform: vis.transform,
    zIndex: vis.zIndex,
    animationName: vis.animationName,
    transition: vis.transition,
    parentChain: vis.parentChain,
    text: (vis.text || "").slice(0, 100),
  };
}

async function main() {
  const browser = await launchBrowser({ port: PORT, windowSize: WINDOW_SIZE, headed: HEADED });
  const state = { browser };

  try {
    // 视口：真实用户的窗口尺寸会决定弹层能否放得下（antd 空间不足时会翻到上方/被裁切）
    let viewportNote = "browser-default";
    if (VIEWPORT) {
      const [w, h] = VIEWPORT.split("x").map(Number);
      if (w > 0 && h > 0) {
        await browser.setViewport(w, h);
        viewportNote = `${w}x${h}`;
      }
    }

    const navigateAndSettle = async () => {
      await browser.navigate(URL_TARGET, { settleMs: SETTLE_MS });
    };

    // 1) 准备登录态（localStorage 需同源，故先到 /login）
    const origin = new URL(URL_TARGET).origin;
    if (!NO_LOGIN) {
      let token = TOKEN;
      let adminJson = ADMIN_JSON;
      if (!token) {
        try {
          const auth = await apiLogin(API_BASE, {
            onStatus: (m) => console.error("[登录] " + m),
          });
          token = auth.access_token;
          adminJson = JSON.stringify(auth.admin);
          console.error(
            auth.cached
              ? "[登录] 复用缓存 token（未再调登录接口，避免 5 次/300s 限流）"
              : "[登录] 已调用 POST /api/admin/login 获取新 token",
          );
        } catch (e) {
          console.error("[WARN] 自动登录失败：" + (e?.message || e) + "（将不带登录态继续，可能被重定向到 /login）");
        }
      }
      if (token) {
        const admin = adminJson ? JSON.parse(adminJson) : null;
        const ok = await browser.setAuth(origin, { token, admin });
        console.error(ok ? "[INFO] 已注入登录态" : "[WARN] 登录态写入失败");
      } else if (!ADMIN_JSON && !TOKEN) {
        console.error("[WARN] 未提供登录态，且自动登录未成功");
      }
    } else {
      console.error("[INFO] --no-login：不注入登录态");
    }

    // 2) 全新加载 → 先用真实鼠标事件点击（最接近用户操作）
    await navigateAndSettle();
    const element = await browser.elementInfo(SELECTOR);
    let realFirst = { open: false, note: "no-rect" };
    if (element?.found && element.rect) {
      const click = await browser.realClick(SELECTOR);
      await sleep(1000);
      realFirst = toOpenState(await browser.isVisiblyOpen(EXPECT));
      realFirst.hitTestOk = click.hitTestOk;
      realFirst.hitTestTag = click.hitTestTag;
      if (!click.ok) realFirst.note = click.warn;
    }

    // 2b) 若点开后不可见，强制触发一次 resize（rc-align 会在 resize 时重新对齐）。
    // 作用：区分"对齐算不出来"与"对齐算得出来但打开时没被应用"（受控 open 竞态）。
    let afterResize = null;
    if (realFirst && realFirst.open && (realFirst.visibleHeightRatio === 0 || realFirst.visibleWidthRatio === 0)) {
      await browser.nudgeResize();
      afterResize = toOpenState(await browser.isVisiblyOpen(EXPECT));
    }

    // 3) 重载后改用合成 click 做对照（区分"事件没挂上"与"不可点/被遮挡"）
    await navigateAndSettle();
    const synth = await browser.syntheticClick(SELECTOR);
    await sleep(1000);
    const synthState = toOpenState(await browser.isVisiblyOpen(EXPECT));

    const collected = browser.collected();
    const report = {
      target: URL_TARGET,
      selector: SELECTOR,
      expect: EXPECT,
      viewportOverride: viewportNote,
      windowSize: WINDOW_SIZE || "(browser default)",
      element,
      realMouseClickOnFreshPage: realFirst,
      realignAfterForcedResize: afterResize,
      syntheticClickAfterReload: { result: synth, state: synthState },
      consoleMessages: collected.consoleMessages,
      exceptions: collected.exceptions,
      logEntries: collected.logEntries,
      badResponses: collected.badResponses,
    };
    console.log(JSON.stringify(report, null, 2));

    const verdict = !element?.found
      ? "FAIL：目标元素不存在（选择器错或页面未进入该路由）"
      : element.hitTestIsSelfOrChild === false
        ? `FAIL：元素被遮挡，命中测试落在 ${element.hitTestTag}`
        : element.disabled
          ? "FAIL：元素处于禁用态"
          : realFirst.open && realFirst.visibleByRule
            ? "PASS：真实鼠标点击可打开且面板在视口内可见（用户点得开、看得见）"
            : realFirst.open
              ? `FAIL：面板已打开但几乎不可见（rect=${realFirst.x},${realFirst.y} ${realFirst.w}x${realFirst.h}；可见比例 水平=${realFirst.visibleWidthRatio} 垂直=${realFirst.visibleHeightRatio}）——定位/滚动容器问题，用户表现为"点了没反应"`
              : synthState.open
                ? "FAIL：合成 click 能打开、真实鼠标不能 —— 事件被拦截/未冒泡（pointer-events、父级吞事件、遮罩）"
                : collected.exceptions.length
                  ? "FAIL：点击无效且页面有运行时异常（疑似 hydration/渲染失败）"
                  : "FAIL：点击后受控 open 未更新（事件处理器未挂载或状态逻辑错误）";
    console.log("\n[VERDICT] " + verdict);
    process.exitCode = realFirst.open && realFirst.visibleByRule ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("[FATAL] " + (e?.stack || e));
  process.exitCode = 2;
});

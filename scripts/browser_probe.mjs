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
 * 必须同时满足 display!=none 且 rect 宽高 > 0，否则会把"没打开"误判为 PASS。
 *
 * 用法：
 *   node scripts/browser_probe.mjs --url http://localhost:3000/overview
 *   （登录态从环境变量 PROBE_TOKEN / PROBE_ADMIN 读取；AuthContext 需要 token 与 admin 两个键）
 * 参数：
 *   --url        目标页面（默认 http://localhost:3000/overview）
 *   --selector   要点击的元素（默认通知铃铛 [aria-label="通知中心"]）
 *   --expect     点击后应打开的弹层（默认 .ant-popover）
 *   --settle     进入页面后等待毫秒（默认 3500，等 hydration）
 *   --port       CDP 端口（默认 9222）
 *   --headed     有头模式
 * 退出码：0 = 真实鼠标点击能打开；1 = 不能；2 = 探针自身失败。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const has = (name) => args.includes(`--${name}`);

const URL_TARGET = arg("url", "http://localhost:3000/overview");
const SELECTOR = arg("selector", '[aria-label="通知中心"]');
const EXPECT = arg("expect", ".ant-popover");
const TOKEN = arg("token", process.env.PROBE_TOKEN || "");
// AuthContext 同时要求 localStorage 的 token 与 admin（缺 admin 会被判未登录并跳 /login）
const ADMIN_JSON = arg("admin", process.env.PROBE_ADMIN || "");
const SETTLE_MS = Number(arg("settle", "3500"));
const PORT = Number(arg("port", "9222"));
const VIEWPORT = arg("viewport", ""); // 形如 1280x720：用 Emulation 覆盖（可能引入布局假象，慎用）
const WINDOW_SIZE = arg("window", ""); // 形如 1280x720：真实窗口尺寸（更接近用户环境，推荐）
const HEADED = has("headed");

const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const browserPath = CANDIDATES.find((p) => existsSync(p));
if (!browserPath) {
  console.error("[FATAL] 未找到 Edge/Chrome 可执行文件");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userDataDir = mkdtempSync(join(tmpdir(), "dsh-probe-"));

// stdio:'ignore' —— 沙箱下 piped stdio 会 EPERM
const child = spawn(
  browserPath,
  [
    HEADED ? "--headless=false" : "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    ...(WINDOW_SIZE ? [`--window-size=${WINDOW_SIZE.replace("x", ",")}`] : []),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ],
  { stdio: "ignore", detached: false },
);

let ws;
let nextId = 1;
const pending = new Map();
const consoleMsgs = [];
const exceptions = [];
const logEntries = [];
const badResponses = [];

const send = (method, params = {}) => {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    return { error: res.exceptionDetails.text + " " + (res.exceptionDetails.exception?.description || "") };
  }
  return { value: res.result?.value };
}

async function waitForCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await r.json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* 端口未就绪 */
    }
    await sleep(500);
  }
  throw new Error("CDP 端口未就绪");
}

const ELEMENT_INFO_EXPR = `(() => {
  const el = document.querySelector(${JSON.stringify(SELECTOR)});
  const where = { url: location.href, path: location.pathname,
                  bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160) };
  if (!el) return { found: false, ...where };
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    found: true, ...where,
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    pointerEvents: cs.pointerEvents, visibility: cs.visibility, opacity: cs.opacity,
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    hitTestIsSelfOrChild: !!top && (top === el || el.contains(top)),
    hitTestTag: top ? (top.tagName + '.' + String(top.className || '').slice(0, 60)) : null,
  };
})()`;

const OPEN_STATE_EXPR = `(() => {
  const p = document.querySelector(${JSON.stringify(EXPECT)});
  if (!p) return { appeared: false, open: false };
  const cs = getComputedStyle(p);
  const r = p.getBoundingClientRect();
  const open = cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  const vw = window.innerWidth, vh = window.innerHeight;
  // 弹层是否真的"看得见"：部分可见也算可见，但要把越界量报出来
  const clippedTop = Math.max(0, -r.top);
  const clippedBottom = Math.max(0, r.bottom - vh);
  const visibleH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
  return { appeared: true, open, display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
           x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
           viewport: vw + 'x' + vh,
           clippedTop: Math.round(clippedTop), clippedBottom: Math.round(clippedBottom),
           visibleHeightRatio: r.height > 0 ? Number((visibleH / r.height).toFixed(2)) : 0,
           // 诊断用：定位/层级/动画态的原始证据，便于定位"为何在视口外"
           inlineStyle: (p.getAttribute('style') || '').slice(0, 240),
           position: cs.position, top: cs.top, left: cs.left, transform: cs.transform,
           zIndex: cs.zIndex, animationName: cs.animationName, transition: cs.transition.slice(0, 60),
           parentChain: (() => {
             const out = []; let n = p.parentElement, i = 0;
             while (n && i < 6) {
               const s = getComputedStyle(n);
               out.push(n.tagName + '[' + String(n.className || '').slice(0, 40) + '] pos=' + s.position +
                        ' transform=' + (s.transform === 'none' ? 'none' : s.transform.slice(0, 40)) +
                        ' top=' + s.top);
               n = n.parentElement; i++;
             }
             return out;
           })(),
           text: (p.innerText || '').replace(/\\s+/g, ' ').slice(0, 100) };
})()`;

async function main() {
  const wsUrl = await waitForCdp();
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
      consoleMsgs.push({
        type: msg.params.type,
        text: (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 300),
      });
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      exceptions.push((d.exception?.description || d.text || "").slice(0, 500));
    }
    if (msg.method === "Log.entryAdded" && ["error", "warning"].includes(msg.params.entry.level)) {
      logEntries.push({ level: msg.params.entry.level, text: String(msg.params.entry.text).slice(0, 300) });
    }
    if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) {
      badResponses.push({ status: msg.params.response.status, url: msg.params.response.url.slice(0, 160) });
    }
  });

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Network.enable");

  // 视口：真实用户的窗口尺寸会决定弹层能否放得下（antd 空间不足时会翻到上方/被裁切）
  let viewportNote = "browser-default";
  if (VIEWPORT) {
    const [w, h] = VIEWPORT.split("x").map(Number);
    if (w > 0 && h > 0) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: w,
        height: h,
        deviceScaleFactor: 1,
        mobile: false,
      });
      viewportNote = `${w}x${h}`;
    }
  }

  const navigateAndSettle = async () => {
    await send("Page.navigate", { url: URL_TARGET });
    await sleep(SETTLE_MS);
  };

  // 1) 准备登录态（localStorage 需同源，故先到 /login）
  const origin = new URL(URL_TARGET).origin;
  await send("Page.navigate", { url: origin + "/login" });
  await sleep(2500);
  if (TOKEN) {
    const set = await evaluate(
      `localStorage.setItem('token', ${JSON.stringify(TOKEN)});
       ${ADMIN_JSON ? `localStorage.setItem('admin', ${JSON.stringify(ADMIN_JSON)});` : ""}
       (localStorage.getItem('token') && ${ADMIN_JSON ? "localStorage.getItem('admin')" : "true"}) ? 'ok' : 'fail'`,
    );
    console.error(set.value === "ok" ? "[INFO] 已注入登录态" : "[WARN] 登录态写入失败: " + JSON.stringify(set));
  }

  // 2) 全新加载 → 先用真实鼠标事件点击（最接近用户操作）
  await navigateAndSettle();
  const element = (await evaluate(ELEMENT_INFO_EXPR)).value;
  let realFirst = { open: false, note: "no-rect" };
  if (element?.found && element.rect) {
    const cx = element.rect.x + element.rect.w / 2;
    const cy = element.rect.y + element.rect.h / 2;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy, button: "none" });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 });
    await sleep(1000);
    realFirst = (await evaluate(OPEN_STATE_EXPR)).value || { open: false, note: "eval-error" };
  }

  // 2b) 若点开后不可见，强制触发一次 resize（rc-align 会在 resize 时重新对齐）。
  // 作用：区分"对齐算不出来"与"对齐算得出来但打开时没被应用"（受控 open 竞态）。
  let afterResize = null;
  if (realFirst && realFirst.open && realFirst.visibleHeightRatio === 0) {
    const vw = Number((realFirst.viewport || "800x600").split("x")[0]);
    const vh = Number((realFirst.viewport || "800x600").split("x")[1]);
    // 用同一尺寸覆盖会 no-op，故先 ±1 再还原
    await send("Emulation.setDeviceMetricsOverride", {
      width: vw,
      height: Math.max(200, vh - 1),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);
    await send("Emulation.setDeviceMetricsOverride", {
      width: vw,
      height: vh,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(900);
    afterResize = (await evaluate(OPEN_STATE_EXPR)).value || { open: false };
  }

  // 3) 重载后改用合成 click 做对照（区分"事件没挂上"与"不可点/被遮挡"）
  await navigateAndSettle();
  const synth = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(SELECTOR)});
    if (!el) return 'no-element';
    el.click();
    return 'clicked';
  })()`);
  await sleep(1000);
  const synthState = (await evaluate(OPEN_STATE_EXPR)).value || { open: false };

  const report = {
    target: URL_TARGET,
    selector: SELECTOR,
    element,
    realMouseClickOnFreshPage: realFirst,
    realignAfterForcedResize: afterResize,
    syntheticClickAfterReload: { result: synth.value, state: synthState },
    consoleMessages: consoleMsgs,
    exceptions,
    logEntries,
    badResponses,
  };
  console.log(JSON.stringify(report, null, 2));

  const verdict = !element?.found
    ? "FAIL：目标元素不存在（选择器错或页面未进入该路由）"
    : element.hitTestIsSelfOrChild === false
      ? `FAIL：元素被遮挡，命中测试落在 ${element.hitTestTag}`
      : element.disabled
        ? "FAIL：元素处于禁用态"
        : realFirst.open && realFirst.visibleHeightRatio > 0.5
          ? "PASS：真实鼠标点击可打开且面板在视口内可见（用户点得开、看得见）"
          : realFirst.open
            ? `FAIL：面板已打开但几乎不可见（rect.y=${realFirst.y}，可见比例=${realFirst.visibleHeightRatio}）——定位/滚动容器问题，用户表现为"点了没反应"`
            : synthState.open
              ? "FAIL：合成 click 能打开、真实鼠标不能 —— 事件被拦截/未冒泡（pointer-events、父级吞事件、遮罩）"
              : exceptions.length
                ? "FAIL：点击无效且页面有运行时异常（疑似 hydration/渲染失败）"
                : "FAIL：点击后受控 open 未更新（事件处理器未挂载或状态逻辑错误）";
  console.log("\n[VERDICT] " + verdict);
  process.exitCode = realFirst.open && realFirst.visibleHeightRatio > 0.5 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("[FATAL] " + (e?.stack || e));
    process.exitCode = 2;
  })
  .finally(async () => {
    try {
      ws?.close();
    } catch {}
    try {
      child.kill();
    } catch {}
    await sleep(300);
  });

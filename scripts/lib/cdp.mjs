/**
 * scripts/lib/cdp.mjs —— 零依赖 CDP 客户端 / 浏览器生命周期 / 真实交互 / 取证
 *
 * 为什么需要它：
 *   jsdom 渲染测试只能证明「React 树里有这个节点」，无法证明「真实浏览器里点得开、看得见」。
 *   本项目真实踩过的坑：通知面板 display:block、尺寸 364x811 都正常，但被 antd 对齐逻辑
 *   定位到 rect.top = -1000 × 视口高度（完全在视口外），jsdom 判定「已修复」而用户实测「点了没反应」。
 *
 * 【可见性口径】—— 本文件把它写死，所有场景共用，不允许各写一套：
 *   一个弹层/面板算「可见」，必须**同时**满足三条：
 *     1) getComputedStyle(el).display !== "none"
 *     2) el.getBoundingClientRect() 的宽、高均 > 0
 *     3) 与视口有足够交集：可见高度占比 > VISIBLE_MIN_RATIO(0.5)
 *        可见高度 = min(rect.bottom, innerHeight) - max(rect.top, 0)
 *        可见比例 = 可见高度 / rect.height
 *   第 3 条是 jsdom 永远测不出来的那一维（jsdom 无布局、无视口、无定位计算）。
 *   补充诊断（不参与判定，只进证据）：visibility / opacity / 命中测试结果。
 *
 * 【交互口径】
 *   触发交互一律走 Input.dispatchMouseEvent（mouseMoved → mousePressed → mouseReleased），
 *   它会经过浏览器的命中测试，能暴露「被遮挡 / pointer-events:none / 点在别的元素上」；
 *   element.click() 只能作为对照项，不能当作「用户点得开」的证据。
 *
 * 依赖：仅 Node 内置（node:child_process / 内置 fetch / Node 18+ 全局 WebSocket）。
 * 环境：Windows + 本机 Edge/Chrome（headless=new）。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// 常量与通用小工具
// ---------------------------------------------------------------------------

/** 弹层算「可见」的最小视口内高度占比（口径第 3 条） */
export const VISIBLE_MIN_RATIO = 0.5;

/** 默认轮询参数：不要靠一次性 sleep 蒙 hydration */
export const DEFAULT_WAIT_TIMEOUT = 15_000;
export const DEFAULT_WAIT_INTERVAL = 200;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 去掉全部空白字符：antd 会给两个汉字的按钮自动插空格（「重试」→「重 试」） */
export function normText(s) {
  return String(s ?? "").replace(/\s+/g, "");
}

/** 宽松包含：忽略空白差异（应对 antd 的两个汉字按钮自动插空格） */
export function looseIncludes(haystack, needle) {
  return normText(haystack).includes(normText(needle));
}

/** 宽松相等（同样忽略空白） */
export function looseEquals(a, b) {
  return normText(a) === normText(b);
}

const BROWSER_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

/** 找到本机可用的 Edge/Chrome；找不到返回 null */
export function findBrowserPath() {
  return BROWSER_CANDIDATES.find((p) => existsSync(p)) || null;
}

/** 杀掉整棵进程树（Windows 上 child.kill() 只杀主进程，容易留孤儿 msedge） */
export function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      // stdio:'ignore' —— 沙箱下 piped stdio 会 EPERM
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    /* 进程可能已退出 */
  }
}

// ---------------------------------------------------------------------------
// 登录：后端登录接口 + 注入 localStorage（token / admin 两个键都要）
// ---------------------------------------------------------------------------

/** 解析 JWT payload（不校验签名，只看 exp） */
export function decodeJwtPayload(token) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** token 是否已过期（skewMs 为提前量，避免边界上刚好失效） */
export function isJwtExpired(token, skewMs = 60_000) {
  const p = decodeJwtPayload(token);
  if (!p || typeof p.exp !== "number") return true;
  return Date.now() >= p.exp * 1000 - skewMs;
}

/** 默认登录态缓存文件（跨脚本、跨运行复用，避免触发后端 5 次/300s 登录限流） */
export function defaultAuthCacheFile() {
  return join(tmpdir(), "dsh-browser-smoke", "auth-cache.json");
}

function readAuthCache(cacheFile) {
  try {
    if (!existsSync(cacheFile)) return null;
    const data = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (!data?.access_token || isJwtExpired(data.access_token)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeAuthCache(cacheFile, data) {
  try {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ ...data, savedAt: Date.now() }, null, 2));
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

/**
 * 调后端登录接口换 token。用 Node 内置 fetch，不经过浏览器。
 *
 * 为什么要缓存：后端登录限流是 5 次 / 300 秒（config.py: login_rate_limit_max_attempts），
 * 反复跑 smoke 会很快吃满并拿到 429。因此默认复用未过期的缓存 token，
 * 且 429 时回退到缓存里「未过期」的 token（哪怕超出 maxAgeMs）。
 *
 * @returns {Promise<{access_token: string, admin: object, cached?: boolean}>}
 */
export async function apiLogin(
  apiBase,
  {
    email = "admin@campus.local",
    password = "campus123456",
    timeoutMs = 20_000,
    cacheFile = defaultAuthCacheFile(),
    maxAgeMs = 6 * 60 * 60 * 1000,
    force = false,
    retries = 2,
    onStatus = null,
  } = {},
) {
  const cached = cacheFile ? readAuthCache(cacheFile) : null;
  if (!force && cached && Date.now() - (cached.savedAt || 0) < maxAgeMs) {
    return { access_token: cached.access_token, admin: cached.admin, cached: true };
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let retryAfterMs = 0;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.ok) {
        const data = JSON.parse(text);
        if (!data.access_token) throw new Error(`登录响应缺少 access_token: ${text.slice(0, 200)}`);
        if (cacheFile) writeAuthCache(cacheFile, { access_token: data.access_token, admin: data.admin });
        return data;
      }
      retryAfterMs = Number(res.headers.get("retry-after") || 0) * 1000;
      lastErr = new Error(
        res.status === 429
          ? `登录被限流 HTTP 429（后端 5 次/300 秒）：${text.slice(0, 160)}`
          : `登录失败 HTTP ${res.status}: ${text.slice(0, 160)}`,
      );
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) {
      // 【实测坑】后端限流是 Redis 滑动窗口，且**每次请求都会 zadd 一条记录**
      // （services/redis_service.py: check_rate_limit → pipe.zadd(key, {now: now})），
      // 被拒绝的请求同样会把窗口往后推。所以「每 60s 重试一次」等于自己把自己无限锁死
      // （实测：每 15s 重试，连续 20 次 5 分钟全部 429）。
      // 正确做法：按后端给的 Retry-After（= 完整窗口 300s）**静默等待**，期间一次请求都不发。
      const waitMs = Math.max(retryAfterMs, 60_000);
      onStatus?.(
        `登录未成功（${lastErr?.message || lastErr}），静默等待 ${Math.round(waitMs / 1000)}s 后重试 ` +
          `（第 ${attempt + 1}/${retries} 次；滑动窗口限流期间发请求会延长锁定）`,
      );
      await sleep(waitMs);
    }
  }
  // 兜底：限流/网络故障时，用缓存里尚未过期的 token 继续
  if (cached) return { access_token: cached.access_token, admin: cached.admin, cached: true, fallback: true };
  throw lastErr;
}

// ---------------------------------------------------------------------------
// 页面内表达式工厂（可见性口径的唯一实现）
// ---------------------------------------------------------------------------

/**
 * 生成「可见性判定」页面内表达式。
 * 判定 = 三条同时满足；其余字段是给失败取证用的诊断信息，不参与判定。
 */
export function visibilityExpr(selector, minRatio = VISIBLE_MIN_RATIO) {
  return `(() => {
  const SEL = ${JSON.stringify(selector)};
  const MIN_RATIO = ${Number(minRatio)};
  const el = document.querySelector(SEL);
  const vw = window.innerWidth, vh = window.innerHeight;
  if (!el) {
    return { found: false, visible: false, reason: '元素不存在', viewport: vw + 'x' + vh,
             url: location.href, path: location.pathname };
  }
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();

  // —— 口径第 1 条：display 不为 none
  const displayOk = cs.display !== 'none';
  // —— 口径第 2 条：宽高均 > 0
  const sizeOk = r.width > 0 && r.height > 0;
  // —— 口径第 3 条：与视口交集足够（可见高度占比 > 0.5）
  const visibleTop = Math.max(r.top, 0);
  const visibleBottom = Math.min(r.bottom, vh);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  const visibleWidth = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
  const visibleHeightRatio = r.height > 0 ? visibleHeight / r.height : 0;
  const inViewportOk = visibleHeightRatio > MIN_RATIO;
  const visible = displayOk && sizeOk && inViewportOk;

  // 诊断（不参与判定）
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = (cx >= 0 && cy >= 0 && cx < vw && cy < vh) ? document.elementFromPoint(cx, cy) : null;
  const hitTestIsSelfOrChild = !!hit && (hit === el || el.contains(hit));

  return {
    found: true,
    visible,
    // 三条口径的逐条结果（证据里必须能一眼看出是哪条挂了）
    rule: { displayOk, sizeOk, inViewportOk, minRatio: MIN_RATIO },
    reason: visible ? '三条口径全部满足'
      : !displayOk ? 'display:none'
      : !sizeOk ? '宽高为 0'
      : '与视口交集不足（可见高度占比 ' + visibleHeightRatio.toFixed(2) + ' <= ' + MIN_RATIO + '）',
    rect: { x: Math.round(r.left), y: Math.round(r.top),
            w: Math.round(r.width), h: Math.round(r.height),
            right: Math.round(r.right), bottom: Math.round(r.bottom) },
    viewport: vw + 'x' + vh,
    visibleHeightRatio: Number(visibleHeightRatio.toFixed(3)),
    visibleHeight: Math.round(visibleHeight),
    clippedTop: Math.round(Math.max(0, -r.top)),
    clippedBottom: Math.round(Math.max(0, r.bottom - vh)),
    // 诊断字段
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    position: cs.position, top: cs.top, left: cs.left, transform: cs.transform,
    zIndex: cs.zIndex, pointerEvents: cs.pointerEvents,
    animationName: cs.animationName, transition: cs.transition.slice(0, 80),
    visibilityHidden: cs.visibility === 'hidden',
    opacityZero: Number(cs.opacity) === 0,
    hitTestIsSelfOrChild, hitTestTag: hit ? (hit.tagName + '.' + String(hit.className || '').slice(0, 60)) : null,
    inlineStyle: (el.getAttribute('style') || '').slice(0, 240),
    className: String(el.className || '').slice(0, 200),
    text: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
    url: location.href, path: location.pathname,
    // 定位类缺陷溯源：父链的 position/transform/top
    parentChain: (() => {
      const out = []; let n = el.parentElement, i = 0;
      while (n && i < 6) {
        const s = getComputedStyle(n);
        out.push(n.tagName + '[' + String(n.className || '').slice(0, 40) + '] pos=' + s.position +
                 ' transform=' + (s.transform === 'none' ? 'none' : s.transform.slice(0, 40)) +
                 ' top=' + s.top + ' overflow=' + s.overflow);
        n = n.parentElement; i++;
      }
      return out;
    })(),
  };
})()`;
}

/** 生成「在容器内查子元素」的页面内表达式 */
export function withinExpr(containerSelector, innerSelector) {
  return `(() => {
  const box = document.querySelector(${JSON.stringify(containerSelector)});
  if (!box) return { containerFound: false, found: false, count: 0 };
  const list = Array.from(box.querySelectorAll(${JSON.stringify(innerSelector)}));
  const first = list[0] || null;
  const r = first ? first.getBoundingClientRect() : null;
  return {
    containerFound: true,
    containerText: (box.innerText || '').replace(/\\s+/g, ' ').slice(0, 2000),
    found: list.length > 0,
    count: list.length,
    rect: r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
    text: first ? (first.innerText || first.textContent || '').replace(/\\s+/g, ' ').slice(0, 300) : null,
  };
})()`;
}

// ---------------------------------------------------------------------------
// CDP 客户端 / 浏览器
// ---------------------------------------------------------------------------

export class CdpBrowser {
  /**
   * @param {object} opts
   * @param {number} [opts.port=9222]      CDP 端口
   * @param {string} [opts.windowSize]     形如 "1366x768"（真实窗口尺寸）
   * @param {boolean} [opts.headed=false]  有头模式
   * @param {string} [opts.userDataDir]    用户数据目录（缺省自动建临时目录）
   * @param {string} [opts.browserPath]    浏览器可执行文件（缺省自动探测）
   */
  constructor(opts = {}) {
    this.port = Number(opts.port ?? 9222);
    this.windowSize = opts.windowSize || "";
    this.headed = !!opts.headed;
    this.browserPath = opts.browserPath || findBrowserPath();
    this.userDataDir = opts.userDataDir || mkdtempSync(join(tmpdir(), "dsh-cdp-"));
    this.child = null;
    this.ws = null;
    this._nextId = 1;
    this._pending = new Map();
    // 采集器
    this.consoleMessages = [];
    this.exceptions = [];
    this.logEntries = [];
    this.badResponses = [];
    this.requestsFailed = [];
    this._closed = false;
  }

  /** 启动浏览器并建立 CDP 连接（含 Runtime/Log/Page/Network 域） */
  async start() {
    if (!this.browserPath) throw new Error("未找到 Edge/Chrome 可执行文件");
    const args = [
      this.headed ? "--headless=false" : "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--mute-audio",
      ...(this.windowSize ? [`--window-size=${this.windowSize.replace("x", ",")}`] : []),
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.userDataDir}`,
      "about:blank",
    ];
    // stdio:'ignore' —— 沙箱下 piped stdio 会 EPERM
    this.child = spawn(this.browserPath, args, { stdio: "ignore", detached: false });
    const wsUrl = await this._waitForCdp();
    await this._connect(wsUrl);
    await this.send("Runtime.enable");
    await this.send("Log.enable");
    await this.send("Page.enable");
    await this.send("Network.enable");
    return this;
  }

  async _waitForCdp() {
    for (let i = 0; i < 80; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/list`);
        const targets = await r.json();
        const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      } catch {
        /* 端口未就绪，继续等 */
      }
      await sleep(250);
    }
    throw new Error(`CDP 端口 ${this.port} 未就绪`);
  }

  async _connect(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", rej, { once: true });
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this._pending.has(msg.id)) {
        const { resolve, reject } = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        return;
      }
      this._collect(msg);
    });
  }

  /** 采集 console/异常/日志/4xx —— 判定「页面无异常」的依据 */
  _collect(msg) {
    const p = msg.params;
    switch (msg.method) {
      case "Runtime.consoleAPICalled":
        if (["error", "warning"].includes(p.type)) {
          this.consoleMessages.push({
            type: p.type,
            text: (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 400),
          });
        }
        break;
      case "Runtime.exceptionThrown": {
        const d = p.exceptionDetails;
        this.exceptions.push((d.exception?.description || d.text || "").slice(0, 600));
        break;
      }
      case "Log.entryAdded":
        if (["error", "warning"].includes(p.entry.level)) {
          this.logEntries.push({ level: p.entry.level, text: String(p.entry.text).slice(0, 400) });
        }
        break;
      case "Network.responseReceived":
        if (p.response.status >= 400) {
          this.badResponses.push({ status: p.response.status, url: String(p.response.url).slice(0, 200) });
        }
        break;
      case "Network.loadingFailed":
        this.requestsFailed.push({ error: String(p.errorText).slice(0, 120), url: String(p.requestId).slice(0, 60) });
        break;
      default:
        break;
    }
  }

  send(method, params = {}) {
    if (!this.ws) return Promise.reject(new Error("CDP 未连接"));
    const id = this._nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this._pending.set(id, { resolve, reject }));
  }

  /** 在页面里求值；返回 { value } 或 { error }（不抛异常，便于取证） */
  async evaluate(expression, { awaitPromise = true } = {}) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (res.exceptionDetails) {
      return {
        error: res.exceptionDetails.text + " " + (res.exceptionDetails.exception?.description || ""),
      };
    }
    return { value: res.result?.value };
  }

  /** 同上，但求值失败直接抛错（用于工具自身逻辑） */
  async mustEvaluate(expression) {
    const r = await this.evaluate(expression);
    if (r.error) throw new Error(`页面求值失败: ${r.error}`);
    return r.value;
  }

  // —— 视口与导航 ——

  /** 用 Emulation 覆盖视口（可能引入布局假象，优先用 --window 真实窗口） */
  async setViewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  /** 触发一次 resize（先 -1 再还原）：用于验证 rc-align 类定位是否在 resize 时重算 */
  async nudgeResize() {
    const vp = await this.mustEvaluate("window.innerWidth + 'x' + window.innerHeight");
    const [w, h] = String(vp).split("x").map(Number);
    await this.setViewport(w, Math.max(200, h - 1));
    await sleep(400);
    await this.setViewport(w, h);
    await sleep(900);
  }

  async navigate(url, { settleMs = 0 } = {}) {
    await this.send("Page.navigate", { url });
    if (settleMs > 0) await sleep(settleMs);
  }

  /** 当前 URL / 路径 */
  async currentPath() {
    return this.mustEvaluate("location.pathname");
  }

  async currentUrl() {
    return this.mustEvaluate("location.href");
  }

  // —— 等待（轮询，不靠固定 sleep） ——

  /** 等选择器出现（元素存在于 DOM 即可，不代表可见） */
  async waitForSelector(selector, { timeout = DEFAULT_WAIT_TIMEOUT, interval = DEFAULT_WAIT_INTERVAL } = {}) {
    const started = Date.now();
    let attempts = 0;
    for (;;) {
      attempts++;
      // 导航过程中求值可能抛「Execution context was destroyed」，视为「还没就绪」继续等
      try {
        const r = await this.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
        if (r.value === true) return { found: true, elapsed: Date.now() - started, attempts };
      } catch {
        /* 上下文切换中，继续轮询 */
      }
      if (Date.now() - started >= timeout) {
        return { found: false, elapsed: Date.now() - started, attempts, timeout };
      }
      await sleep(interval);
    }
  }

  /** 等任意表达式为真（用于等文案 / 等数量 / 等状态） */
  async waitForFunction(expression, { timeout = DEFAULT_WAIT_TIMEOUT, interval = DEFAULT_WAIT_INTERVAL, desc = "" } = {}) {
    const started = Date.now();
    let last;
    let lastError = null;
    for (;;) {
      try {
        const r = await this.evaluate(`(() => { try { return !!(${expression}); } catch (e) { return false; } })()`);
        last = r.value;
        if (r.value === true) return { ok: true, elapsed: Date.now() - started };
      } catch (e) {
        // 同上：导航/上下文切换期间的求值失败不算「条件不成立」，只是还没就绪
        lastError = e?.message || String(e);
      }
      if (Date.now() - started >= timeout) {
        return { ok: false, elapsed: Date.now() - started, timeout, desc, last, error: lastError };
      }
      await sleep(interval);
    }
  }

  /** 等元素出现且满足「可见三口径」 */
  async waitForVisible(selector, { timeout = DEFAULT_WAIT_TIMEOUT, interval = DEFAULT_WAIT_INTERVAL, minRatio = VISIBLE_MIN_RATIO } = {}) {
    const started = Date.now();
    let last = null;
    for (;;) {
      last = await this.isVisiblyOpen(selector, { minRatio });
      if (last?.visible === true) return { ...last, elapsed: Date.now() - started };
      if (Date.now() - started >= timeout) {
        return { ...(last || { found: false, visible: false }), elapsed: Date.now() - started, timeout, timedOut: true };
      }
      await sleep(interval);
    }
  }

  // —— 查询帮助 ——

  /** 可见性口径判定（三条写死在 visibilityExpr 里） */
  async isVisiblyOpen(selector, { minRatio = VISIBLE_MIN_RATIO } = {}) {
    const r = await this.evaluate(visibilityExpr(selector, minRatio));
    if (r.error) return { found: false, visible: false, reason: "求值失败: " + r.error };
    return r.value;
  }

  /**
   * 容器内查子元素：within(".ant-modal", ".ant-select")
   * 用于「断言某个控件确实在弹窗内部，而不是页面别处」
   */
  async within(containerSelector, innerSelector) {
    const r = await this.evaluate(withinExpr(containerSelector, innerSelector));
    if (r.error) return { containerFound: false, found: false, count: 0, reason: "求值失败: " + r.error };
    return r.value;
  }

  /** 元素数量 */
  async count(selector) {
    const r = await this.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    return typeof r.value === "number" ? r.value : 0;
  }

  /** 元素文本（去多余空白）；不存在返回 "" */
  async textOf(selector) {
    const r = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
                return el ? (el.innerText || el.textContent || '') : ''; })()`,
    );
    return String(r.value ?? "").replace(/\s+/g, " ").trim();
  }

  /** 页面 body 文本（去多余空白） */
  async bodyText() {
    const r = await this.evaluate("(document.body && (document.body.innerText || '')) || ''");
    return String(r.value ?? "").replace(/\s+/g, " ").trim();
  }

  /** 收集所有匹配元素的文本 + 可见性（用于定位「两个汉字被插空格」的按钮等） */
  async listElements(selector, { limit = 30 } = {}) {
    const r = await this.evaluate(`(() => {
      return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).slice(0, ${Number(limit)}).map((el) => {
        const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
        return { tag: el.tagName, text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
                 ariaLabel: el.getAttribute('aria-label'), disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
                 display: cs.display, pointerEvents: cs.pointerEvents,
                 rect: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } };
      });
    })()`);
    return Array.isArray(r.value) ? r.value : [];
  }

  /**
   * 元素诊断信息（命中测试 / 禁用态 / 样式），用于失败取证
   */
  async elementInfo(selector, { index = 0 } = {}) {
    const r = await this.evaluate(`(() => {
      const list = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const el = list[${Number(index)}];
      const where = { url: location.href, path: location.pathname, matched: list.length,
                      bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200) };
      if (!el) return { found: false, ...where };
      const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const inVp = cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight;
      const top = inVp ? document.elementFromPoint(cx, cy) : null;
      return {
        found: true, ...where,
        text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
        rect: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
        inViewport: inVp,
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity, pointerEvents: cs.pointerEvents,
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        // 元素全部属性：便于断言 data-* 标记（如构建标识 data-build）
        attrs: Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, String(a.value).slice(0, 120)])),
        hitTestIsSelfOrChild: !!top && (top === el || el.contains(top)),
        hitTestTag: top ? (top.tagName + '.' + String(top.className || '').slice(0, 60)) : null,
      };
    })()`);
    if (r.error) return { found: false, reason: "求值失败: " + r.error };
    return r.value;
  }

  // —— 真实交互 ——

  /**
   * 真实鼠标点击（Input.dispatchMouseEvent，走命中测试）。
   * 会先 scrollIntoView 再重新量坐标——与真人「滚到可见再点」一致。
   * @returns {Promise<{ok:boolean, point?:object, hitTestOk?:boolean, warn?:string, info?:object}>}
   */
  async realClick(selector, { index = 0, scroll = true } = {}) {
    const info = await this.elementInfo(selector, { index });
    if (!info.found) return { ok: false, warn: `元素不存在: ${selector}`, info };
    if (info.disabled) return { ok: false, warn: `元素处于禁用态: ${selector}`, info };
    if (scroll) {
      await this.evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${Number(index)}];
                                   if (el) el.scrollIntoView({ block: 'center', inline: 'center' }); })()`);
      await sleep(150);
    }
    const fresh = await this.elementInfo(selector, { index });
    if (!fresh.found || !fresh.rect || fresh.rect.w <= 0 || fresh.rect.h <= 0) {
      return { ok: false, warn: `元素无有效尺寸（可能未渲染/被折叠）: ${selector}`, info: fresh };
    }
    const x = fresh.rect.x + fresh.rect.w / 2;
    const y = fresh.rect.y + fresh.rect.h / 2;
    // 落点必须在视口内，否则 CDP 派发的事件不会落在元素上（会被误读成"点了没反应"）
    if (fresh.inViewport === false) {
      return {
        ok: false,
        offscreen: true,
        warn: `元素在视口外（落点 ${Math.round(x)},${Math.round(y)}），真实鼠标点不到: ${selector}`,
        point: { x: Math.round(x), y: Math.round(y) },
        info: fresh,
      };
    }
    await this.realClickPoint(x, y);
    return { ok: true, point: { x, y }, hitTestOk: fresh.hitTestIsSelfOrChild, hitTestTag: fresh.hitTestTag, info: fresh };
  }

  /** 在视口坐标 (x,y) 派发一次真实左键点击 */
  async realClickPoint(x, y, { settleMs = 400 } = {}) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    if (settleMs > 0) await sleep(settleMs);
  }

  /**
   * 按可见文本点按钮（宽松匹配空白，解决 antd 给两个汉字按钮插空格）。
   * 会先把目标滚进视口再重新量坐标，并校验落点在视口内 ——
   * 否则会把「按钮在视口外点不到」误当成「点了没反应」（本项目踩过）。
   * @param {string} text 目标文本（如 "采集" / "一键运行闭环"）
   * @param {object} opts tag=限定标签（默认 button，"" 表示不限）、index、exact=false
   */
  async clickByText(text, { tag = "button", index = 0, exact = false } = {}) {
    const sel = tag ? `${tag}` : "*";
    const target = normText(text);
    const findExpr = `Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const t = (el.innerText || el.textContent || '').replace(/\\s+/g, '');
        if (!t) return false;
        return ${exact ? `t === ${JSON.stringify(target)}` : `t.includes(${JSON.stringify(target)})`};
      })`;

    const listRes = await this.evaluate(
      `(() => (${findExpr}).map((el) => ({ text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60), tag: el.tagName })))()`,
    );
    const candidates = Array.isArray(listRes.value) ? listRes.value : [];
    if (candidates.length <= index) {
      return {
        ok: false,
        warn: `未找到文本为「${text}」的 ${tag || "元素"}（命中 ${candidates.length} 个）`,
        candidates,
      };
    }

    // 滚进视口（同步生效）→ 立刻重新量坐标 + 命中测试
    const m = await this.evaluate(`(() => {
      const el = (${findExpr})[${Number(index)}];
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const inVp = cx >= 0 && cy >= 0 && cx < vw && cy < vh;
      const hit = inVp ? document.elementFromPoint(cx, cy) : null;
      return {
        x: Math.round(cx), y: Math.round(cy), w: Math.round(r.width), h: Math.round(r.height),
        inViewport: inVp, viewport: vw + 'x' + vh,
        hitTestOk: !!hit && (hit === el || el.contains(hit)),
        hitTag: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 50) : null,
        text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
      };
    })()`);
    const hit = m.value;
    if (!hit) return { ok: false, warn: `找不到索引 ${index} 的目标元素`, candidates };
    if (!hit.inViewport) {
      return {
        ok: false,
        offscreen: true,
        warn:
          `「${text}」在视口外（落点 ${hit.x},${hit.y}，视口 ${hit.viewport}），真实鼠标点不到 —— ` +
          `通常是容器不可滚动或弹层超高`,
        point: { x: hit.x, y: hit.y },
        candidates,
      };
    }
    if (hit.w <= 0 || hit.h <= 0) {
      return { ok: false, warn: `「${text}」无有效尺寸（${hit.w}x${hit.h}）`, candidates };
    }
    await sleep(150);
    await this.realClickPoint(hit.x, hit.y);
    return {
      ok: true,
      point: { x: hit.x, y: hit.y },
      text: hit.text,
      hitTestOk: hit.hitTestOk,
      hitTestTag: hit.hitTag,
      candidates,
    };
  }

  /** 合成 click（对照项：只能证明事件处理器存在，不能证明用户点得到） */
  async syntheticClick(selector, { index = 0 } = {}) {
    const r = await this.evaluate(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(selector)})[${Number(index)}];
      if (!el) return 'no-element';
      el.click();
      return 'clicked';
    })()`);
    return r.value;
  }

  /** 键盘按键（用于 Esc 关弹层等） */
  async pressKey(key, { keyCode = 0, code = key } = {}) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
    await sleep(300);
  }

  // —— 取证 ——

  /** 截图到指定路径（自动建目录） */
  async screenshot(filePath) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    if (!r?.data) throw new Error("截图失败：CDP 未返回数据");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, Buffer.from(r.data, "base64"));
    return filePath;
  }

  /** 打一个采集器快照标记（用于判断「点击后有没有新增报错」） */
  mark() {
    return {
      console: this.consoleMessages.length,
      exceptions: this.exceptions.length,
      logs: this.logEntries.length,
      badResponses: this.badResponses.length,
    };
  }

  /** 取标记之后新增的采集项 */
  since(m) {
    return {
      consoleMessages: this.consoleMessages.slice(m.console),
      exceptions: this.exceptions.slice(m.exceptions),
      logEntries: this.logEntries.slice(m.logs),
      badResponses: this.badResponses.slice(m.badResponses),
    };
  }

  resetCollectors() {
    this.consoleMessages = [];
    this.exceptions = [];
    this.logEntries = [];
    this.badResponses = [];
    this.requestsFailed = [];
  }

  /** 汇总采集结果（写证据用） */
  collected() {
    return {
      consoleMessages: this.consoleMessages,
      exceptions: this.exceptions,
      logEntries: this.logEntries,
      badResponses: this.badResponses,
      requestsFailed: this.requestsFailed,
    };
  }

  /**
   * 注入登录态：先到同源 /login（localStorage 需同源才能写），
   * 再写入 token 与 admin **两个键**（AuthContext 缺一个就会判未登录跳 /login）。
   */
  async setAuth(base, { token, admin }) {
    const origin = new URL(base).origin;
    await this.navigate(origin + "/login", { settleMs: 2500 });
    const expr = `(() => {
      localStorage.setItem('token', ${JSON.stringify(token)});
      localStorage.setItem('admin', ${JSON.stringify(JSON.stringify(admin))});
      return (localStorage.getItem('token') && localStorage.getItem('admin')) ? 'ok' : 'fail';
    })()`;
    const r = await this.evaluate(expr);
    return r.value === "ok";
  }

  /** 关闭：先关 WS，再杀整棵进程树（避免留孤儿 msedge） */
  async close() {
    if (this._closed) return;
    this._closed = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    const pid = this.child?.pid;
    try {
      this.child?.kill();
    } catch {
      /* ignore */
    }
    killProcessTree(pid);
    await sleep(500);
  }
}

/** 一步到位：启动浏览器（调用方负责 close()） */
export async function launchBrowser(opts = {}) {
  const b = new CdpBrowser(opts);
  await b.start();
  return b;
}

/** 解析 "1366x768" → { width, height }；非法返回 null */
export function parseWindowSize(s) {
  const m = /^(\d+)x(\d+)$/i.exec(String(s || "").trim());
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** 简易 CLI 参数解析（两个脚本共用，保持 CLI 一致） */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

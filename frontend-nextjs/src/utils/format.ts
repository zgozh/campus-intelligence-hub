/**
 * 统一展示层格式化工具
 *
 * 背景：
 * 1. 后端返回的时间多为 UTC naive ISO 串（可带微秒、带或不带时区），前端各处
 *    直接用 `new Date(x).toLocaleString()` 会因环境/时区出现格式漂移，甚至把
 *    naive 串当本地时间解析导致时刻偏移 8 小时。
 * 2. LLM 生成的标题/摘要常带 Markdown 标记，偶发双重转义（字面量 `\n`），
 *    直接渲染会露出 `**校务知识洞察**`、`2026-09-08T14:07:42.033674+00:00`。
 *
 * 本文件把「时间格式化」与「行内 Markdown 清洗」收敛到一处，供全站展示层复用。
 * 约定：非法输入原样返回，绝不返回 "Invalid Date"。
 */

/** 数字补零到两位 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 已携带时区信息：Z 或 +HH:MM / +HHMM */
const TIMEZONE_SUFFIX = /(?:z|[+-]\d{2}:?\d{2})$/i;

/** 纯日期形式 YYYY-MM-DD */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 解析 ISO 字符串为 Date。
 * 无时区信息时按 UTC 解析（后端存的是 UTC naive 时间）；非法输入返回 null。
 */
function parseIso(input: string): Date | null {
  const raw = input.trim();
  if (!raw) return null;

  let normalized: string;
  if (DATE_ONLY.test(raw)) {
    // 纯日期：按 UTC 当日 00:00:00 处理
    normalized = `${raw}T00:00:00Z`;
  } else if (TIMEZONE_SUFFIX.test(raw)) {
    // 自带时区，直接交给原生解析
    normalized = raw;
  } else {
    // naive 时间（含空格分隔）→ 补 Z 当 UTC
    normalized = `${raw.replace(" ", "T")}Z`;
  }

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO 字符串（可带微秒、可带/不带时区）→ "YYYY-MM-DD HH:mm:ss"（浏览器本地时区）；null/空/非法输入原样返回（非法串不要返回 "Invalid Date"） */
export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "";
  const raw = String(iso);
  // 纯空白视同空串
  if (!raw.trim()) return "";
  const d = parseIso(raw);
  if (!d) return raw;
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return `${date} ${time}`;
}

/** 同上 → "HH:mm:ss"；null/空/非法输入返回 "" */
export function formatTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "";
  const d = parseIso(String(iso));
  if (!d) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 去除行内 Markdown 标记 → 纯文本 */
export function stripInlineMd(text: string | null | undefined): string {
  if (text === null || text === undefined) return "";
  let s = String(text);
  if (!s) return "";

  // 1. 双重转义还原：字面量 \r\n / \n / \r / \t（反斜杠 + 字母）→ 真实空白
  s = s
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ");

  // 2. 图片 ![alt](url) → alt；链接 [文本](url) → 文本
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // 3. 行内代码 / 代码块围栏：去掉反引号，保留内容
  s = s.replace(/`+/g, "");

  // 4. 粗体 **x** / __x__
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");

  // 5. 斜体 *x* / _x_（下划线需词边界，避免破坏 snake_case）
  s = s.replace(/\*([^*\n]+)\*/g, "$1");
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1$2");

  // 6. 删除线 ~~x~~
  s = s.replace(/~~([^~]+)~~/g, "$1");

  // 7. 行首标记：标题 #、引用 >、无序列表 - / * / +、有序列表 1.
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  s = s.replace(/^[ \t]*>[ \t]?/gm, "");
  s = s.replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, "");

  // 8. 压缩多余空白（含换行）为单个空格，并去首尾
  return s.replace(/\s+/g, " ").trim();
}

/** 截断加省略号 "…"；maxLen 默认 40 */
export function truncateText(text: string | null | undefined, maxLen = 40): string {
  if (text === null || text === undefined) return "";
  const s = String(text);
  if (!s) return "";
  // maxLen 非法（非有限数或 ≤0）时不截断
  if (!Number.isFinite(maxLen) || maxLen <= 0) return s;
  const limit = Math.floor(maxLen);
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}…`;
}

/** 状态 → antd Tag color；未知状态回退 "default" */
export function statusColor(status: string | null | undefined): string {
  if (!status) return "default";
  const key = String(status).trim().toLowerCase();
  switch (key) {
    case "ok":
    case "success":
    case "active":
      return "green";
    case "partial":
    case "warning":
    case "paused":
      return "orange";
    case "error":
    case "failed":
      return "red";
    case "running":
    case "processing":
      return "blue";
    case "skip":
    case "skipped":
      return "default";
    default:
      return "default";
  }
}

/** stripInlineMd + truncateText（列表标题推荐用法，maxLen 默认 40） */
export function displayTitle(text: string | null | undefined, maxLen = 40): string {
  return truncateText(stripInlineMd(text), maxLen);
}

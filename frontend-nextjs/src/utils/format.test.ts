import { describe, expect, it } from "vitest";
import {
  displayTitle,
  formatDateTime,
  formatTime,
  statusColor,
  stripInlineMd,
  truncateText,
} from "./format";

/** 本地时区手工格式化（与实现同源，仅用于断言具体时刻等价，不依赖运行环境时区） */
function localParts(d: Date): string {
  const p = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const DATETIME_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const TIME_SHAPE = /^\d{2}:\d{2}:\d{2}$/;

describe("formatDateTime", () => {
  it("带微秒带时区的 ISO 串输出本地时间 YYYY-MM-DD HH:mm:ss", () => {
    expect(formatDateTime("2026-09-08T14:07:42.033674+00:00")).toMatch(DATETIME_SHAPE);
    expect(formatDateTime("2026-09-08T14:07:42.033674+00:00")).toBe(
      localParts(new Date("2026-09-08T14:07:42.033674+00:00")),
    );
  });

  it("不带时区的 naive 串按 UTC 解析（与显式 Z 结果一致）", () => {
    expect(formatDateTime("2026-09-08T14:07:42.033674")).toBe(
      formatDateTime("2026-09-08T14:07:42.033674Z"),
    );
    // 空格分隔的 naive 串同样按 UTC
    expect(formatDateTime("2026-09-08 14:07:42")).toBe(formatDateTime("2026-09-08T14:07:42Z"));
  });

  it("按时区偏移正确换算（+08:00 等同于早 8 小时的 UTC 时刻）", () => {
    expect(formatDateTime("2026-09-08T14:07:42+08:00")).toBe(
      formatDateTime("2026-09-08T06:07:42Z"),
    );
  });

  it("纯日期按 UTC 当日 00:00:00 解析", () => {
    expect(formatDateTime("2026-09-08")).toMatch(DATETIME_SHAPE);
    expect(formatDateTime("2026-09-08")).toBe(formatDateTime("2026-09-08T00:00:00Z"));
  });

  it("null / undefined / 空串返回空串", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime(undefined)).toBe("");
    expect(formatDateTime("")).toBe("");
    expect(formatDateTime("   ")).toBe("");
  });

  it("非法串原样返回，不产生 Invalid Date", () => {
    expect(formatDateTime("abc")).toBe("abc");
    expect(formatDateTime("2026-13-45")).toBe("2026-13-45");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("formatTime", () => {
  it("输出本地时间 HH:mm:ss", () => {
    expect(formatTime("2026-09-08T14:07:42Z")).toMatch(TIME_SHAPE);
    const d = new Date("2026-09-08T14:07:42Z");
    const p = (n: number): string => (n < 10 ? `0${n}` : String(n));
    expect(formatTime("2026-09-08T14:07:42Z")).toBe(
      `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
    );
  });

  it("与 formatDateTime 的时刻部分保持一致", () => {
    const iso = "2026-09-08T14:07:42.033674+00:00";
    expect(formatTime(iso)).toBe(formatDateTime(iso).slice(11));
  });

  it("naive 串按 UTC 解析", () => {
    expect(formatTime("2026-09-08T14:07:42.033674")).toBe(formatTime("2026-09-08T14:07:42.033674Z"));
    expect(formatTime("2026-09-08 14:07:42")).toBe(formatTime("2026-09-08T14:07:42Z"));
  });

  it("null / undefined / 空串 / 非法串返回空串", () => {
    expect(formatTime(null)).toBe("");
    expect(formatTime(undefined)).toBe("");
    expect(formatTime("")).toBe("");
    expect(formatTime("abc")).toBe("");
    expect(formatTime("2026-13-45")).toBe("");
  });
});

describe("stripInlineMd", () => {
  it("去除粗体 / 斜体 / 行内代码标记", () => {
    expect(stripInlineMd("**校务知识洞察**")).toBe("校务知识洞察");
    expect(stripInlineMd("__校务知识洞察__")).toBe("校务知识洞察");
    expect(stripInlineMd("*斜体标题*")).toBe("斜体标题");
    expect(stripInlineMd("_斜体标题_")).toBe("斜体标题");
    expect(stripInlineMd("`code`")).toBe("code");
  });

  it("去除行首标题 / 引用 / 列表标记", () => {
    expect(stripInlineMd("# 标题")).toBe("标题");
    expect(stripInlineMd("### 三级标题")).toBe("三级标题");
    expect(stripInlineMd("> 引用内容")).toBe("引用内容");
    expect(stripInlineMd("- 列表项")).toBe("列表项");
    expect(stripInlineMd("* 列表项")).toBe("列表项");
    expect(stripInlineMd("+ 列表项")).toBe("列表项");
    expect(stripInlineMd("1. 有序项")).toBe("有序项");
  });

  it("链接保留文本、图片保留 alt", () => {
    expect(stripInlineMd("[通知公告](https://x/y)")).toBe("通知公告");
    expect(stripInlineMd("![封面图](https://x/y.png)")).toBe("封面图");
  });

  it("字面量转义序列 \\n / \\r\\n / \\t 先还原为空白再清洗", () => {
    expect(stripInlineMd("第一行\\n第二行")).toBe("第一行 第二行");
    expect(stripInlineMd("第一行\\r\\n第二行")).toBe("第一行 第二行");
    expect(stripInlineMd("字段A\\t字段B")).toBe("字段A 字段B");
    expect(stripInlineMd("**校务知识洞察**\\n## 小标题")).toBe("校务知识洞察 小标题");
  });

  it("真实换行与多余空白折叠为单个空格", () => {
    expect(stripInlineMd("## 标题\n\n正文 **加粗**")).toBe("标题 正文 加粗");
    expect(stripInlineMd("  **标题**   ")).toBe("标题");
  });

  it("null / undefined / 空串返回空串", () => {
    expect(stripInlineMd(null)).toBe("");
    expect(stripInlineMd(undefined)).toBe("");
    expect(stripInlineMd("")).toBe("");
  });

  it("已是纯文本时保持不变（含 snake_case）", () => {
    expect(stripInlineMd("普通标题")).toBe("普通标题");
    expect(stripInlineMd("last_crawled_at")).toBe("last_crawled_at");
  });
});

describe("truncateText", () => {
  it("默认按 40 字符截断并追加省略号", () => {
    const long = "校".repeat(50);
    const out = truncateText(long);
    expect(out.length).toBe(41);
    expect(out).toBe(`${"校".repeat(40)}…`);
  });

  it("超长文本自定义 maxLen 生效", () => {
    expect(truncateText("abcdefghij", 5)).toBe("abcde…");
    expect(truncateText("abcdefghij", 10)).toBe("abcdefghij");
  });

  it("长度不超过 maxLen 时原样返回（不加省略号）", () => {
    expect(truncateText("短标题")).toBe("短标题");
    expect(truncateText("正好八个字符", 8)).toBe("正好八个字符");
  });

  it("本函数只做截断、不清洗 Markdown（由调用方决定）", () => {
    expect(truncateText("**abc**")).toBe("**abc**");
  });

  it("null / undefined / 空串返回空串", () => {
    expect(truncateText(null)).toBe("");
    expect(truncateText(undefined)).toBe("");
    expect(truncateText("")).toBe("");
  });

  it("maxLen 非法（0 / 负数）时不截断", () => {
    expect(truncateText("abcdefghij", 0)).toBe("abcdefghij");
    expect(truncateText("abcdefghij", -3)).toBe("abcdefghij");
  });
});

describe("statusColor", () => {
  it("正常态映射绿色", () => {
    expect(statusColor("ok")).toBe("green");
    expect(statusColor("success")).toBe("green");
    expect(statusColor("active")).toBe("green");
  });

  it("部分完成 / 告警态映射橙色", () => {
    expect(statusColor("partial")).toBe("orange");
    expect(statusColor("warning")).toBe("orange");
    expect(statusColor("paused")).toBe("orange");
  });

  it("异常态映射红色，进行中映射蓝色", () => {
    expect(statusColor("error")).toBe("red");
    expect(statusColor("failed")).toBe("red");
    expect(statusColor("running")).toBe("blue");
    expect(statusColor("processing")).toBe("blue");
  });

  it("跳过态与未知状态回退 default", () => {
    expect(statusColor("skip")).toBe("default");
    expect(statusColor("skipped")).toBe("default");
    expect(statusColor("weird-status")).toBe("default");
  });

  it("null / undefined / 空串回退 default", () => {
    expect(statusColor(null)).toBe("default");
    expect(statusColor(undefined)).toBe("default");
    expect(statusColor("")).toBe("default");
  });

  it("大小写与空白不敏感", () => {
    expect(statusColor(" OK ")).toBe("green");
    expect(statusColor("Failed")).toBe("red");
  });
});

describe("displayTitle", () => {
  it("清洗 + 截断组合生效", () => {
    expect(displayTitle("**校务知识洞察**")).toBe("校务知识洞察");
    expect(displayTitle("# 通知公告")).toBe("通知公告");
    expect(displayTitle("[通知公告](https://x/y)")).toBe("通知公告");
  });

  it("默认 maxLen 为 40", () => {
    const long = `**${"校".repeat(50)}**`;
    const out = displayTitle(long);
    expect(out.length).toBe(41);
    expect(out.endsWith("…")).toBe(true);
  });

  it("自定义 maxLen 生效", () => {
    expect(displayTitle("**一二三四五六七八九十**", 4)).toBe("一二三四…");
  });

  it("字面量 \\n 与真实换行都被折叠", () => {
    expect(displayTitle("标题\\n正文")).toBe("标题 正文");
    expect(displayTitle("## 标题\n\n正文")).toBe("标题 正文");
  });

  it("null / undefined / 空串返回空串", () => {
    expect(displayTitle(null)).toBe("");
    expect(displayTitle(undefined)).toBe("");
    expect(displayTitle("")).toBe("");
  });

  it("等价于 truncateText(stripInlineMd(text))", () => {
    const raw = "  **校务知识洞察**：本周新增 12 条通知公告，含学籍异动与选课安排  ";
    expect(displayTitle(raw, 20)).toBe(truncateText(stripInlineMd(raw), 20));
  });
});

// @vitest-environment jsdom
/**
 * B4：`date` 字段受控回显（+ dayjs 显式声明）
 *
 * 背景：为避开 dayjs 依赖，上一轮把 DatePicker 做成非受控，导致"程序化写入的日期串不回显"。
 * 现在 dayjs 已在 package.json 显式声明（antd 的既有直接依赖，体积零变化），改为受控实现。
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SchemaForm, { toDayjs } from "../../src/components/SchemaForm";
import type { ConfigSchema } from "../../src/services/api";

const DATE_SCHEMA: ConfigSchema = {
  name: "closed_loop",
  version: 1,
  groups: [
    {
      key: "collect",
      title: "实时采集",
      fields: [
        { key: "since", type: "date", default: null, label: "发布时间起" },
        { key: "until", type: "date", default: null, label: "发布时间止" },
      ],
    },
  ],
};

describe("toDayjs（回显解析）", () => {
  it("合法 YYYY-MM-DD 解析为 Dayjs", () => {
    const parsed = toDayjs("2026-09-01");
    expect(parsed).not.toBeNull();
    expect(parsed?.format("YYYY-MM-DD")).toBe("2026-09-01");
  });

  it("空值/非法值/非字符串一律返回 null（避免 antd Invalid Date）", () => {
    expect(toDayjs(null)).toBeNull();
    expect(toDayjs("")).toBeNull();
    expect(toDayjs(undefined)).toBeNull();
    expect(toDayjs("2026/09/01")).toBeNull(); // 非严格格式
    expect(toDayjs("不是日期")).toBeNull();
  });
});

describe("SchemaForm date 字段受控（B4）", () => {
  it("程序化写入的日期串能正确回显", () => {
    render(
      <SchemaForm
        schema={DATE_SCHEMA}
        value={{ since: "2026-09-01", until: "2026-09-08" }}
        onChange={vi.fn()}
      />,
    );

    const since = screen.getByLabelText("发布时间起") as HTMLInputElement;
    const until = screen.getByLabelText("发布时间止") as HTMLInputElement;
    expect(since.value).toBe("2026-09-01");
    expect(until.value).toBe("2026-09-08");
  });

  it("未设置时为空（placeholder 可见）", () => {
    render(<SchemaForm schema={DATE_SCHEMA} value={{ since: null }} onChange={vi.fn()} />);
    const since = screen.getByLabelText("发布时间起") as HTMLInputElement;
    expect(since.value).toBe("");
    expect(since.placeholder).toBe("请选择日期");
  });
});

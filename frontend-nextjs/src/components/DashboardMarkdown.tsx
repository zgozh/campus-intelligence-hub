"use client";

import type { ComponentProps } from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * react-markdown `code` 组件的显式 props 类型：
 * v10 的 `Components['code']` = `JSX.IntrinsicElements['code'] & ExtraProps`，
 * 这里就地展开，避免 `any`（禁 any）也避免依赖隐式的全局 JSX 命名空间。
 * `inline` 为历史遗留可选字段（v9 起不再传入，见 `isBlockCode`）。
 */
type CodeProps = ComponentProps<"code"> & ExtraProps & { inline?: boolean };

/**
 * 块级代码判定：react-markdown v9 起**不再传 `inline`**（v10 已彻底移除），
 * 行内/块级只能靠 `language-*` class 区分；`inline` 若未来恢复则优先采用。
 */
function isBlockCode(inline: boolean | undefined, className: unknown): boolean {
  if (typeof inline === "boolean") return !inline;
  return typeof className === "string" && /(^|\s)language-/.test(className);
}

/** 校务页专用 markdown 渲染（纯内联样式，不依赖 Chat 主题的 CSS 变量，避免 `**` 裸显）。 */
export default function DashboardMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p style={{ margin: "0 0 0.6rem 0", lineHeight: 1.7 }}>{children}</p>,
        ul: ({ children }) => <ul style={{ margin: "0 0 0.6rem 0", paddingLeft: 20 }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ margin: "0 0 0.6rem 0", paddingLeft: 20 }}>{children}</ol>,
        li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
        strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#1677ff" }}>
            {children}
          </a>
        ),
        code: ({ inline, className, children }: CodeProps) =>
          isBlockCode(inline, className) ? (
            <code style={{ display: "block", background: "#f6f6f6", borderRadius: 6, padding: "8px 12px", whiteSpace: "pre-wrap", fontSize: "0.9em" }}>{children}</code>
          ) : (
            <code style={{ background: "#f0f0f0", borderRadius: 4, padding: "0 4px", fontSize: "0.9em" }}>{children}</code>
          ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

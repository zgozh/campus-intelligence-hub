"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
        code: ({ inline, children }: any) =>
          inline ? (
            <code style={{ background: "#f0f0f0", borderRadius: 4, padding: "0 4px", fontSize: "0.9em" }}>{children}</code>
          ) : (
            <code style={{ display: "block", background: "#f6f6f6", borderRadius: 6, padding: "8px 12px", whiteSpace: "pre-wrap", fontSize: "0.9em" }}>{children}</code>
          ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

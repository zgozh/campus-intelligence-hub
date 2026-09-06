"""知识整理（规则版）：summary 截断 + 专题域 tags。LLM 摘要留待增强。"""


def summarize(content: str, max_len: int = 200) -> str:
    text = (content or "").strip()
    if len(text) <= max_len:
        return text
    return text[:max_len] + "…"

"""文本清洗工具（REFACTOR_PLAN_V2 T9）：从 Markdown 正文提取干净标题。

单一出口，供生成侧（洞察/快讯落库时写 title）与迁移脚本（历史数据回填）共用，
与前端 `src/utils/format.ts` 的 stripInlineMd 语义对齐，避免"未转义"问题复发。
"""
import re


def clean_title(content: str | None, limit: int = 60) -> str:
    """从 Markdown 正文提取干净标题：取首个非空行 → 去 Markdown 标记 → 截断。"""
    if not content:
        return ""
    first = ""
    for raw_line in str(content).replace("\\n", "\n").splitlines():
        line = raw_line.strip()
        if line:
            first = line
            break
    if not first:
        return ""
    # 图片 ![alt](url) → alt
    first = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", first)
    # 链接 [文本](url) → 文本
    first = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", first)
    # 行首标题 / 引用 / 列表标记
    first = re.sub(r"^\s*#{1,6}\s*", "", first)
    first = re.sub(r"^\s*>\s*", "", first)
    first = re.sub(r"^\s*[-*+]\s+", "", first)
    first = re.sub(r"^\s*\d+\.\s+", "", first)
    # 粗体 / 斜体 / 行内代码
    first = re.sub(r"\*\*(.+?)\*\*", r"\1", first)
    first = re.sub(r"__(.+?)__", r"\1", first)
    first = re.sub(r"\*(.+?)\*", r"\1", first)
    first = re.sub(r"`(.+?)`", r"\1", first)
    first = re.sub(r"\s+", " ", first).strip()
    if len(first) > limit:
        first = first[:limit]
    return first

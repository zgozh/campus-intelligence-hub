"""文档指纹（spec §7.1）：normalized_url + content_hash + canonical_title + publish_time。"""
import re

from collectors.dedup import content_hash


def canonical_title(title: str) -> str:
    """规范化标题：去空白 + 去常见站点后缀（用于「标题相同」判断）。"""
    t = (title or "").strip()
    t = re.sub(r"\s+", " ", t)
    for suffix in ("-广州大学", "_广州大学", "｜广州大学", "| 广州大学", "—广州大学"):
        if t.endswith(suffix):
            t = t[: -len(suffix)].strip()
    return t


def fingerprint(
    normalized_url: str, title: str, content: str, publish_time: str | None
) -> dict:
    """计算文档指纹，用于判断同一网页/内容是否变化。"""
    return {
        "normalized_url": normalized_url,
        "content_hash": content_hash(content or ""),
        "canonical_title": canonical_title(title),
        "publish_time": publish_time,
    }

"""正文提取：trafilatura 为主，正则提取标题/日期/部门（迁移自 school-knowledge-hub，LLM 兜底留待 EPIC6）。"""
import re
from dataclasses import dataclass

import trafilatura

from collectors.base import RawArticle


@dataclass
class ParsedArticle:
    url: str
    title: str
    content: str
    publish_date: str | None
    department: str | None
    source_site: str
    column: str


def extract_article(raw: RawArticle) -> ParsedArticle:
    text = trafilatura.extract(raw.html, include_comments=False, include_tables=False) or ""
    title = _extract_title(raw.html) or raw.title
    publish_date = _extract_date(raw.html) or raw.publish_date
    department = _extract_department(raw.html)
    return ParsedArticle(
        url=raw.url,
        title=title,
        content=text.strip(),
        publish_date=publish_date,
        department=department,
        source_site=raw.source_site,
        column=raw.column,
    )


def _extract_title(html: str) -> str:
    for tag in ("<h1[^>]*>(.*?)</h1>", "<title[^>]*>(.*?)</title>"):
        m = re.search(tag, html, re.S | re.I)
        if m:
            return re.sub(r"<[^>]+>", "", m.group(1)).strip()
    return ""


def _extract_date(html: str) -> str | None:
    m = re.search(r"(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})", html)
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def _extract_department(html: str) -> str | None:
    m = re.search(r"来源[:：]\s*([^\s<&]{2,30})", html)
    return m.group(1).strip() if m else None

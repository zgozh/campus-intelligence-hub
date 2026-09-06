"""站点适配器基类与文章数据模型（迁移自 school-knowledge-hub）。"""
from dataclasses import dataclass

from selectolax.parser import HTMLParser


@dataclass
class ArticleRef:
    """列表页条目引用。"""
    url: str
    title: str
    publish_date: str | None = None


@dataclass
class RawArticle:
    """详情页抓取的原始文章。"""
    url: str
    title: str
    html: str
    publish_date: str | None
    source_site: str
    column: str


class SiteAdapter:
    """站点适配器基类：列表页解析 + 详情页解析。"""

    site: str = ""

    def parse_list(self, html: str, base_url: str) -> list[ArticleRef]:
        raise NotImplementedError

    def parse_detail(self, html: str, ref: ArticleRef) -> RawArticle:
        raise NotImplementedError

    def _abs_url(self, base_url: str, href: str) -> str:
        if href.startswith("http"):
            return href
        return base_url.rsplit("/", 1)[0] + "/" + href.lstrip("./")

    def _text(self, node, default: str = "") -> str:
        return node.text(strip=True) if node is not None else default

    def next_page_url(self, html: str, base_url: str) -> str | None:
        """列表页下一页绝对 URL；默认 None = 不翻页（站点翻页能力由子适配器实现）。"""
        return None

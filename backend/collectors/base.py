"""站点适配器基类与文章数据模型（迁移自 school-knowledge-hub）。"""
import re
from dataclasses import dataclass
from urllib.parse import urlparse

from selectolax.parser import HTMLParser


@dataclass
class ArticleRef:
    """列表页条目引用。"""
    url: str
    title: str
    publish_date: str | None = None
    # 该条目所属栏目（由列表页推导，见 SiteAdapter.column_for_list_page）
    column: str | None = None


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
    """站点适配器基类：列表页解析 + 详情页解析 + 栏目推导。

    栏目（column）是"采集内容筛选"的取值空间。历史实现把栏目写死在 parse_detail 里
    （每个适配器只能产出唯一栏目），导致前端栏目下拉形同虚设；现改为按**列表页**推导：
    显式声明（declared_columns）优先，其次读页面自身导航/面包屑，再次按带分隔符的 title
    取栏目名，最后回退 default_column。
    """

    site: str = ""
    # 显式栏目映射：{栏目名: URL 路径片段}（可信来源，优先匹配；路径包含片段即命中）
    declared_columns: dict[str, str] = {}
    # 无法推导时的兜底栏目（保持历史行为，避免生成垃圾栏目名）
    default_column: str = "综合"

    def parse_list(self, html: str, base_url: str) -> list[ArticleRef]:
        raise NotImplementedError

    def parse_detail(self, html: str, ref: ArticleRef) -> RawArticle:
        raise NotImplementedError

    # 页面自身承载栏目名的常见位置（CMS 的"当前栏目"高亮/面包屑）
    COLUMN_SELECTORS = (
        "a.cur",
        "a.current",
        ".current a",
        "li.on a",
        "li.active a",
        ".breadcrumb a:last-child",
        ".position a:last-child",
        ".location a:last-child",
    )
    TITLE_SEPARATORS = ("-", "_", "|", "—", "·", "－")

    def column_for_list_page(self, html: str, base_url: str) -> str:
        """按列表页推导栏目名；无法可靠推导时回退 default_column（不猜、不造）。"""
        path = (urlparse(base_url).path or "").lower()
        for name, fragment in self.declared_columns.items():
            if fragment and fragment.lower() in path:
                return name

        tree = HTMLParser(html) if html else None
        if tree is not None:
            for selector in self.COLUMN_SELECTORS:
                node = tree.css_first(selector)
                text = self._text(node) if node is not None else ""
                if 2 <= len(text) <= 20:
                    return text
            title_node = tree.css_first("title")
            raw_title = self._text(title_node) if title_node is not None else ""
            for sep in self.TITLE_SEPARATORS:
                if sep in raw_title:
                    candidate = raw_title.split(sep)[0].strip()
                    # 只有"栏目-站点"这种结构才可信（避免把站点名当栏目）
                    if 2 <= len(candidate) <= 20:
                        return candidate
                    break
        return self.default_column

    def declared_column_names(self) -> list[str]:
        """适配器声明的栏目名清单（供栏目发现接口补 count=0 的可选项）。"""
        names = [self.default_column] if self.default_column else []
        names.extend(self.declared_columns.keys())
        seen: list[str] = []
        for name in names:
            if name and name not in seen:
                seen.append(name)
        return seen

    def _abs_url(self, base_url: str, href: str) -> str:
        if href.startswith("http"):
            return href
        return base_url.rsplit("/", 1)[0] + "/" + href.lstrip("./")

    def _text(self, node, default: str = "") -> str:
        return node.text(strip=True) if node is not None else default

    def next_page_url(self, html: str, base_url: str) -> str | None:
        """列表页下一页绝对 URL；默认 None = 不翻页（站点翻页能力由子适配器实现）。"""
        return None

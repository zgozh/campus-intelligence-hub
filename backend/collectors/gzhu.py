"""广州大学主站适配器（www.gzhu.edu.cn 通知公告等栏目，迁移自 school-knowledge-hub）。"""
import re

from selectolax.parser import HTMLParser

from collectors.base import ArticleRef, RawArticle
from collectors.gzhu_cms import GUZhuCMSAdapter


class GUZhuAdapter(GUZhuCMSAdapter):
    site = "gzhu"
    # 已知栏目映射（栏目名 → 列表页路径片段）：命中即用，保证既有"通知公告"数据语义不变
    declared_columns = {
        "通知公告": "/z__l/tzgg",
    }
    default_column = "通知公告"

    def _abs_url(self, base_url: str, href: str) -> str:
        """gzhu 列表页位于 /z__l/ 等目录，但文章 href 以站点根 /info/ 起步，必须拼到域名根。"""
        if href.startswith("http"):
            return href
        root = re.match(r"(https?://[^/]+)", base_url).group(1)
        return root + "/" + href.lstrip("./")

    def parse_list(self, html: str, base_url: str) -> list[ArticleRef]:
        tree = HTMLParser(html)
        column = self.column_for_list_page(html, base_url)
        refs: list[ArticleRef] = []
        for li in tree.css("li"):
            a = li.css_first("a[href]")
            if a is None or "info/" not in (a.attributes.get("href") or ""):
                continue
            date_node = li.css_first("span")
            refs.append(ArticleRef(
                url=self._abs_url(base_url, a.attributes["href"]),
                title=a.attributes.get("title") or self._text(a),
                publish_date=self._text(date_node) if date_node else None,
                column=column,
            ))
        return refs

    def parse_detail(self, html: str, ref: ArticleRef) -> RawArticle:
        tree = HTMLParser(html)
        title_node = tree.css_first("h1") or tree.css_first("title")
        title = self._text(title_node, ref.title) or ref.title
        date_node = tree.css_first("p.date, .date, span.date")
        date_text = self._text(date_node) if date_node else (ref.publish_date or "")
        m = re.search(r"(\d{4}-\d{1,2}-\d{1,2})", date_text)
        return RawArticle(
            url=ref.url,
            title=title,
            html=html,
            publish_date=m.group(1) if m else ref.publish_date,
            source_site=self.site,
            # 栏目来自列表页推导（不再写死），保证"可选的栏目"与"能筛到的数据"同源
            column=ref.column or self.default_column,
        )

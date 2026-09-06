"""广州大学新闻网适配器（news.gzhu.edu.cn，迁移自 school-knowledge-hub）。"""
import re

from selectolax.parser import HTMLParser

from collectors.base import ArticleRef, RawArticle
from collectors.gzhu_cms import GUZhuCMSAdapter


class GUNewsAdapter(GUZhuCMSAdapter):
    site = "gznews"

    def parse_list(self, html: str, base_url: str) -> list[ArticleRef]:
        tree = HTMLParser(html)
        refs: list[ArticleRef] = []
        for li in tree.css("ul li"):
            a = li.css_first("a[href]")
            if a is None or "info/" not in (a.attributes.get("href") or ""):
                continue
            date_node = li.css_first("span, .date")
            refs.append(ArticleRef(
                url=self._abs_url(base_url, a.attributes["href"]),
                title=a.attributes.get("title") or self._text(a),
                publish_date=self._text(date_node) if date_node else None,
            ))
        return refs

    def parse_detail(self, html: str, ref: ArticleRef) -> RawArticle:
        tree = HTMLParser(html)
        title_node = tree.css_first("h1") or tree.css_first("title")
        title = self._text(title_node, ref.title) or ref.title
        date_text = ref.publish_date or ""
        m = re.search(r"(\d{4}-\d{1,2}-\d{1,2})", date_text)
        return RawArticle(
            url=ref.url,
            title=title,
            html=html,
            publish_date=m.group(1) if m else ref.publish_date,
            source_site=self.site,
            column="新闻动态",
        )

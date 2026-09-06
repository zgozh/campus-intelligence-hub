"""gzhu CMS 共享层：列表页底部分页「下页」链接解析（gzhu/gznews 共用，迁移自 school-knowledge-hub）。"""
from urllib.parse import urljoin

from selectolax.parser import HTMLParser

from collectors.base import SiteAdapter


class GUZhuCMSAdapter(SiteAdapter):
    """gzhu 系 CMS 适配器共享基类：实现翻页；站点差异（_abs_url/栏目/选择器）由子类保留。"""

    def next_page_url(self, html: str, base_url: str) -> str | None:
        # 下页形如 <a href="tzgg/8.htm" class="Next">下页</a>；末页为 <span class="NextDisabled">下页</span>
        tree = HTMLParser(html)
        a = tree.css_first("a.Next")
        if a is None:
            return None
        href = a.attributes.get("href")
        if not href:
            return None
        # 分页 href 是相对路径，须 urljoin（不能用 gzhu._abs_url 的域名根拼接——那是为 /info/ 文章链接设计的）
        return urljoin(base_url, href)

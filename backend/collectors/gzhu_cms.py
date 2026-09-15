"""gzhu CMS 共享层：文章链接绝对化 + 列表页底部分页「下页」链接解析（gzhu/gznews 共用）。"""
import re
from urllib.parse import urljoin

from selectolax.parser import HTMLParser

from collectors.base import SiteAdapter


class GUZhuCMSAdapter(SiteAdapter):
    """gzhu 系 CMS 适配器共享基类：实现链接绝对化与翻页；站点差异（栏目/选择器）由子类保留。"""

    def _abs_url(self, base_url: str, href: str) -> str:
        """gzhu 系 CMS：文章挂在**域名根**的 /info/ 下，而列表页可能在 /z__l/ 等子目录。

        所以必须拼到域名根，不能按页面相对路径解析。该方法原先只写在 GUZhuAdapter 上，
        导致 GUNewsAdapter 落到基类的旧实现、把 https://news.gzhu.edu.cn 的文章链接
        拼成 https://info/...（host 丢失）→ 全部被 SSRF 拦下 → 新闻网恒 0 条。
        注意：分页 href 语义不同，走 next_page_url 里的 urljoin。
        """
        if href.startswith("http"):
            return href
        root = re.match(r"(https?://[^/]+)", base_url)
        if not root:
            return href
        return root.group(1) + "/" + href.lstrip("./")

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

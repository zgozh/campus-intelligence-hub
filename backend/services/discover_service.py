"""自动发现（spec §11）：输入 URL，爬取页面，发现同域候选栏目/部门链接（Allowed Domain 限定）。"""
import logging
from urllib.parse import urljoin, urlparse

import httpx
from selectolax.parser import HTMLParser

logger = logging.getLogger(__name__)

SKIP_EXT = (
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".pdf", ".doc", ".docx",
    ".xls", ".xlsx", ".zip", ".rar", ".7z", ".css", ".js", "#",
)
SKIP_PATH_KEYWORDS = ("news", "media", "photo", "image", "logo", "css", "js", "json", "upload", "local")


async def discover_sources(url: str, max_links: int = 20) -> dict:
    """发现同域候选栏目/部门链接。失败抛异常（由端点转 400）。"""
    base = urlparse(url)
    origin = f"{base.scheme}://{base.netloc}"
    headers = {"User-Agent": "Mozilla/5.0 (compatible; CampusHub/2.0)"}
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers=headers) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        tree = HTMLParser(resp.text)

        found: list[dict] = []
        seen: set[str] = set()
        for a in tree.css("a[href]"):
            href = a.attributes.get("href") or ""
            title = (a.text() or "").strip()
            if not href or not title:
                continue
            if href.startswith(("javascript:", "mailto:", "tel:")):
                continue
            abs_url = urljoin(url, href)
            p = urlparse(abs_url)
            if p.netloc != base.netloc:  # 仅同域（Allowed Domain）
                continue
            if p.path in ("", "/"):
                continue
            if p.path.endswith(SKIP_EXT) or any(k in p.path.lower() for k in SKIP_PATH_KEYWORDS):
                continue
            if abs_url in seen:
                continue
            seen.add(abs_url)
            found.append({"name": title[:80], "url": abs_url, "type": "list_page", "domain": p.netloc})
            if len(found) >= max_links:
                break

        return {"base_url": url, "origin": origin, "discovered": found, "total": len(found)}

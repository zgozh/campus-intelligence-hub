"""T14 采集礼貌与安全测试：请求间隔可配 + 采集链路全部 URL 过 SSRF 校验（含开关）。

对齐 REFACTOR_PLAN_V2 T14（建议优化项）：本轮只做"单次条数硬上限 + 失败重试 1 次 + 复用
url_safety"，域级限速/robots 解析列入 backlog。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from collectors.base import ArticleRef, RawArticle, SiteAdapter  # noqa: E402
from collectors.engine import CrawlEngine  # noqa: E402
from config import settings  # noqa: E402
from services import collection_service  # noqa: E402
from services.url_safety import validate_url_safe  # noqa: E402


class _FakeResponse:
    def __init__(self, text: str = "<html></html>"):
        self.text = text

    def raise_for_status(self):
        return None


class _FakeHttp:
    """记录请求 URL 的替身 HTTP 客户端。"""

    def __init__(self, pages: dict[str, str] | None = None):
        self.calls: list[str] = []
        self.pages = pages or {}

    async def get(self, url: str):
        self.calls.append(url)
        return _FakeResponse(self.pages.get(url, "<html></html>"))

    async def aclose(self):
        return None


class _FakeAdapter(SiteAdapter):
    site = "fake"

    def __init__(self, refs_per_page: int = 1, next_page: str | None = None):
        self.refs_per_page = refs_per_page
        self.next_page = next_page

    def parse_list(self, html: str, base_url: str) -> list[ArticleRef]:
        return [
            ArticleRef(url=f"{base_url}#a{i}", title=f"t{i}", publish_date="2026-09-08")
            for i in range(self.refs_per_page)
        ]

    def parse_detail(self, html: str, ref: ArticleRef) -> RawArticle:
        return RawArticle(
            url=ref.url,
            title=ref.title,
            html=html,
            publish_date=ref.publish_date,
            source_site=self.site,
            column="通知公告",
        )

    def next_page_url(self, html: str, base_url: str) -> str | None:
        return self.next_page


class TestRequestInterval:
    async def test_interval_is_respected(self, setup_test_db, monkeypatch):
        """同站点连续请求之间保持最小间隔（礼貌抓取）。"""
        monkeypatch.setattr(settings, "campus_collect_interval_ms", 60, raising=False)
        monkeypatch.setattr(settings, "campus_collect_ssrf_check", False, raising=False)

        http = _FakeHttp()
        engine = CrawlEngine(http_client=http)
        adapter = _FakeAdapter(refs_per_page=0, next_page="https://x.edu.cn/list2.htm")

        started = time.monotonic()
        await engine.fetch_source("https://x.edu.cn/list.htm", adapter, max_pages=2)
        elapsed = time.monotonic() - started

        assert http.calls == ["https://x.edu.cn/list.htm", "https://x.edu.cn/list2.htm"]
        assert elapsed >= 0.06, elapsed

    async def test_interval_zero_disables_throttle(self, setup_test_db, monkeypatch):
        monkeypatch.setattr(settings, "campus_collect_interval_ms", 0, raising=False)
        monkeypatch.setattr(settings, "campus_collect_ssrf_check", False, raising=False)

        http = _FakeHttp()
        engine = CrawlEngine(http_client=http)
        adapter = _FakeAdapter(refs_per_page=0, next_page="https://x.edu.cn/list2.htm")

        started = time.monotonic()
        await engine.fetch_source("https://x.edu.cn/list.htm", adapter, max_pages=2)
        assert (time.monotonic() - started) < 0.5


class TestSsrfGuard:
    async def test_blocked_list_url_raises_before_request(self, setup_test_db):
        http = _FakeHttp()
        engine = CrawlEngine(http_client=http)
        adapter = _FakeAdapter(refs_per_page=0)

        try:
            await engine.fetch_source("http://127.0.0.1/list.htm", adapter, max_pages=1)
            raise AssertionError("应当因 SSRF 校验失败抛错")
        except RuntimeError as e:
            assert "URL 安全校验未通过" in str(e)
        assert http.calls == []  # 被拦 URL 绝不发出请求

    async def test_blocked_detail_url_recorded_as_failure(self, setup_test_db, monkeypatch):
        """详情页 URL 同样过校验：被拦的记为失败，其余正常抓取。"""
        monkeypatch.setattr(settings, "campus_collect_interval_ms", 0, raising=False)
        monkeypatch.setattr(
            CrawlEngine,
            "_ssrf_reason",
            staticmethod(lambda url: "命中内网地址" if "evil" in url else None),
        )

        http = _FakeHttp()
        engine = CrawlEngine(http_client=http)
        adapter = _FakeAdapter(refs_per_page=2)
        # 把第二条 ref 改成内网 URL
        original_parse_list = adapter.parse_list

        def parse_list(html, base_url):
            refs = original_parse_list(html, base_url)
            refs[1] = ArticleRef(url="http://169.254.169.254/evil", title="evil")
            return refs

        adapter.parse_list = parse_list  # type: ignore[method-assign]

        articles, failures, _ = await engine.fetch_source(
            "https://x.edu.cn/list.htm", adapter, max_pages=1
        )

        assert len(articles) == 1
        assert len(failures) == 1
        assert "169.254.169.254" in failures[0]["url"]
        assert "URL 安全校验未通过" in failures[0]["error"]
        assert all("169.254.169.254" not in call for call in http.calls)

    async def test_toggle_off_bypasses_check(self, setup_test_db, monkeypatch):
        monkeypatch.setattr(settings, "campus_collect_ssrf_check", False, raising=False)
        assert CrawlEngine._ssrf_reason("http://127.0.0.1/x") is None

    async def test_url_safety_still_blocks_known_cases(self, setup_test_db):
        """回归护栏：采集改造不得削弱既有 SSRF 防护。"""
        for url in (
            "http://127.0.0.1/x",
            "http://localhost/x",
            "http://169.254.169.254/latest/meta-data",
            "file:///etc/passwd",
            "http://user:pass@example.com/x",
        ):
            ok, reason = validate_url_safe(url)
            assert ok is False, url
            assert reason


class TestLimitsAreCentralized:
    def test_max_items_hard_limit_comes_from_settings(self):
        assert collection_service.MAX_ITEMS_HARD_LIMIT == max(
            1, int(settings.campus_collect_max_items)
        )

    def test_config_schema_max_items_not_above_hard_limit(self):
        from services.config_schema_service import get_schema

        fields = {f["key"]: f for f in get_schema("collection")["groups"][0]["fields"]}
        assert fields["max_items"]["max"] <= collection_service.MAX_ITEMS_HARD_LIMIT

"""采集链路缺陷回归测试（本轮 bug 排查：「页数不生效」+「其他数据源恒 0 条」）。

一个架构错配被拆成 6 项可回归的修复：
  F1 基类 `_abs_url` 在「裸域名 base_url」下丢 host —— 新闻网 16 条全被 SSRF 拦的根因
  F2 抓取 0 条仍静默记 SUCCESS —— 教务处 0 条却显示"成功"、无从排查的根因
  F3 适配器按域名子串误选 —— 教务处被交给专为主站首页写的解析器
  F4 max_pages=0（「全部（最多 50 页）」）被 `or 1` 吃掉，退化成 1 页
  F5 采集链路不读 source.max_pages —— 调度链路（不传 params）永远只抓 1 页
  F6 无翻页时不可观测 —— 页数静默失效，人只能靠条数猜
"""
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from collectors.base import ArticleRef, RawArticle, SiteAdapter  # noqa: E402
from collectors.engine import CrawlEngine  # noqa: E402
from collectors.gzhu import GUZhuAdapter  # noqa: E402
from collectors.gznews import GUNewsAdapter  # noqa: E402
from config import settings  # noqa: E402
from models import CollectionJob, Source  # noqa: E402
from parser.extract import ParsedArticle  # noqa: E402
from services import collection_service  # noqa: E402


# ─────────────────────────── 替身 ───────────────────────────


class _FakeResponse:
    def __init__(self, text: str = "<html></html>"):
        self.text = text

    def raise_for_status(self):
        return None


class _FakeHttp:
    def __init__(self):
        self.calls: list[str] = []

    async def get(self, url: str):
        self.calls.append(url)
        return _FakeResponse("<html></html>")

    async def aclose(self):
        return None


class _FakeAdapter(SiteAdapter):
    """可配置"每页几条 + 有没有下一页"的替身适配器。"""

    site = "fake"

    def __init__(self, refs_per_page: int = 0, next_page: str | None = None):
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


class _RecordingEngine:
    """替身引擎：记录收到的 max_pages，按类属性返回固定文章列表。"""

    last_max_pages: int | None = None
    articles: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def fetch_source(self, base_url, adapter, max_pages=1):
        type(self).last_max_pages = max_pages
        return list(type(self).articles), [], None

    async def close(self):
        pass


def _article(url: str = "https://www.gzhu.edu.cn/info/1087/38277.htm") -> RawArticle:
    return RawArticle(
        url=url,
        title="关于2026年下半年中小学教师资格考试安排的公告",
        html="<html><body><p>正文</p></body></html>",
        publish_date="2026-09-08",
        source_site="gzhu",
        column="通知公告",
    )


def _fake_extract(raw: RawArticle) -> ParsedArticle:
    return ParsedArticle(
        url=raw.url,
        title=raw.title,
        content="校务公告正文内容" * 30,
        publish_date=raw.publish_date,
        department="教务处",
        source_site=raw.source_site,
        column=raw.column,
    )


async def _make_source(db, name: str, base_url: str = "https://www.gzhu.edu.cn", **kwargs) -> Source:
    src = Source(name=name, source_type="website", base_url=base_url, **kwargs)
    db.add(src)
    await db.commit()
    await db.refresh(src)
    return src


def _wire_fake_engine(monkeypatch, articles: list) -> None:
    monkeypatch.setattr(collection_service, "AsyncSessionLocal", database.AsyncSessionLocal)
    monkeypatch.setattr(collection_service, "CrawlEngine", _RecordingEngine)
    monkeypatch.setattr(collection_service, "extract_article", _fake_extract)
    _RecordingEngine.last_max_pages = None
    _RecordingEngine.articles = list(articles)


async def _run(db_source_factory, monkeypatch, *, articles, base_url="https://www.gzhu.edu.cn", params=None, source_kwargs=None):
    """建源 + 建任务 + 跑采集，返回 (job, source) 快照。"""
    _wire_fake_engine(monkeypatch, articles)
    async with database.AsyncSessionLocal() as db:
        source = await db_source_factory(db, base_url=base_url, **(source_kwargs or {}))
        job = CollectionJob(source_id=source.id, status="PENDING", params=params or {"max_pages": 1})
        db.add(job)
        await db.commit()
        await db.refresh(job)
        job_id, source_id = job.id, source.id

    await collection_service.run_collection(job_id)

    async with database.AsyncSessionLocal() as db:
        return await db.get(CollectionJob, job_id), await db.get(Source, source_id)


# ─────────────────────────── F1 ───────────────────────────


class TestAbsUrlKeepsHostname:
    """F1：基类 `_abs_url` 必须保留 scheme+host（新闻网的 refs 全都栽在这里）。"""

    def test_bare_host_base_url(self):
        got = SiteAdapter()._abs_url("https://news.gzhu.edu.cn", "info/1015/51857.htm")
        assert got == "https://news.gzhu.edu.cn/info/1015/51857.htm", got

    def test_trailing_slash_base_url(self):
        got = SiteAdapter()._abs_url("https://news.gzhu.edu.cn/", "info/1015/51857.htm")
        assert got == "https://news.gzhu.edu.cn/info/1015/51857.htm", got

    def test_absolute_href_passthrough(self):
        url = "https://news.gzhu.edu.cn/info/1015/51857.htm"
        assert SiteAdapter()._abs_url("https://news.gzhu.edu.cn", url) == url

    def test_gznews_adapter_inherits_the_fix(self):
        got = GUNewsAdapter()._abs_url("https://news.gzhu.edu.cn", "info/1015/51857.htm")
        assert got == "https://news.gzhu.edu.cn/info/1015/51857.htm", got

    def test_gzhu_adapter_still_anchors_to_domain_root(self):
        """回归护栏：gzhu 文章挂在 /info/ 根目录，不能被改成相对列表页解析。"""
        got = GUZhuAdapter()._abs_url("https://www.gzhu.edu.cn/z__l/tzgg.htm", "info/1087/38277.htm")
        assert got == "https://www.gzhu.edu.cn/info/1087/38277.htm", got

    def test_news_refs_from_real_markup_are_absolute(self):
        html = '<ul><li><a href="info/1015/51857.htm" title="图片新闻">x</a><span></span></li></ul>'
        refs = GUNewsAdapter().parse_list(html, "https://news.gzhu.edu.cn")
        assert [r.url for r in refs] == ["https://news.gzhu.edu.cn/info/1015/51857.htm"]


# ─────────────────────────── F3 ───────────────────────────


class TestAdapterSelection:
    """F3：按 host 精确匹配；不支持的站点明确拒绝，而不是塞给首页适配器。"""

    def test_www_uses_gzhu_adapter(self):
        assert isinstance(collection_service._pick_adapter(SimpleNamespace(base_url="https://www.gzhu.edu.cn")), GUZhuAdapter)

    def test_www_list_page_uses_gzhu_adapter(self):
        adapter = collection_service._pick_adapter(
            SimpleNamespace(base_url="https://www.gzhu.edu.cn/z__l/tzgg.htm")
        )
        assert isinstance(adapter, GUZhuAdapter)

    def test_news_uses_news_adapter(self):
        assert isinstance(collection_service._pick_adapter(SimpleNamespace(base_url="https://news.gzhu.edu.cn")), GUNewsAdapter)

    def test_unsupported_subdomain_is_rejected(self):
        """教务处结构≠主站首页结构，交给首页适配器只会静默产出 0 条。"""
        assert collection_service._pick_adapter(SimpleNamespace(base_url="https://jwc.gzhu.edu.cn")) is None

    def test_unknown_domain_is_rejected(self):
        assert collection_service._pick_adapter(SimpleNamespace(base_url="https://www.example.edu.cn")) is None

    def test_blank_base_url_is_rejected(self):
        assert collection_service._pick_adapter(SimpleNamespace(base_url=None)) is None


# ─────────────────────────── F6 ───────────────────────────


class TestPaginationObservability:
    """F6：引擎必须暴露"要了几页 / 实际抓了几页 / 是否根本没有翻页入口"。"""

    async def test_no_next_link_is_recorded(self, setup_test_db, monkeypatch):
        monkeypatch.setattr(settings, "campus_collect_ssrf_check", False, raising=False)
        monkeypatch.setattr(settings, "campus_collect_interval_ms", 0, raising=False)
        http = _FakeHttp()
        engine = CrawlEngine(http_client=http)

        await engine.fetch_source(
            "https://x.edu.cn/list.htm", _FakeAdapter(refs_per_page=0, next_page=None), max_pages=10
        )

        assert engine.pages_requested == 10
        assert engine.pages_fetched == 1
        assert engine.pagination_unavailable is True

    async def test_pages_are_counted_when_pagination_works(self, setup_test_db, monkeypatch):
        monkeypatch.setattr(settings, "campus_collect_ssrf_check", False, raising=False)
        monkeypatch.setattr(settings, "campus_collect_interval_ms", 0, raising=False)
        http = _FakeHttp()
        engine = CrawlEngine(http_client=http)

        await engine.fetch_source(
            "https://x.edu.cn/list.htm",
            _FakeAdapter(refs_per_page=1, next_page="https://x.edu.cn/list2.htm"),
            max_pages=3,
        )

        assert engine.pages_requested == 3
        assert engine.pages_fetched == 3
        assert engine.pagination_unavailable is False

    async def test_single_page_request_is_not_reported_as_unavailable(self, setup_test_db, monkeypatch):
        """只要 1 页时没有翻页入口是正常的，不该报"翻页不可用"。"""
        monkeypatch.setattr(settings, "campus_collect_ssrf_check", False, raising=False)
        monkeypatch.setattr(settings, "campus_collect_interval_ms", 0, raising=False)
        engine = CrawlEngine(http_client=_FakeHttp())

        await engine.fetch_source(
            "https://x.edu.cn/list.htm", _FakeAdapter(refs_per_page=0, next_page=None), max_pages=1
        )

        assert engine.pages_fetched == 1
        assert engine.pagination_unavailable is False


# ─────────────────────────── F4 / F5 ───────────────────────────


class TestMaxPagesResolution:
    """F4：0 = 「全部（最多 50 页）」，不能被 or 1 吃掉；F5：params 缺失时回落 source.max_pages。"""

    async def test_zero_is_passed_through_as_all(self, setup_test_db, monkeypatch):
        job, _src = await _run(
            lambda db, **kw: _make_source(db, "src_zero", **kw),
            monkeypatch,
            articles=[_article()],
            params={"max_pages": 0},
        )
        assert _RecordingEngine.last_max_pages == 0, "0 被吞成 1 页，『全部』档位失效"
        assert job.status == "SUCCESS"

    async def test_source_max_pages_used_when_params_absent(self, setup_test_db, monkeypatch):
        job, _src = await _run(
            lambda db, **kw: _make_source(db, "src_sched", max_pages=7, **kw),
            monkeypatch,
            articles=[_article()],
            params={"trigger": "schedule"},
        )
        assert _RecordingEngine.last_max_pages == 7, "调度链路必须尊重 source.max_pages"
        assert job.status == "SUCCESS"

    async def test_params_win_over_source_column(self, setup_test_db, monkeypatch):
        _job, _src = await _run(
            lambda db, **kw: _make_source(db, "src_win", max_pages=7, **kw),
            monkeypatch,
            articles=[_article()],
            params={"max_pages": 2},
        )
        assert _RecordingEngine.last_max_pages == 2

    async def test_illegal_value_falls_back_to_one(self, setup_test_db, monkeypatch):
        _job, _src = await _run(
            lambda db, **kw: _make_source(db, "src_bad", **kw),
            monkeypatch,
            articles=[_article()],
            params={"max_pages": "abc"},
        )
        assert _RecordingEngine.last_max_pages == 1


# ─────────────────────────── F2 ───────────────────────────


class TestZeroItemsIsNotSilentSuccess:
    """F2：抓 0 条必须失败并可解释（教务处此前是 SUCCESS + last_error=None）。"""

    async def test_zero_items_marks_failed(self, setup_test_db, monkeypatch):
        job, src = await _run(
            lambda db, **kw: _make_source(db, "src_zero_items", **kw),
            monkeypatch,
            articles=[],
        )
        assert job.status == "FAILED", "抓 0 条不能记成功"
        assert job.error_message, "必须给出失败原因"
        assert "0 条" in job.error_message or "未解析出" in job.error_message
        assert src.last_error
        assert src.last_success_at is None, "抓 0 条不得推进成功水位（否则 only_new 会被污染）"
        assert src.last_crawled_at is not None, "尝试时间仍应记录"
        assert job.result is not None and job.result.get("fetched") == 0

    async def test_unsupported_site_fails_with_actionable_message(self, setup_test_db, monkeypatch):
        job, src = await _run(
            lambda db, **kw: _make_source(db, "src_jwc", **kw),
            monkeypatch,
            articles=[_article()],
            base_url="https://jwc.gzhu.edu.cn",
        )
        assert job.status == "FAILED"
        assert "适配器" in (job.error_message or "")
        assert src.last_success_at is None

    async def test_nonempty_fetch_still_succeeds(self, setup_test_db, monkeypatch):
        job, src = await _run(
            lambda db, **kw: _make_source(db, "src_ok", **kw),
            monkeypatch,
            articles=[_article()],
        )
        assert job.status == "SUCCESS"
        assert job.result["fetched"] == 1
        assert job.result["indexed"] == 1
        assert src.last_success_at is not None
        assert src.last_error is None

    async def test_records_pages_in_trace_and_result(self, setup_test_db, monkeypatch):
        """F6 落地到 job 上：请求页数/实际页数写进 stage_trace 与 result，界面才有据可查。"""
        job, _src = await _run(
            lambda db, **kw: _make_source(db, "src_trace", **kw),
            monkeypatch,
            articles=[_article()],
            params={"max_pages": 5},
        )
        assert job.stage_trace["pages_requested"] == 5
        assert job.stage_trace["pages_fetched"] == 1  # 替身引擎无 pages_fetched 时按 1 记录
        assert "pages_fetched" in job.result

"""采集管线 service：Source → 抓取 → 解析 → 去重 → 保存 RawDocument（EPIC 4）。

REFACTOR_PLAN_V2 T5：时间过滤（since/until/only_new）+ 条数硬上限 + 抓取失败重试，
并把「最近尝试时间」的写入收敛到本函数，使端点/闭环/调度三条链路语义一致。
"""
import asyncio
import logging
from datetime import date, datetime, timezone
from urllib.parse import urlparse

from sqlalchemy import select

from collectors.base import SiteAdapter
from collectors.dedup import content_hash
from collectors.engine import MAX_PAGES_CAP, CrawlEngine
from collectors.gzhu import GUZhuAdapter
from collectors.gznews import GUNewsAdapter
from config import settings
from database import AsyncSessionLocal
from knowledge.fingerprint import canonical_title
from models import CollectionJob, KnowledgeObject, RawDocument, Source, normalize_url
from parser.extract import extract_article
from services.change_service import detect_and_record_change
from services.knowledge_service import build_knowledge_object

logger = logging.getLogger(__name__)

# 单次入库条数：默认与硬上限（硬上限来自全局配置 campus_collect_max_items，便于统一收敛）
DEFAULT_MAX_ITEMS = 200
MAX_ITEMS_HARD_LIMIT = max(1, int(getattr(settings, "campus_collect_max_items", 500) or 500))
# 抓取失败重试（网络抖动）：重试次数与退避秒数
FETCH_RETRY_TIMES = 1
FETCH_RETRY_BACKOFF_SECONDS = 2


def parse_publish_date(value) -> date | None:
    """解析发布时间字符串（RawDocument.publish_time 为 String(20)）；解析失败返回 None。"""
    if not value:
        return None
    text = str(value).strip()
    for candidate, fmt in (
        (text[:10], "%Y-%m-%d"),
        (text[:10], "%Y/%m/%d"),
        (text[:16], "%Y-%m-%d %H:%M"),
        (text, "%Y年%m月%d日"),
    ):
        try:
            return datetime.strptime(candidate, fmt).date()
        except ValueError:
            continue
    return None


def _parse_iso_date(value) -> date | None:
    """解析 YYYY-MM-DD 形式的过滤参数；非法/空返回 None。"""
    if not value:
        return None
    return parse_publish_date(value)


def resolve_filter_params(source: Source, params: dict) -> tuple[date | None, date | None, bool, int]:
    """归一化过滤参数：返回 (since, until, only_new, max_items)。

    only_new 语义：仅在 since 为空或早于水位时，把 since 抬到"上次成功采集日期"（水位）。
    """
    since = _parse_iso_date(params.get("since"))
    until = _parse_iso_date(params.get("until"))
    only_new = bool(params.get("only_new"))

    if only_new and source.last_success_at:
        watermark = source.last_success_at
        if watermark.tzinfo is None:
            watermark = watermark.replace(tzinfo=timezone.utc)
        wm_date = watermark.date()
        since = wm_date if since is None else max(since, wm_date)

    raw_max = params.get("max_items")
    try:
        max_items = int(raw_max)
    except (TypeError, ValueError):
        max_items = DEFAULT_MAX_ITEMS
    max_items = max(1, min(max_items, MAX_ITEMS_HARD_LIMIT))
    return since, until, only_new, max_items


def _filter_by_publish_range(articles: list, since: date | None, until: date | None) -> tuple[list, int]:
    """按发布时间范围过滤；解析失败视为"不受时间约束"放行（避免脏数据误杀）。"""
    if since is None and until is None:
        return list(articles), 0
    kept: list = []
    dropped = 0
    for article in articles:
        published = parse_publish_date(getattr(article, "publish_date", None))
        if published is None:
            kept.append(article)
            continue
        if since and published < since:
            dropped += 1
            continue
        if until and published > until:
            dropped += 1
            continue
        kept.append(article)
    return kept, dropped


async def _fetch_with_retry(engine: CrawlEngine, base_url: str, adapter: SiteAdapter, max_pages: int):
    """抓取并重试一次（指数退避固定 2s）：第二次仍失败才抛出。"""
    last_error: Exception | None = None
    for attempt in range(FETCH_RETRY_TIMES + 1):
        try:
            return await engine.fetch_source(base_url, adapter, max_pages=max_pages)
        except Exception as e:  # noqa: BLE001 —— 任何抓取异常都值得重试一次
            last_error = e
            if attempt < FETCH_RETRY_TIMES:
                logger.warning(
                    "抓取失败，%ds 后重试（第 %d 次）：%s", FETCH_RETRY_BACKOFF_SECONDS, attempt + 1, e
                )
                await asyncio.sleep(FETCH_RETRY_BACKOFF_SECONDS)
    assert last_error is not None
    raise last_error


def _invalidate_column_cache(source_id: str) -> None:
    """采集完成后让栏目发现缓存失效（T6 未就绪时静默跳过）。"""
    try:
        from services.column_discovery_service import invalidate

        invalidate(source_id)
    except Exception:  # noqa: BLE001 —— 缓存失效失败不影响采集结果
        logger.debug("栏目缓存失效跳过（column_discovery_service 未就绪）")


def _pick_adapter(source: Source) -> SiteAdapter | None:
    """根据 base_url 的 host 精确选择站点适配器（EPIC 4 支持 gzhu/gznews）。

    历史实现只看域名子串（`"gzhu.edu.cn" in url`），于是 jwc.gzhu.edu.cn 这类**结构完全
    不同**的子站也被交给"主站首页适配器"，解析出 0 条却记成 SUCCESS。
    不支持（或结构未知）的站点一律返回 None，由调用方给出明确失败原因。
    """
    if not source.base_url:
        return None
    host = (urlparse(source.base_url).hostname or "").lower()
    if host == "news.gzhu.edu.cn":
        return GUNewsAdapter()
    if host in ("www.gzhu.edu.cn", "gzhu.edu.cn"):
        return GUZhuAdapter()
    return None


def _is_homepage_url(url: str | None) -> bool:
    """站点首页判定：URL 路径为空或仅 "/"。

    首页**不是列表页**：它把各板块文章链接铺在一屏上，采集结果会跨栏目、甚至跨站点
    （实测 www.gzhu.edu.cn 首页 1 页解析出 55 条，其中 34 条实际来自 news.gzhu.edu.cn），
    而且没有「下一页」入口 → max_pages 对它无效。
    这里只做判定并告警，不阻断（首页作为概览入口仍有价值）。
    """
    if not url:
        return False
    candidate = url if "://" in url else f"http://{url}"
    return (urlparse(candidate).path or "/") in ("", "/")


def is_collectible(source: Source) -> bool:
    """该数据源是否**真的能采**：有 base_url 且站点有适配器。

    用途：闭环等自动化链路用它过滤掉"注定失败"的源 —— manual/file 类没有 URL，
    未支持站点（如 jwc.gzhu.edu.cn）没有适配器，采集必然失败并产出红色失败卡。
    这类源在「数据源管理」里手动采集仍会得到明确的报错原因（不静默）。
    """
    return _pick_adapter(source) is not None


def _resolve_max_pages(source: Source, params: dict) -> int:
    """解析本次采集页数：job.params → source.max_pages → 1。

    0 是合法值（界面的「全部（最多 50 页）」，由引擎解释为 MAX_PAGES_CAP=50），
    **不能**被 `or 1` 当成 falsy 吃掉 —— 历史实现 `params.get("max_pages", 1) or 1`
    正是这样把「全部」静默退化成 1 页的。
    source.max_pages 兜底是为了调度链路（APScheduler 触发时不带 params，此前永远只抓 1 页）。
    """
    raw = params.get("max_pages")
    if raw is None:
        raw = getattr(source, "max_pages", None)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return 1
    return value if value >= 0 else 1


async def run_collection(job_id: str) -> None:
    """执行采集任务：抓取 → 解析 → 去重 → 保存 RawDocument。"""
    async with AsyncSessionLocal() as db:
        job = await db.get(CollectionJob, job_id)
        if not job:
            return
        source = await db.get(Source, job.source_id)
        if not source:
            job.status = "FAILED"
            job.error_message = "数据源不存在"
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()
            return

        job.status = "RUNNING"
        job.started_at = datetime.now(timezone.utc)
        job.stage_trace = {"Fetch": "running"}
        # 时间真源收敛：端点/闭环/调度三条链路都经由本函数，统一在此写"最近尝试"时间
        source.last_crawled_at = datetime.now(timezone.utc)
        await db.commit()

        try:
            adapter = _pick_adapter(source)
            if adapter is None:
                raise RuntimeError(f"无法识别该 URL 的站点适配器: {source.base_url}")

            params = job.params or {}
            max_pages = _resolve_max_pages(source, params)
            column = params.get("column")
            since, until, only_new, max_items = resolve_filter_params(source, params)

            engine = CrawlEngine()
            try:
                articles, failures, _ = await _fetch_with_retry(
                    engine, source.base_url, adapter, max_pages
                )
            finally:
                await engine.close()

            fetched = len(articles)

            # 翻页事实留痕（F6）：界面与排查都需要"要了几页 / 实际几页 / 有没有翻页入口"
            reported_requested = getattr(engine, "pages_requested", None)
            if reported_requested is None:
                # 引擎未上报（如测试替身）：按引擎语义自行推导
                reported_requested = max_pages if max_pages > 0 else MAX_PAGES_CAP
            pages_requested = int(reported_requested)
            reported_fetched = getattr(engine, "pages_fetched", None)
            pages_fetched = (
                int(reported_fetched) if reported_fetched is not None else (1 if fetched else 0)
            )
            pagination_unavailable = bool(getattr(engine, "pagination_unavailable", False))
            homepage_source = _is_homepage_url(source.base_url)
            page_facts = {
                "pages_requested": pages_requested,
                "pages_fetched": pages_fetched,
                "pagination_unavailable": pagination_unavailable,
                "homepage_source": homepage_source,
            }
            if homepage_source:
                logger.warning(
                    "采集 %s：base_url 是站点首页（%s）—— 首页不是列表页，结果会跨栏目/跨站点，"
                    "且没有翻页入口（max_pages 无效）；建议改用具体栏目列表页 URL",
                    source.id,
                    source.base_url,
                )
            if pagination_unavailable:
                logger.warning(
                    "采集 %s：请求 %d 页但只抓到 %d 页 —— 该页面没有「下一页」入口，"
                    "max_pages 不会生效（常见原因：base_url 填的是站点首页而非栏目列表页）",
                    source.id,
                    pages_requested,
                    pages_fetched,
                )

            # 抓取 0 条不再静默记成功（F2）：要么 URL 不是列表页、要么适配器与站点结构不匹配、
            # 要么详情页全被拦（如 URL 拼接丢 host）。此前记 SUCCESS + last_error=None，
            # 界面上表现为"成功但没数据"，用户完全无从排查。
            if fetched == 0:
                job.stage_trace = {**job.stage_trace, "Fetch": "failed", **page_facts}
                job.result = {
                    "fetched": 0,
                    "indexed": 0,
                    "updated": 0,
                    "skipped": 0,
                    "errors": failures[:10],
                    **page_facts,
                }
                if failures:
                    raise RuntimeError(
                        f"列表页未解析出任何条目（fetched=0）：{len(failures)} 个详情页抓取失败，"
                        f"首个错误：{failures[0].get('error')}"
                    )
                raise RuntimeError(
                    "列表页未解析出任何条目（fetched=0）：该 URL 可能不是栏目列表页"
                    "（站点首页没有文章列表/翻页入口），或站点结构已变化；"
                    f"请改用栏目列表页 URL，或为该站点新增适配器（当前 base_url={source.base_url}）"
                )

            # 按内容筛选（栏目）过滤采集结果
            if column:
                articles = [a for a in articles if a.column == column]

            # 按发布时间范围过滤（解析失败放行）
            articles, dropped = _filter_by_publish_range(articles, since, until)

            # 单次入库条数硬上限
            truncated = len(articles) > max_items
            if truncated:
                articles = articles[:max_items]

            job.stage_trace = {
                **job.stage_trace,
                "Fetch": "ok",
                "Parse": "running",
                "Filter": "ok",
                "filtered_in": len(articles),
                "filtered_out": dropped,
                "since": since.isoformat() if since else None,
                "until": until.isoformat() if until else None,
                "only_new": only_new,
                "truncated": truncated,
                **page_facts,
            }
            await db.commit()

            saved = 0
            skipped = 0
            updated = 0
            for raw in articles:
                parsed = extract_article(raw)
                chash = content_hash(parsed.content or "")
                if not chash:
                    continue
                norm_url = normalize_url(raw.url)
                ctitle = canonical_title(parsed.title)

                # 按 normalized_url 查找已有文档（同一网页）
                existing = await db.scalar(
                    select(RawDocument)
                    .where(RawDocument.normalized_url == norm_url)
                    .order_by(RawDocument.version.desc())
                )

                if existing:
                    if existing.content_hash == chash:
                        skipped += 1  # 内容没变，不重复入库
                        continue
                    # 标题相同 + 正文 hash 不同 → 新版本
                    doc = RawDocument(
                        source_id=source.id,
                        url=raw.url,
                        normalized_url=norm_url,
                        title=parsed.title,
                        canonical_title=ctitle,
                        content=parsed.content,
                        content_hash=chash,
                        version=existing.version + 1,
                        publish_time=parsed.publish_date,
                        source_site=parsed.source_site,
                        column=parsed.column,
                        department=parsed.department,
                    )
                    db.add(doc)
                    updated += 1
                    # 版本切换：旧版本 KO 标记 EXPIRED
                    old_kos = await db.execute(
                        select(KnowledgeObject).where(
                            KnowledgeObject.raw_document_id == existing.id
                        )
                    )
                    for old_ko in old_kos.scalars():
                        old_ko.status = "EXPIRED"
                    await build_knowledge_object(db, doc, source)
                    await detect_and_record_change(db, source, existing, doc)
                else:
                    doc = RawDocument(
                        source_id=source.id,
                        url=raw.url,
                        normalized_url=norm_url,
                        title=parsed.title,
                        canonical_title=ctitle,
                        content=parsed.content,
                        content_hash=chash,
                        version=1,
                        publish_time=parsed.publish_date,
                        source_site=parsed.source_site,
                        column=parsed.column,
                        department=parsed.department,
                    )
                    db.add(doc)
                    saved += 1
                    await build_knowledge_object(db, doc, source)

            job.stage_trace = {
                **job.stage_trace,  # 保留 Filter 过滤统计（可解释、可回溯）
                "Fetch": "ok",
                "Parse": "ok",
                "Clean": "ok",
                "Classify": "ok",
                "Dedup": "ok",
                "Index": "ok",
            }
            job.status = "SUCCESS" if not failures else "PARTIAL"
            job.result = {
                "fetched": fetched,
                "filtered_in": len(articles),
                "filtered_out": dropped,
                "truncated": truncated,
                "indexed": saved,
                "updated": updated,
                "skipped": skipped,
                "errors": failures,
                **page_facts,
            }
            job.completed_at = datetime.now(timezone.utc)
            source.last_success_at = datetime.now(timezone.utc)
            source.last_error = None
            await db.commit()
            # 采集完成 → 栏目分布可能变化，让发现缓存失效
            _invalidate_column_cache(source.id)
            logger.info(
                "CollectionJob %s 完成：fetched=%d saved=%d skipped=%d",
                job_id,
                len(articles),
                saved,
                skipped,
            )
        except Exception as e:
            logger.exception("CollectionJob %s 失败", job_id)
            job.status = "FAILED"
            job.error_message = str(e)
            job.completed_at = datetime.now(timezone.utc)
            source.last_error = str(e)
            await db.commit()

"""采集管线 service：Source → 抓取 → 解析 → 去重 → 保存 RawDocument（EPIC 4）。

REFACTOR_PLAN_V2 T5：时间过滤（since/until/only_new）+ 条数硬上限 + 抓取失败重试，
并把「最近尝试时间」的写入收敛到本函数，使端点/闭环/调度三条链路语义一致。
"""
import asyncio
import logging
from datetime import date, datetime, timezone

from sqlalchemy import select

from collectors.base import SiteAdapter
from collectors.dedup import content_hash
from collectors.engine import CrawlEngine
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
    """根据 base_url 选择站点适配器（EPIC 4 支持 gzhu/gznews）。"""
    if not source.base_url:
        return None
    url = source.base_url.lower()
    if "news.gzhu.edu.cn" in url:
        return GUNewsAdapter()
    if "gzhu.edu.cn" in url:
        return GUZhuAdapter()
    return None


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
            max_pages = params.get("max_pages", 1) or 1
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

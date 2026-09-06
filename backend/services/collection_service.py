"""采集管线 service：Source → 抓取 → 解析 → 去重 → 保存 RawDocument（EPIC 4）。"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from collectors.base import SiteAdapter
from collectors.dedup import content_hash
from collectors.engine import CrawlEngine
from collectors.gzhu import GUZhuAdapter
from collectors.gznews import GUNewsAdapter
from database import AsyncSessionLocal
from knowledge.fingerprint import canonical_title
from models import CollectionJob, KnowledgeObject, RawDocument, Source, normalize_url
from parser.extract import extract_article
from services.knowledge_service import build_knowledge_object

logger = logging.getLogger(__name__)


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
        await db.commit()

        try:
            adapter = _pick_adapter(source)
            if adapter is None:
                raise RuntimeError(f"无法识别该 URL 的站点适配器: {source.base_url}")

            engine = CrawlEngine()
            try:
                articles, failures, _ = await engine.fetch_source(
                    source.base_url, adapter, max_pages=source.max_pages or 1
                )
            finally:
                await engine.close()

            job.stage_trace = {**job.stage_trace, "Fetch": "ok", "Parse": "running"}
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
                    await build_knowledge_object(db, doc)
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
                    await build_knowledge_object(db, doc)

            job.stage_trace = {
                "Fetch": "ok",
                "Parse": "ok",
                "Clean": "ok",
                "Classify": "ok",
                "Dedup": "ok",
                "Index": "ok",
            }
            job.status = "SUCCESS" if not failures else "PARTIAL"
            job.result = {
                "fetched": len(articles),
                "indexed": saved,
                "updated": updated,
                "skipped": skipped,
                "errors": failures,
            }
            job.completed_at = datetime.now(timezone.utc)
            source.last_success_at = datetime.now(timezone.utc)
            source.last_error = None
            await db.commit()
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

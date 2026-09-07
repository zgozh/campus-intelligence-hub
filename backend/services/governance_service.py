"""知识治理（EPIC 8）：KO 生命周期 + edit / publish / archive 全链路。

生命周期（spec §17）：DISCOVERED → PARSED → PENDING_REVIEW → APPROVED → PUBLISHED → STALE → ARCHIVED。
兼容现行状态值：PUBLISHED / EXPIRED / REVIEW_REQUIRED / ARCHIVED / DISCOVERED / UPDATED / PROCESSING。
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from config import DEFAULT_AUTHORITY
from models import KnowledgeObject

logger = logging.getLogger(__name__)

PUBLISHABLE_STATES = {"PUBLISHED", "REVIEW_REQUIRED", "PENDING_REVIEW", "APPROVED", "UPDATED", "DISCOVERED", "PARSED", "PROCESSING"}
ARCHIVED_FROM = {"ARCHIVED"}


def can_publish(status: str) -> bool:
    """可发布：非 已归档 / 已过期。"""
    return status not in {"ARCHIVED", "EXPIRED"}


async def publish_ko(db, ko_id: str) -> KnowledgeObject | None:
    ko = await db.get(KnowledgeObject, ko_id)
    if not ko or not can_publish(ko.status):
        return None
    ko.status = "PUBLISHED"
    ko.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(ko)
    logger.info("KO 发布：%s", ko_id)
    return ko


async def archive_ko(db, ko_id: str) -> KnowledgeObject | None:
    ko = await db.get(KnowledgeObject, ko_id)
    if not ko:
        return None
    ko.status = "ARCHIVED"
    ko.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(ko)
    logger.info("KO 归档：%s", ko_id)
    return ko


async def edit_ko(db, ko_id: str, data: dict) -> KnowledgeObject | None:
    """编辑 KO 字段；编辑后置为 REVIEW_REQUIRED（需人工复核）。"""
    ko = await db.get(KnowledgeObject, ko_id)
    if not ko:
        return None
    for field in ("title", "department", "effective_from", "effective_to", "summary", "type"):
        if field in data and data[field] is not None:
            setattr(ko, field, data[field])
    if isinstance(data.get("facts"), list):
        ko.facts = data["facts"]
    if isinstance(data.get("tags"), list):
        ko.tags = data["tags"]
    if data.get("confidence") is not None:
        try:
            ko.confidence = float(data["confidence"])
        except (TypeError, ValueError):
            pass
    # 编辑后进入待审核
    if ko.status not in {"ARCHIVED"}:
        ko.status = "REVIEW_REQUIRED"
    ko.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(ko)
    logger.info("KO 编辑：%s -> REVIEW_REQUIRED", ko_id)
    return ko


async def create_ko(db, data: dict) -> KnowledgeObject:
    """人工新增知识对象（除采集外人工录入）。"""
    ko = KnowledgeObject(
        type=data.get("type", "Announcement"),
        title=data.get("title", ""),
        department=data.get("department"),
        effective_from=data.get("effective_from"),
        effective_to=data.get("effective_to"),
        facts=data.get("facts") or [],
        summary=data.get("summary"),
        tags=data.get("tags") or [],
        confidence=float(data.get("confidence") or 0.9),
        status="PUBLISHED",
        version=1,
        source_url=data.get("source_url"),
        authority=DEFAULT_AUTHORITY,
        freshness_level="Unknown",
        source_version=1,
    )
    db.add(ko)
    await db.flush()
    # 语义向量入库（可选，失败降级仅关键词检索）
    try:
        from agents.embedding import embed_texts
        from services.vector_service import ensure_collection, upsert_ko

        await ensure_collection()
        embs = await embed_texts([ko.title + " " + (ko.summary or "")[:500]])
        if embs:
            await upsert_ko(ko.id, embs[0], {"title": ko.title, "type": ko.type})
    except Exception:  # noqa: BLE001
        pass
    await db.commit()
    await db.refresh(ko)
    logger.info("KO 人工新增：%s", ko.id)
    return ko


async def batch_archive(db, ids: list[str]) -> int:
    """批量归档指定 KO。返回归档数。"""
    n = 0
    for kid in ids:
        ko = await db.get(KnowledgeObject, kid)
        if ko and ko.status != "ARCHIVED":
            ko.status = "ARCHIVED"
            ko.updated_at = datetime.now(timezone.utc)
            n += 1
    await db.commit()
    return n


async def archive_expired(db) -> int:
    """一键归档：把所有 EXPIRED 知识对象转为 ARCHIVED。返回归档数。"""
    rows = await db.execute(select(KnowledgeObject).where(KnowledgeObject.status == "EXPIRED"))
    n = 0
    for ko in rows.scalars():
        ko.status = "ARCHIVED"
        ko.updated_at = datetime.now(timezone.utc)
        n += 1
    await db.commit()
    logger.info("一键归档过期知识：%d", n)
    return n

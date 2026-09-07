"""知识治理（EPIC 8）：KO 生命周期 + edit / publish / archive 全链路。

生命周期（spec §17）：DISCOVERED → PARSED → PENDING_REVIEW → APPROVED → PUBLISHED → STALE → ARCHIVED。
兼容现行状态值：PUBLISHED / EXPIRED / REVIEW_REQUIRED / ARCHIVED / DISCOVERED / UPDATED / PROCESSING。
"""
import logging
from datetime import datetime, timezone

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

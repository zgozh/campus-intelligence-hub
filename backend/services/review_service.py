"""审核队列（EPIC 9）：低置信/冲突 → ReviewTask，Approve/Reject。"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from models import Conflict, KnowledgeObject, ReviewTask

logger = logging.getLogger(__name__)

LOW_CONFIDENCE_THRESHOLD = 0.75


async def _has_pending(db, ko_id: str, reason: str) -> bool:
    r = await db.scalar(
        select(ReviewTask.id).where(
            ReviewTask.knowledge_object_id == ko_id,
            ReviewTask.reason == reason,
            ReviewTask.status == "pending",
        )
    )
    return r is not None


async def build_review_queue(db) -> int:
    """扫描：低置信 KO + open 冲突 → ReviewTask（pending），KO 状态 → REVIEW_REQUIRED。返回新增数。"""
    created = 0

    # 1. 低置信
    low_kos = await db.execute(
        select(KnowledgeObject).where(
            KnowledgeObject.confidence < LOW_CONFIDENCE_THRESHOLD,
            KnowledgeObject.status == "PUBLISHED",
        )
    )
    for ko in low_kos.scalars():
        if await _has_pending(db, ko.id, "low_confidence"):
            continue
        db.add(ReviewTask(knowledge_object_id=ko.id, reason="low_confidence", status="pending"))
        ko.status = "REVIEW_REQUIRED"
        created += 1

    # 2. 冲突
    conflicts = await db.execute(select(Conflict).where(Conflict.status == "open"))
    for cf in conflicts.scalars():
        for obj_id in (cf.object_a, cf.object_b):
            if await _has_pending(db, obj_id, "conflict"):
                continue
            db.add(ReviewTask(knowledge_object_id=obj_id, reason="conflict", status="pending"))
            ko = await db.get(KnowledgeObject, obj_id)
            if ko and ko.status == "PUBLISHED":
                ko.status = "REVIEW_REQUIRED"
            created += 1

    await db.commit()
    logger.info("审核队列构建：created=%d", created)
    return created


async def approve_task(db, task_id: str, admin_id: int) -> dict:
    task = await db.get(ReviewTask, task_id)
    if not task:
        return {"error": "任务不存在"}
    task.status = "approved"
    task.reviewed_by = str(admin_id)
    task.reviewed_at = datetime.now(timezone.utc)
    ko = await db.get(KnowledgeObject, task.knowledge_object_id)
    if ko:
        ko.status = "PUBLISHED"
        if task.reason == "low_confidence":
            ko.confidence = 0.9
    await db.commit()
    return {"task_id": task_id, "status": "approved"}


async def reject_task(db, task_id: str, admin_id: int) -> dict:
    task = await db.get(ReviewTask, task_id)
    if not task:
        return {"error": "任务不存在"}
    task.status = "rejected"
    task.reviewed_by = str(admin_id)
    task.reviewed_at = datetime.now(timezone.utc)
    ko = await db.get(KnowledgeObject, task.knowledge_object_id)
    if ko:
        ko.status = "ARCHIVED"
    await db.commit()
    return {"task_id": task_id, "status": "rejected"}

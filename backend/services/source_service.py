"""数据源删除：按外键依赖顺序级联清理子记录。

修复「数据源管理里的删除按钮点了没反应」。

根因（information_schema 实测，全部 NO ACTION，库里没有 DB 级级联）：
    sources          ← change_events.source_id
    sources          ← collection_jobs.source_id
    sources          ← raw_documents.source_id
    raw_documents    ← knowledge_objects.raw_document_id
    knowledge_objects ← review_tasks.knowledge_object_id

删除端点此前直接 `db.delete(source)`，被第一个外键挡住 → 500
（collection_jobs_source_id_fkey）；而前端 onDelete 没有 try/catch，
异常无人提示 → 用户看到的就是"按钮没反应"。

因此这里显式按「由深到浅」顺序清理，并返回各表删除条数，便于回显与审计。
"""
import logging

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    ChangeEvent,
    CollectionJob,
    Conflict,
    KnowledgeObject,
    RawDocument,
    ReviewTask,
    Source,
)

logger = logging.getLogger(__name__)


async def delete_source_cascade(db: AsyncSession, source_id: str) -> dict | None:
    """删除数据源及其全部子记录。

    返回各表删除条数；数据源不存在时返回 None。
    """
    source = await db.get(Source, source_id)
    if not source:
        return None

    raw_ids = select(RawDocument.id).where(RawDocument.source_id == source_id)
    ko_ids = select(KnowledgeObject.id).where(KnowledgeObject.raw_document_id.in_(raw_ids))
    ko_id_list = [row[0] for row in (await db.execute(ko_ids)).all()]

    counts: dict[str, int] = {}
    # conflicts.object_a / object_b 是字符串列（没有 FK），不会被数据库挡住，
    # 但留着就是指向已删除知识对象的悬空冲突（冲突页会展示鬼条目），所以一并清理。
    counts["conflicts"] = (
        await db.execute(
            delete(Conflict).where(
                Conflict.object_a.in_(ko_ids) | Conflict.object_b.in_(ko_ids)
            )
        )
    ).rowcount or 0
    counts["review_tasks"] = (
        await db.execute(delete(ReviewTask).where(ReviewTask.knowledge_object_id.in_(ko_ids)))
    ).rowcount or 0
    counts["knowledge_objects"] = (
        await db.execute(
            delete(KnowledgeObject).where(KnowledgeObject.raw_document_id.in_(raw_ids))
        )
    ).rowcount or 0
    counts["change_events"] = (
        await db.execute(delete(ChangeEvent).where(ChangeEvent.source_id == source_id))
    ).rowcount or 0
    counts["collection_jobs"] = (
        await db.execute(delete(CollectionJob).where(CollectionJob.source_id == source_id))
    ).rowcount or 0
    counts["raw_documents"] = (
        await db.execute(delete(RawDocument).where(RawDocument.source_id == source_id))
    ).rowcount or 0

    await db.delete(source)
    await db.commit()

    # 向量清理（尽力而为）：Qdrant 里的 point 带 payload.ko_id，知识对象没了就该清掉。
    # 即使失败也不影响删除语义——检索时会按 ko_id 回查 DB，取不到的会被跳过。
    if ko_id_list:
        try:
            from services.vector_service import delete_by_ko_ids

            await delete_by_ko_ids(ko_id_list)
        except Exception as e:  # noqa: BLE001 —— 向量库不可用不能阻断删除
            logger.warning("数据源 %s 的向量清理跳过：%s", source_id, e)

    logger.info("数据源 %s 已删除，子记录清理：%s", source_id, counts)
    return counts

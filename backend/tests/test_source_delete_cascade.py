"""数据源删除级联测试（修复「删除按钮点了没反应」）。

根因：DELETE 端点直接 db.delete(source)，被 NO ACTION 外键挡住返回 500
（collection_jobs_source_id_fkey / raw_documents_source_id_fkey / change_events_source_id_fkey，
raw_documents 又被 knowledge_objects 引用、knowledge_objects 又被 review_tasks 引用），
前端 onDelete 又没有 try/catch → 界面上就是"点了没反应"。

本文件锁定行为：删除必须成功、子记录必须被清干净、不存在时返回 404、并回显清理条数。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import (  # noqa: E402
    ChangeEvent,
    CollectionJob,
    Conflict,
    KnowledgeObject,
    RawDocument,
    ReviewTask,
    Source,
)
from services.source_service import delete_source_cascade  # noqa: E402


async def _build_source_tree(db, name: str = "src_cascade") -> Source:
    """造一个"有内容"的数据源：文档 → 知识对象 → 审核任务/冲突，外加采集任务与变更事件。"""
    source = Source(name=name, source_type="list_page", base_url="https://www.gzhu.edu.cn/z__l/tzgg.htm")
    db.add(source)
    await db.flush()

    doc = RawDocument(
        source_id=source.id,
        url="https://www.gzhu.edu.cn/info/1087/38277.htm",
        normalized_url="https://www.gzhu.edu.cn/info/1087/38277.htm",
        title="关于2026年下半年中小学教师资格考试安排的公告",
        content="正文内容",
        content_hash="hash-1",
        version=1,
    )
    db.add(doc)
    await db.flush()

    ko = KnowledgeObject(
        raw_document_id=doc.id,
        title=doc.title,
        status="PUBLISHED",
    )
    db.add(ko)
    await db.flush()

    db.add(ReviewTask(knowledge_object_id=ko.id, reason="low_confidence", status="pending"))
    db.add(
        Conflict(
            object_a=ko.id,
            object_b=ko.id,
            field="截止日期",
            value_a="2026-09-20",
            value_b="2026-09-25",
            status="open",
        )
    )
    db.add(CollectionJob(source_id=source.id, status="SUCCESS", params={"max_pages": 1}))
    db.add(
        ChangeEvent(
            source_id=source.id,
            normalized_url=doc.normalized_url,
            old_raw_document_id=doc.id,
            new_raw_document_id=doc.id,
        )
    )
    await db.commit()
    await db.refresh(source)
    return source


async def _count_children(db, source_id: str) -> dict:
    from sqlalchemy import func, select

    ko_ids = select(KnowledgeObject.id).where(
        KnowledgeObject.raw_document_id.in_(
            select(RawDocument.id).where(RawDocument.source_id == source_id)
        )
    )
    return {
        "raw_documents": await db.scalar(
            select(func.count(RawDocument.id)).where(RawDocument.source_id == source_id)
        ),
        "collection_jobs": await db.scalar(
            select(func.count(CollectionJob.id)).where(CollectionJob.source_id == source_id)
        ),
        "change_events": await db.scalar(
            select(func.count(ChangeEvent.id)).where(ChangeEvent.source_id == source_id)
        ),
        "knowledge_objects": await db.scalar(
            select(func.count(KnowledgeObject.id)).where(
                KnowledgeObject.raw_document_id.in_(
                    select(RawDocument.id).where(RawDocument.source_id == source_id)
                )
            )
        ),
        "review_tasks": await db.scalar(
            select(func.count(ReviewTask.id)).where(ReviewTask.knowledge_object_id.in_(ko_ids))
        ),
        "conflicts": await db.scalar(
            select(func.count(Conflict.id)).where(
                Conflict.object_a.in_(ko_ids) | Conflict.object_b.in_(ko_ids)
            )
        ),
    }


class TestDeleteSourceCascade:
    async def test_source_with_children_can_be_deleted(self, setup_test_db):
        """核心回归：有子记录的数据源必须能删掉（此前被外键挡住 → 500）。"""
        async with database.AsyncSessionLocal() as db:
            source = await _build_source_tree(db, "src_del_ok")
            source_id = source.id
            before = await _count_children(db, source_id)
            assert all(v > 0 for v in before.values()), before

        async with database.AsyncSessionLocal() as db:
            counts = await delete_source_cascade(db, source_id)

        assert counts is not None
        assert counts["raw_documents"] == 1
        assert counts["knowledge_objects"] == 1
        assert counts["review_tasks"] == 1
        assert counts["conflicts"] == 1
        assert counts["collection_jobs"] == 1
        assert counts["change_events"] == 1

        async with database.AsyncSessionLocal() as db:
            assert await db.get(Source, source_id) is None
            after = await _count_children(db, source_id)
        assert all(v == 0 for v in after.values()), after

    async def test_missing_source_returns_none(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            assert await delete_source_cascade(db, "src_not_exist") is None

    async def test_empty_source_can_be_deleted(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            source = Source(name="src_empty", source_type="manual")
            db.add(source)
            await db.commit()
            source_id = source.id

        async with database.AsyncSessionLocal() as db:
            counts = await delete_source_cascade(db, source_id)

        assert counts is not None
        assert all(v == 0 for v in counts.values()), counts


class TestDeleteSourceEndpoint:
    async def test_endpoint_returns_cascade_counts(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            source = await _build_source_tree(db, "src_del_api")
            source_id = source.id

        resp = await client.delete(f"/api/v1/sources/{source_id}")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["deleted"] is True
        assert body["cascade"]["raw_documents"] == 1
        assert body["cascade"]["collection_jobs"] == 1

    async def test_endpoint_404_for_missing(self, client, setup_test_db):
        resp = await client.delete("/api/v1/sources/src_missing")
        assert resp.status_code == 404


class TestPauseFeatureRemoved:
    """暂停功能已按用户要求移除（UI/接口都不再提供）。"""

    async def test_pause_endpoint_gone(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            source = Source(name="src_no_pause", source_type="list_page", base_url="https://www.gzhu.edu.cn")
            db.add(source)
            await db.commit()
            source_id = source.id

        resp = await client.post(f"/api/v1/sources/{source_id}/pause")
        assert resp.status_code in (404, 405), resp.status_code

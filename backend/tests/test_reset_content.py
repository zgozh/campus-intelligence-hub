"""reset_content（半清空：只清内容、保留数据源）回归测试。

与 reset_demo 的差别是本文件的核心断言：**数据源必须留下**，否则"保留数据源"的
承诺不成立（reset_demo 会连 Source 一起删）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import (  # noqa: E402
    ChangeEvent,
    CollectionJob,
    KGEntity,
    KGRelation,
    KnowledgeObject,
    RawDocument,
    RunRecord,
    Source,
)
from scripts import reset_content as reset_content_module  # noqa: E402


async def _seed(db) -> None:
    source = Source(name="keep-me", source_type="list_page", base_url="https://www.gzhu.edu.cn/z__l/tzgg.htm")
    db.add(source)
    await db.flush()

    doc = RawDocument(
        source_id=source.id,
        url="https://www.gzhu.edu.cn/info/1087/38277.htm",
        normalized_url="https://www.gzhu.edu.cn/info/1087/38277.htm",
        title="半清空测试文档",
        content="正文",
        content_hash="half-hash",
        version=1,
    )
    db.add(doc)
    await db.flush()

    ko = KnowledgeObject(raw_document_id=doc.id, title=doc.title, status="PUBLISHED")
    db.add(ko)
    await db.flush()

    head = KGEntity(name="广州大学", entity_type="部门", ko_id=ko.id)
    tail = KGEntity(name="教务处", entity_type="部门", ko_id=ko.id)
    db.add_all([head, tail])
    await db.flush()

    db.add_all(
        [
            KGRelation(head_id=head.id, tail_id=tail.id, relation="发布", ko_id=ko.id),
            ChangeEvent(source_id=source.id, normalized_url=doc.normalized_url),
            CollectionJob(source_id=source.id, status="SUCCESS", params={"max_pages": 1}),
            RunRecord(run_id="run_half_reset", type="closed_loop", status="ok"),
        ]
    )
    await db.commit()


async def _count(db, model) -> int:
    from sqlalchemy import func, select

    return await db.scalar(select(func.count()).select_from(model))


class TestResetContent:
    async def test_dry_run_deletes_nothing(self, setup_test_db, monkeypatch):
        monkeypatch.setattr(reset_content_module, "AsyncSessionLocal", database.AsyncSessionLocal)
        async with database.AsyncSessionLocal() as db:
            await _seed(db)

        result = await reset_content_module.reset_content(apply=False)

        assert result["applied"] is False
        assert sum(result["before"].values()) > 0
        assert result["after"] == result["before"], "干跑不得删除任何数据"
        async with database.AsyncSessionLocal() as db:
            assert await _count(db, RawDocument) == 1
            assert await _count(db, KnowledgeObject) == 1

    async def test_apply_clears_content_but_keeps_sources(self, setup_test_db, monkeypatch):
        monkeypatch.setattr(reset_content_module, "AsyncSessionLocal", database.AsyncSessionLocal)
        async with database.AsyncSessionLocal() as db:
            await _seed(db)
            sources_before = await _count(db, Source)

        result = await reset_content_module.reset_content(apply=True)

        assert result["applied"] is True
        assert sum(result["after"].values()) == 0, result["after"]
        assert result["sources_after"] == sources_before, "数据源必须保留（这正是与 reset_demo 的区别）"

        async with database.AsyncSessionLocal() as db:
            assert await _count(db, Source) == sources_before
            for model in (RawDocument, KnowledgeObject, KGEntity, KGRelation, ChangeEvent, CollectionJob, RunRecord):
                assert await _count(db, model) == 0, model.__tablename__

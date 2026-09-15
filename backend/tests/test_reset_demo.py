"""RESET_DEMO 回归测试：清空内容数据必须真的清干净，且顺序不能撞外键。

背景（真实 bug）：reset_demo 的删除清单漏了 ChangeEvent，而 change_events.source_id
是指向 sources 的 NO ACTION 外键 —— 在 PostgreSQL 上执行到最后一步
`delete from sources` 直接报：
    violates foreign key constraint "change_events_source_id_fkey"
即"从头演示"用的一键清库脚本本身是坏的（已在事务里非破坏性复现）。
同理 kg_relations 必须先于 kg_entities 删除。

本文件锁定：① 15 张内容表全部清零；② 配置与账号数据（工作空间/管理员/Agent）不受影响。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import (  # noqa: E402
    AdminUser,
    BriefReport,
    ChangeEvent,
    CollectionJob,
    Conflict,
    DecisionLog,
    Digest,
    InsightReport,
    KGEntity,
    KGRelation,
    KnowledgeObject,
    Notification,
    RawDocument,
    ReviewTask,
    RunRecord,
    Source,
    Workspace,
)
from scripts import seed_demo  # noqa: E402

CONTENT_MODELS = (
    ReviewTask,
    Conflict,
    KGRelation,
    KGEntity,
    KnowledgeObject,
    RawDocument,
    ChangeEvent,
    CollectionJob,
    Source,
    DecisionLog,
    RunRecord,
    Digest,
    InsightReport,
    BriefReport,
    Notification,
)


async def _seed_one_of_each(db) -> None:
    source = Source(name="reset-src", source_type="list_page", base_url="https://www.gzhu.edu.cn/z__l/tzgg.htm")
    db.add(source)
    await db.flush()

    doc = RawDocument(
        source_id=source.id,
        url="https://www.gzhu.edu.cn/info/1087/38277.htm",
        normalized_url="https://www.gzhu.edu.cn/info/1087/38277.htm",
        title="重置测试文档",
        content="正文",
        content_hash="reset-hash",
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
            ReviewTask(knowledge_object_id=ko.id, reason="low_confidence"),
            Conflict(object_a=ko.id, object_b=ko.id, field="截止日期"),
            KGRelation(head_id=head.id, tail_id=tail.id, relation="发布", ko_id=ko.id),
            ChangeEvent(source_id=source.id, normalized_url=doc.normalized_url),
            CollectionJob(source_id=source.id, status="SUCCESS", params={"max_pages": 1}),
            DecisionLog(run_id="run_reset_test", agent="采集", decision="抓取完成"),
            RunRecord(run_id="run_reset_test", type="closed_loop", status="ok"),
            Digest(period="daily", title="日报", content="# 日报"),
            InsightReport(content="# 洞察", title="洞察"),
            BriefReport(content="# 快讯", title="快讯"),
            Notification(kind="system", title="系统通知"),
        ]
    )
    await db.commit()


async def _count_all(db) -> dict[str, int]:
    from sqlalchemy import func, select

    out: dict[str, int] = {}
    for model in CONTENT_MODELS:
        out[model.__tablename__] = await db.scalar(select(func.count()).select_from(model))
    return out


class TestResetDemo:
    async def test_clears_every_content_table(self, setup_test_db, monkeypatch):
        monkeypatch.setattr(seed_demo, "AsyncSessionLocal", database.AsyncSessionLocal)

        async with database.AsyncSessionLocal() as db:
            await _seed_one_of_each(db)
            before = await _count_all(db)
        assert all(v > 0 for v in before.values()), before

        await seed_demo.reset_demo()

        async with database.AsyncSessionLocal() as db:
            after = await _count_all(db)
        assert all(v == 0 for v in after.values()), after

    async def test_keeps_config_and_accounts(self, setup_test_db, monkeypatch):
        """清库不能把账号/工作空间清掉 —— 否则重置完登录不了。"""
        monkeypatch.setattr(seed_demo, "AsyncSessionLocal", database.AsyncSessionLocal)

        async with database.AsyncSessionLocal() as db:
            await _seed_one_of_each(db)
            admins_before = await _scalar_count(db, AdminUser)
            workspaces_before = await _scalar_count(db, Workspace)

        await seed_demo.reset_demo()

        async with database.AsyncSessionLocal() as db:
            assert await _scalar_count(db, AdminUser) == admins_before
            assert await _scalar_count(db, Workspace) == workspaces_before


async def _scalar_count(db, model) -> int:
    from sqlalchemy import func, select

    return await db.scalar(select(func.count()).select_from(model))

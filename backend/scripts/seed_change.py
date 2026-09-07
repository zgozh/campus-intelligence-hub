"""播种演示变更（Change Radar Demo，EPIC 5）。

为某个 Source 的最新文档造一个 v2 变化（如 截止 9/20 → 9/25），产生一条 HIGH ChangeEvent，
供 /changes 与 /changes/{id}/diff 及前端 Diff Viewer 演示。
"""
import asyncio

from sqlalchemy import select

from database import AsyncSessionLocal
from models import KnowledgeObject, RawDocument, Source, compute_content_hash
from services.change_service import detect_and_record_change


async def seed():
    async with AsyncSessionLocal() as db:
        source = (
            await db.execute(select(Source).order_by(Source.created_at.asc()).limit(1))
        ).scalar_one_or_none()
        if not source:
            print("❌ 无 Source，请先添加数据源")
            return
        old = (
            await db.execute(
                select(RawDocument)
                .where(RawDocument.source_id == source.id)
                .order_by(RawDocument.version.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if not old:
            print("❌ 该 Source 无文档，请先采集")
            return

        before = old.content or ""
        if "申报截止时间调整至9月25日" not in before:
            after = before + "\n\n【更新】申报截止时间调整至9月25日，申请对象为全日制研究生。"
        else:
            after = before.replace("9月25日", "9月20日")

        if after == before:
            print("⚠️ 内容未变化，跳过")
            return

        # 跳过一次内容相同的版本：对版本号继续递增
        new = RawDocument(
            source_id=source.id,
            url=old.url,
            normalized_url=old.normalized_url,
            title=old.title,
            canonical_title=old.canonical_title,
            content=after,
            content_hash=compute_content_hash(after),
            version=old.version + 1,
            publish_time=old.publish_time,
            source_site=old.source_site,
            column=old.column,
            department=old.department,
        )
        db.add(new)
        await db.flush()

        old_kos = await db.execute(
            select(KnowledgeObject).where(KnowledgeObject.raw_document_id == old.id)
        )
        for ko in old_kos.scalars():
            ko.status = "EXPIRED"

        ce = await detect_and_record_change(db, source, old, new)
        await db.commit()
        print(f"✅ 已播种变更：{ce.id} severity={ce.severity} summary={ce.diff_summary}")


if __name__ == "__main__":
    asyncio.run(seed())

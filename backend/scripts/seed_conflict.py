"""播种演示冲突（spec §16 Conflict）：用两个现有 PUBLISHED KO 造一个 open 冲突，供决策演示。

用法：docker exec campus-backend python -m scripts.seed_conflict
"""
import asyncio

from sqlalchemy import select

from database import AsyncSessionLocal
from models import Conflict, KnowledgeObject


async def seed():
    async with AsyncSessionLocal() as db:
        kos = (
            await db.execute(
                select(KnowledgeObject).where(KnowledgeObject.status == "PUBLISHED").limit(2)
            )
        ).scalars().all()
        if len(kos) < 2:
            print("❌ 需要至少 2 个已发布知识对象")
            return
        a, b = kos[0], kos[1]
        exists = await db.scalar(
            select(Conflict.id).where(
                Conflict.object_a == a.id,
                Conflict.object_b == b.id,
                Conflict.status == "open",
            )
        )
        if exists:
            print(f"⚠️ 已存在冲突 {exists}，跳过")
            return
        cf = Conflict(
            object_a=a.id,
            object_b=b.id,
            field="截止日期",
            value_a="2026-09-20",
            value_b="2026-09-25",
            status="open",
        )
        db.add(cf)
        await db.commit()
        await db.refresh(cf)
        print(f"✅ 已播种冲突: {cf.id} value_a={cf.value_a} value_b={cf.value_b}")


if __name__ == "__main__":
    asyncio.run(seed())

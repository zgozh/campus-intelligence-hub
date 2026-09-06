"""演示模拟数据播种（幂等可重跑，spec §32 SEED_DEMO）。

用法：docker exec campus-backend python3 -m scripts.seed_demo
"""
import asyncio

from sqlalchemy import delete

from agents.classifier import classify_category, rule_tag_topics
from agents.extractor import infer_expiry
from collectors.dedup import content_hash
from database import AsyncSessionLocal
from models import (
    CollectionJob,
    Conflict,
    Digest,
    KnowledgeObject,
    RawDocument,
    ReviewTask,
    Source,
    normalize_url,
)
from scripts.demo_templates import DEMO_ARTICLES

_TYPE_MAP = {
    "通知公告": "Announcement",
    "办事指南": "Procedure",
    "规章制度": "Regulation",
    "新闻动态": "Event",
}


async def reset_demo() -> None:
    """清空所有数据（RESET_DEMO）。"""
    async with AsyncSessionLocal() as db:
        for model in (ReviewTask, Conflict, Digest, KnowledgeObject, RawDocument, CollectionJob, Source):
            await db.execute(delete(model))
        await db.commit()


async def seed_all() -> int:
    """播种演示数据（先清空，幂等）。"""
    await reset_demo()
    async with AsyncSessionLocal() as db:
        source = Source(id="src_demo", name="演示数据源", source_type="manual", base_url=None)
        db.add(source)
        await db.flush()

        for i, t in enumerate(DEMO_ARTICLES):
            url = f"https://demo.gzhu.edu.cn/demo/{i + 1:02d}.htm"
            chash = content_hash(t.content)
            doc = RawDocument(
                id=f"rdoc_demo_{i + 1:02d}",
                source_id=source.id,
                url=url,
                normalized_url=normalize_url(url),
                title=t.title,
                canonical_title=t.title,
                content=t.content,
                content_hash=chash,
                version=1,
                publish_time=t.publish_date,
                source_site="demo",
                column=t.column,
                department=t.department,
            )
            db.add(doc)
            await db.flush()

            category = classify_category(t.title, t.column)
            tags = rule_tag_topics(t.title, t.content) or [t.topic]
            deadline = infer_expiry(t.title, t.content, category, t.publish_date)
            facts = [
                {"field": "发布日期", "value": t.publish_date},
                {"field": "部门", "value": t.department},
            ]
            if deadline:
                facts.append({"field": "截止日期", "value": deadline})

            ko = KnowledgeObject(
                id=f"ko_demo_{i + 1:02d}",
                raw_document_id=doc.id,
                type=_TYPE_MAP.get(category, "Announcement"),
                title=t.title,
                department=t.department,
                effective_from=t.publish_date,
                effective_to=deadline,
                facts=facts,
                summary=t.content,
                tags=tags,
                confidence=0.85,
                status="PUBLISHED",
                version=1,
                source_url=url,
            )
            db.add(ko)

        await db.commit()
        return len(DEMO_ARTICLES)


if __name__ == "__main__":
    n = asyncio.run(seed_all())
    print(f"播种完成：{n} 篇演示知识对象")

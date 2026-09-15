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
    normalize_url,
)
from scripts.demo_templates import DEMO_ARTICLES

# 清库删除顺序 = 外键依赖由深到浅。
#
# 为什么必须是这个顺序：库里所有外键都是 NO ACTION（没有 DB 级级联），顺序错了会被挡住。
# 历史 bug：本清单漏了 ChangeEvent，于是 PostgreSQL 上执行到最后一步 `delete from sources`
# 直接报 `violates foreign key constraint "change_events_source_id_fkey"` ——
# 也就是"从头演示"用的一键清库脚本本身是坏的（数据源删除端点当年同样被这个外键挡住）。
# 同理 kg_relations.head_id/tail_id 指向 kg_entities，必须先删关系。
_RESET_ORDER = (
    ReviewTask,  # → knowledge_objects
    Conflict,  # 字符串引用 KO（无外键，但不清就是悬空冲突）
    KGRelation,  # → kg_entities（head_id / tail_id）
    KGEntity,
    KnowledgeObject,  # → raw_documents
    RawDocument,  # → sources
    ChangeEvent,  # → sources  ← 曾经漏掉这一项
    CollectionJob,  # → sources
    Source,
    DecisionLog,  # 闭环决策日志（run_id 与 RunRecord 同名，仅字符串关联）
    RunRecord,
    Digest,
    InsightReport,
    BriefReport,
    Notification,
)


async def reset_demo() -> None:
    """清空所有**内容**数据（RESET_DEMO）：采集/知识/图谱/自动化产物 + 数据源。

    保留工作空间/Agent/管理员/租户/知识库(KB)/会话等**配置与账号**数据——
    它们不是演示内容，清掉会导致登录不了、还得重新配置环境。
    """
    async with AsyncSessionLocal() as db:
        for model in _RESET_ORDER:
            await db.execute(delete(model))
        await db.commit()

_TYPE_MAP = {
    "通知公告": "Announcement",
    "办事指南": "Procedure",
    "规章制度": "Regulation",
    "新闻动态": "Event",
}


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
            await db.flush()
            # 语义向量入库（DashScope embedding → Qdrant）
            try:
                from agents.embedding import embed_texts
                from services.vector_service import ensure_collection, upsert_ko

                await ensure_collection()
                embs = await embed_texts([t.title + " " + t.content[:500]])
                if embs:
                    await upsert_ko(ko.id, embs[0], {"title": t.title, "type": ko.type})
            except Exception as e:
                print(f"  向量入库失败 {t.title}: {e}")

        await db.commit()
        return len(DEMO_ARTICLES)


if __name__ == "__main__":
    n = asyncio.run(seed_all())
    print(f"播种完成：{n} 篇演示知识对象")

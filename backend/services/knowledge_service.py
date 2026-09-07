"""RawDocument → KnowledgeObject 编排（EPIC 6，规则主链路）。"""
import logging

from agents.classifier import classify_category, rule_tag_topics
from agents.curator import summarize
from agents.extractor import extract_department, infer_expiry
from config import AUTHORITY_TIERS, DEFAULT_AUTHORITY
from models import KnowledgeObject, RawDocument

logger = logging.getLogger(__name__)

_TYPE_MAP = {
    "通知公告": "Announcement",
    "办事指南": "Procedure",
    "规章制度": "Regulation",
    "新闻动态": "Event",
}


async def build_knowledge_object(db, raw_doc: RawDocument, source=None) -> KnowledgeObject:
    """从 RawDocument 生成 KnowledgeObject。"""
    await db.flush()  # 确保 raw_doc.id 已生成

    title = raw_doc.title
    content = raw_doc.content or ""
    category = classify_category(title, raw_doc.column or "")
    tags = rule_tag_topics(title, content)
    publish_date = raw_doc.publish_time or ""
    deadline = infer_expiry(title, content, category, publish_date)
    department = raw_doc.department or extract_department(content)

    facts = []
    if publish_date:
        facts.append({"field": "发布日期", "value": publish_date})
    if deadline:
        facts.append({"field": "截止日期", "value": deadline})
    if department:
        facts.append({"field": "部门", "value": department})

    # 权威度：优先 Source.authority，其次按 source_type 配置，缺省 DEFAULT_AUTHORITY
    authority = DEFAULT_AUTHORITY
    if source is not None and getattr(source, "authority", None):
        authority = source.authority
    elif source is not None:
        authority = AUTHORITY_TIERS.get(getattr(source, "source_type", ""), DEFAULT_AUTHORITY)

    ko = KnowledgeObject(
        raw_document_id=raw_doc.id,
        type=_TYPE_MAP.get(category, "Announcement"),
        title=title,
        department=department,
        effective_from=publish_date or None,
        effective_to=deadline,
        facts=facts,
        entities=[],
        summary=summarize(content),
        tags=tags,
        confidence=0.8,
        status="PUBLISHED",
        version=raw_doc.version,
        source_url=raw_doc.url,
        authority=authority,
        freshness_level="Unknown",
        source_version=raw_doc.version,
        last_verified_at=raw_doc.fetched_at,
    )
    db.add(ko)
    await db.flush()  # 确保 ko.id 已生成

    # 语义向量入库（可选，失败降级仅关键词检索）
    try:
        from agents.embedding import embed_texts
        from services.vector_service import ensure_collection, upsert_ko

        await ensure_collection()
        embs = await embed_texts([title + " " + (ko.summary or "")[:500]])
        if embs:
            await upsert_ko(ko.id, embs[0], {"title": title, "type": ko.type})
    except Exception:
        logger.warning("向量入库失败（降级仅关键词检索）")

    return ko

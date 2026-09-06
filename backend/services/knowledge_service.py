"""RawDocument → KnowledgeObject 编排（EPIC 6，规则主链路）。"""
from agents.classifier import classify_category, rule_tag_topics
from agents.curator import summarize
from agents.extractor import extract_department, infer_expiry
from models import KnowledgeObject, RawDocument

_TYPE_MAP = {
    "通知公告": "Announcement",
    "办事指南": "Procedure",
    "规章制度": "Regulation",
    "新闻动态": "Event",
}


async def build_knowledge_object(db, raw_doc: RawDocument) -> KnowledgeObject:
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
    )
    db.add(ko)
    return ko

"""校务知识图谱（A）：构建 + 图谱检索 + 图谱问答（参考 GraphRAG 通用模式）。

流程：LLM 抽取三元组 -> 去重入库 -> 图谱检索（实体匹配 -> 邻居遍历）-> LLM 回答。
"""
import json
import logging

from sqlalchemy import select

from agents.kg_extractor import extract_query_entities, extract_triples
from agents.llm import ask_llm
from models import KGEntity, KGRelation, KnowledgeObject

logger = logging.getLogger(__name__)

GRAPH_PROMPT = """你是校务知识图谱问答助手。基于下方【图谱上下文】回答，尽量引用实体-关系。
若图谱上下文不足，明确说"图谱中暂未找到足够关联信息"。只输出回答，简体中文。

【图谱上下文】
{context}

【问题】
{query}"""


async def build_graph(db, limit: int = 50) -> dict:
    """从发布版 KO 抽取三元组构建图谱（按 head+relation+tail 去重）。"""
    kos = (
        await db.execute(
            select(KnowledgeObject).where(KnowledgeObject.status == "PUBLISHED").limit(limit)
        )
    ).scalars().all()
    relations_added = skipped = 0
    ko_count = len(kos)
    for ko in kos:
        facts_str = json.dumps(ko.facts, ensure_ascii=False) if ko.facts else ""
        content = (ko.summary or "") + "\n" + facts_str
        triples = await extract_triples(content)
        for t in triples:
            head = await _get_or_create_entity(db, t["head"], t["head_type"], ko.id)
            tail = await _get_or_create_entity(db, t["tail"], t["tail_type"], ko.id)
            if not head or not tail:
                skipped += 1
                continue
            exists = await db.scalar(
                select(KGRelation.id).where(
                    KGRelation.head_id == head.id,
                    KGRelation.tail_id == tail.id,
                    KGRelation.relation == t["relation"],
                )
            )
            if not exists:
                db.add(
                    KGRelation(
                        head_id=head.id, tail_id=tail.id, relation=t["relation"], ko_id=ko.id
                    )
                )
                relations_added += 1
    await db.commit()
    logger.info("图谱构建：ko=%d relations_added=%d skipped=%d", ko_count, relations_added, skipped)
    return {"ko_count": ko_count, "relations_added": relations_added, "skipped": skipped}


async def _get_or_create_entity(db, name: str, etype: str, ko_id: str | None):
    name = (name or "").strip()
    if not name:
        return None
    e = await db.scalar(select(KGEntity).where(KGEntity.name == name))
    if not e:
        e = KGEntity(name=name, entity_type=etype or "对象", ko_id=ko_id)
        db.add(e)
        await db.flush()
    return e


async def list_graph(db, limit: int = 300) -> dict:
    """返回实体与关系列表（供图谱展示）。"""
    entities = (await db.execute(select(KGEntity).order_by(KGEntity.name).limit(limit))).scalars().all()
    relations = (await db.execute(select(KGRelation).order_by(KGRelation.created_at.desc()).limit(limit))).scalars().all()
    return {
        "entities": [{"id": e.id, "name": e.name, "type": e.entity_type, "ko_id": e.ko_id} for e in entities],
        "relations": [{"id": r.id, "head_id": r.head_id, "tail_id": r.tail_id, "relation": r.relation} for r in relations],
        "entity_count": len(entities),
        "relation_count": len(relations),
    }


async def graph_ask(db, query: str, top_k: int = 8) -> dict:
    """图谱问答：抽查询实体 -> 图邻居 + 关联 KO 摘要 -> LLM 回答。"""
    ent_names = await extract_query_entities(query)
    graph_lines: list[str] = []
    nodes: dict[str, KGEntity] = {}
    for name in ent_names:
        ents = (
            await db.execute(select(KGEntity).where(KGEntity.name.ilike(f"%{name}%")).limit(5))
        ).scalars().all()
        for e in ents:
            nodes[e.id] = e
            out = await db.execute(
                select(KGRelation, KGEntity).join(KGEntity, KGEntity.id == KGRelation.tail_id).where(
                    KGRelation.head_id == e.id
                )
            )
            for rel, tail in out.all():
                nodes[tail.id] = tail
                graph_lines.append(f"{e.name} -[{rel.relation}]-> {tail.name}")
            inb = await db.execute(
                select(KGRelation, KGEntity).join(KGEntity, KGEntity.id == KGRelation.head_id).where(
                    KGRelation.tail_id == e.id
                )
            )
            for rel, head in inb.all():
                nodes[head.id] = head
                graph_lines.append(f"{head.name} -[{rel.relation}]-> {e.name}")

    if not graph_lines:
        return {"answer": "图谱中暂未找到与问题相关的实体关系，可先构建知识图谱。", "related": [], "grounded": False}

    ko_summaries: list[str] = []
    ko_ids = {e.ko_id for e in nodes.values() if e.ko_id}
    for kid in list(ko_ids)[:5]:
        ko = await db.get(KnowledgeObject, kid)
        if ko:
            ko_summaries.append(f"· {ko.title}：{(ko.summary or '')[:80]}")

    context = "\n".join(graph_lines[:40]) + "\n\n相关知识点：\n" + "\n".join(ko_summaries)
    answer = await ask_llm(GRAPH_PROMPT.format(context=context, query=query))
    return {"answer": answer, "related": [n.name for n in nodes.values()], "grounded": True}

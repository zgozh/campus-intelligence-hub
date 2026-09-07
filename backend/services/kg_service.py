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


async def build_graph(db, limit: int = 50, force: bool = False) -> dict:
    """从发布版 KO 抽取三元组构建图谱，增量 + 并发 + 生命周期一致。

    修复与增强：
    - 并发抽取（asyncio 信号量限流），避免串行 20 次 LLM 超时/卡住；
    - 增量：默认仅处理尚未在图谱中贡献关系的 KO；force=True 时对全部 KO 重抽（反映内容改动）；
    - 防御：单条三元组畸形逐个跳过，不中断整体；
    - 一致性：归档/过期 KO 的关系与孤立节点自动清理。
    """
    kos = (
        await db.execute(
            select(KnowledgeObject).where(KnowledgeObject.status == "PUBLISHED").limit(limit)
        )
    ).scalars().all()
    ko_count = len(kos)
    relations_added = skipped = 0

    # 已在图谱中贡献过关系的 KO（增量跳过）；force 时全量重抽
    done_ids = (
        set()
        if force
        else set(
            (await db.execute(select(KGRelation.ko_id).where(KGRelation.ko_id.isnot(None)))).scalars().all()
        )
    )

    # 并发抽取（纯 LLM，无 DB 占用；失败返回 None 降级）
    import asyncio

    sem = asyncio.Semaphore(4)

    async def _extract(content: str):
        async with sem:
            try:
                return await extract_triples(content)
            except Exception:  # noqa: BLE001
                return None

    to_build = [ko for ko in kos if ko.id not in done_ids]
    results = await asyncio.gather(*[_extract((ko.summary or "") + "\n" + (json.dumps(ko.facts, ensure_ascii=False) if ko.facts else "")) for ko in to_build])

    for ko, triples in zip(to_build, results):
        if triples is None:
            skipped += 1
            continue
        if not isinstance(triples, list):
            continue
        for t in triples:
            if not isinstance(t, dict):
                skipped += 1
                continue
            try:
                head_name = str(t.get("head") or "").strip()
                tail_name = str(t.get("tail") or "").strip()
                relation = str(t.get("relation") or "").strip()
                head_type = str(t.get("head_type") or "对象")[:20]
                tail_type = str(t.get("tail_type") or "对象")[:20]
                if not head_name or not tail_name or not relation:
                    skipped += 1
                    continue
                head = await _get_or_create_entity(db, head_name, head_type, ko.id)
                tail = await _get_or_create_entity(db, tail_name, tail_type, ko.id)
                if not head or not tail:
                    skipped += 1
                    continue
                exists = await db.scalar(
                    select(KGRelation.id).where(
                        KGRelation.head_id == head.id,
                        KGRelation.tail_id == tail.id,
                        KGRelation.relation == relation,
                    )
                )
                if not exists:
                    db.add(
                        KGRelation(
                            head_id=head.id, tail_id=tail.id, relation=relation, ko_id=ko.id
                        )
                    )
                    relations_added += 1
            except Exception:  # noqa: BLE001 单条三元组处理失败跳过
                skipped += 1
                continue

    # 一致性清理：删除来源 KO 已不再 PUBLISHED 的关系，以及由此产生的孤立实体
    await _maintain_consistency(db)

    await db.commit()
    logger.info(
        "图谱构建：ko=%d(新处理%d) relations_added=%d skipped=%d",
        ko_count,
        len(to_build),
        relations_added,
        skipped,
    )
    return {"ko_count": ko_count, "relations_added": relations_added, "skipped": skipped}


async def _maintain_consistency(db):
    """图谱与数据源生命周期一致性：删除已归档/过期/非发布 KO 贡献的关系，再清孤立实体。"""
    # 当前所有 PUBLISHED KO id
    pub_ids = list(
        (await db.execute(select(KnowledgeObject.id).where(KnowledgeObject.status == "PUBLISHED"))).scalars().all()
    )
    # 删除来源 KO 已不在发布集的关系
    if pub_ids:
        orphan_rels = (
            await db.execute(
                select(KGRelation).where(
                    KGRelation.ko_id.isnot(None),
                    KGRelation.ko_id.notin_(pub_ids),
                )
            )
        ).scalars().all()
    else:
        orphan_rels = (
            await db.execute(select(KGRelation).where(KGRelation.ko_id.isnot(None)))
        ).scalars().all()
    for r in orphan_rels:
        await db.delete(r)

    # 删除已无任何关系、且其来源 KO 不在发布集的孤立实体
    all_entities = (await db.execute(select(KGEntity))).scalars().all()
    for e in all_entities:
        linked = await db.scalar(
            select(KGRelation.id).where(
                (KGRelation.head_id == e.id) | (KGRelation.tail_id == e.id)
            )
        )
        if linked:
            continue
        if e.ko_id is None or e.ko_id not in pub_ids:
            await db.delete(e)


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

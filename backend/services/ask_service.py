"""Ask AI（EPIC 9 / D）：融合检索 → Rerank 精排 → 意图/部门路由 → GraphRAG 图谱线索
→ 组装上下文 → LLM 生成答案 + Evidence-first citation + Answer Guard。
"""
import json
import logging

from sqlalchemy import or_, select

from agents.llm import ask_llm
from agents.reranker import rerank_documents
from agents.router import route_query
from models import KGEntity, KGRelation, KnowledgeObject
from services.search_service import search_knowledge

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是「校务智汇中台」的智能助手，回答师生关于校务办事流程、通知公告、规章制度的问题。

规则：
1. 只能依据下方【知识片段】与【图谱线索】回答，每个关键信息后标注来源编号，如[来源1]或[图谱]。
2. 若知识片段不足以回答问题，必须明确说"当前知识库没有足够依据确认该问题"，并给出可能的咨询方向，绝不编造、绝不猜测。
3. 若某片段标记了"（可能已过期）"，回答时提醒用户以最新通知为准。
4. 回答用简体中文，条理清晰，先给结论再给细节。"""

# Answer Guard：无任何知识依据时直接拒答（不调用 LLM，防幻觉）
NO_GROUNDING_ANSWER = (
    "当前知识库没有足够依据确认该问题。可前往对应部门官网查看最新通知，"
    "或换一个与校务相关的表述后重试。"
)


def _query_terms(query: str) -> set[str]:
    """查询的关键词（2 字滑窗），用于相关性门控。"""
    q = (query or "").strip()
    if not q:
        return set()
    terms = set()
    for i in range(max(1, len(q) - 1)):
        t = q[i : i + 2]
        if len(t) >= 2:
            terms.add(t)
    return terms


def _grounding_ok(ko, query: str) -> bool:
    """相关性门控：知识必须与查询共享关键词，否则不可作为依据（防幻觉拒答）。"""
    terms = _query_terms(query)
    if not terms:
        return True
    text = f"{ko.title or ''} {ko.summary or ''} " + " ".join(
        str(f.get("value", "")) for f in (ko.facts or []) if isinstance(f, dict)
    )
    return any(t in text for t in terms)


def _ko_text(ko) -> str:
    parts = []
    if ko.summary:
        parts.append(f"摘要：{ko.summary}")
    if ko.facts:
        parts.append("关键信息：" + json.dumps(ko.facts, ensure_ascii=False))
    return "\n".join(parts)


async def _graph_evidence(db, query: str, kos: list, max_lines: int = 6) -> list[str]:
    """GraphRAG 融合：用中文 2 字滑窗与图谱实体名双向匹配，取命中实体的一跳邻居做线索补充。"""

    def shingles(text: str) -> set[str]:
        return {text[i : i + 2] for i in range(max(1, len(text) - 1))}

    q_shingles = set()
    for token in [query] + [k.title or "" for k in kos] + [k.summary or "" for k in kos]:
        token = (token or "").strip()
        if token:
            q_shingles |= shingles(token)

    # 图谱实体（数量可控，全量加载做子串/滑窗匹配）
    all_ents = (await db.execute(select(KGEntity))).scalars().all()
    matched_names: set[str] = set()
    for e in all_ents:
        name = e.name
        if not name:
            continue
        if name in query or any(s in shingles(name) for s in q_shingles):
            matched_names.add(name)

    ents = [e for e in all_ents if e.name in matched_names]

    lines: list[str] = []
    seen: set[str] = set()
    if ents:
        ent_ids = [e.id for e in ents]
        rels = (
            await db.execute(
                select(KGRelation).where(
                    or_(KGRelation.head_id.in_(ent_ids), KGRelation.tail_id.in_(ent_ids))
                )
            )
        ).scalars().all()
        ent_map = {e.id: e for e in ents}
        for rel in rels[:max_lines]:
            head = ent_map.get(rel.head_id)
            tail = ent_map.get(rel.tail_id)
            if not head or not tail:
                continue
            line = f"{head.name}（{head.entity_type}）-{rel.relation}-> {tail.name}（{tail.entity_type}）"
            if line not in seen:
                seen.add(line)
                lines.append(line)
    return lines


async def ask(db, query: str, top_k: int = 5, rerank: bool = True) -> dict:
    """检索（融合评分）+ 重排 + 路由 + GraphRAG → 生成答案 + 来源引用。"""
    route = route_query(query)
    kos = await search_knowledge(db, query, top_k=top_k * 2)

    # ---------- Rerank 精排（gte-rerank-v2，退化时保持原序；rerank=False 跳过） ----------
    if kos and rerank:
        docs = [(_ko_text(ko) or ko.title) for ko in kos]
        ordered = await rerank_documents(query, docs, top_n=top_k)
        if ordered:
            kos = [kos[i] for i in ordered if i < len(kos)]

    # 只保留 top_k（重排后截断，避免超长上下文）
    kos = kos[:top_k]

    # ---------- 意图/部门路由：部门命中者加权上浮（稳定排序保留内部顺序） ----------
    if route["department"]:
        kos = sorted(
            kos,
            key=lambda ko: (ko.department == route["department"],),
            reverse=True,
        )

    # ---------- 相关性门控（防幻觉）：知识与查询须共享关键词，否则视为无依据拒答 ----------
    kos = [ko for ko in kos if _grounding_ok(ko, query)]

    # Answer Guard：无依据 → 拒答模板
    if not kos:
        return {
            "answer": NO_GROUNDING_ANSWER,
            "citations": [],
            "query": query,
            "grounded": False,
            "intent": route["intent"],
            "department": route["department"],
        }

    # ---------- GraphRAG 图谱线索 ----------
    graph_lines = await _graph_evidence(db, query, kos)

    context_lines = []
    citations = []
    for i, ko in enumerate(kos, 1):
        meta = f"{ko.type}·{ko.department}" if ko.department else ko.type
        expired_note = "（可能已过期）" if ko.status == "EXPIRED" else ""
        freshness_note = (
            f"（时效：{ko.freshness_level}）"
            if ko.freshness_level and ko.freshness_level != "Unknown"
            else ""
        )
        facts_str = json.dumps(ko.facts, ensure_ascii=False) if ko.facts else ""
        context_lines.append(
            f"[来源{i}] {meta}{expired_note}{freshness_note}\n标题：{ko.title}\n"
            f"摘要：{ko.summary or ''}\n关键信息：{facts_str}"
        )
        citations.append(
            {
                "id": ko.id,
                "title": ko.title,
                "url": ko.source_url,
                "type": ko.type,
                "department": ko.department,
                "status": ko.status,
                "effective_from": ko.effective_from,
                "effective_to": ko.effective_to,
                "freshness": ko.freshness_level,
                "authority": ko.authority,
                "confidence": ko.confidence,
                "summary": ko.summary,
                "version": ko.version,
            }
        )

    if graph_lines:
        context_lines.insert(0, "[图谱线索]\n" + "\n".join(graph_lines))

    context = "\n\n".join(context_lines)
    answer = await ask_llm(
        f"知识片段：\n{context}\n\n问题：{query}", system=SYSTEM_PROMPT
    )
    return {
        "answer": answer,
        "citations": citations,
        "query": query,
        "grounded": True,
        "intent": route["intent"],
        "department": route["department"],
        "graph_hints": graph_lines,
    }

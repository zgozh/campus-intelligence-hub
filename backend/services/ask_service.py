"""Ask AI（EPIC 9）：融合检索 → 组装上下文 → LLM 生成答案 + Evidence-first citation + Answer Guard。"""
import json

from agents.llm import ask_llm
from services.search_service import search_knowledge

SYSTEM_PROMPT = """你是「校务智汇中台」的智能助手，回答师生关于校务办事流程、通知公告、规章制度的问题。

规则：
1. 只能依据下方【知识片段】回答，每个关键信息后标注来源编号，如[来源1]。
2. 若知识片段不足以回答问题，必须明确说"当前知识库没有足够依据确认该问题"，并给出可能的咨询方向，绝不编造、绝不猜测。
3. 若某片段标记了"（可能已过期）"，回答时提醒用户以最新通知为准。
4. 回答用简体中文，条理清晰，先给结论再给细节。"""

# Answer Guard：无任何知识依据时直接拒答（不调用 LLM，防幻觉）
NO_GROUNDING_ANSWER = (
    "当前知识库没有足够依据确认该问题。可前往对应部门官网查看最新通知，"
    "或换一个与校务相关的表述后重试。"
)


async def ask(db, query: str, top_k: int = 5) -> dict:
    """检索（融合评分）→ 生成答案 + 来源引用（含 Freshness/权威度/有效期/置信度）。"""
    kos = await search_knowledge(db, query, top_k=top_k)

    # Answer Guard：无依据 → 拒答模板
    if not kos:
        return {
            "answer": NO_GROUNDING_ANSWER,
            "citations": [],
            "query": query,
            "grounded": False,
        }

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

    context = "\n\n".join(context_lines)
    answer = await ask_llm(
        f"知识片段：\n{context}\n\n问题：{query}", system=SYSTEM_PROMPT
    )
    return {"answer": answer, "citations": citations, "query": query, "grounded": True}

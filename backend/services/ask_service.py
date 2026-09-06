"""Ask AI（EPIC 8）：检索 → 组装上下文 → LLM 生成答案 + citation。"""
import json

from agents.llm import ask_llm
from services.search_service import search_knowledge

SYSTEM_PROMPT = """你是「校务智汇中台」的智能助手，回答师生关于校务办事流程、通知公告、规章制度的问题。

规则：
1. 只能依据下方【知识片段】回答，每个关键信息后标注来源编号，如[来源1]。
2. 若知识片段不足以回答问题，明确说"知识库中暂未找到相关内容"，并给出可能的咨询方向，绝不编造。
3. 若某片段标记了"（可能已过期）"，回答时提醒用户以最新通知为准。
4. 回答用简体中文，条理清晰，先给结论再给细节。"""


async def ask(db, query: str, top_k: int = 5) -> dict:
    """检索 + 生成答案 + 来源引用。"""
    kos = await search_knowledge(db, query, top_k=top_k)

    context_lines = []
    citations = []
    for i, ko in enumerate(kos, 1):
        meta = f"{ko.type}·{ko.department}" if ko.department else ko.type
        expired_note = "（可能已过期）" if ko.status == "EXPIRED" else ""
        facts_str = json.dumps(ko.facts, ensure_ascii=False) if ko.facts else ""
        context_lines.append(
            f"[来源{i}] {meta}{expired_note}\n标题：{ko.title}\n"
            f"摘要：{ko.summary or ''}\n关键信息：{facts_str}"
        )
        citations.append(
            {
                "title": ko.title,
                "url": ko.source_url,
                "type": ko.type,
                "department": ko.department,
                "status": ko.status,
                "effective_to": ko.effective_to,
            }
        )

    context = "\n\n".join(context_lines) if context_lines else "（知识库中暂无相关内容）"
    answer = await ask_llm(
        f"知识片段：\n{context}\n\n问题：{query}", system=SYSTEM_PROMPT
    )
    return {"answer": answer, "citations": citations, "query": query}

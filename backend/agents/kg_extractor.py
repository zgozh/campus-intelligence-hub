"""知识图谱抽取器（A）：LLM 从校务文档抽取"实体-关系-实体"三元组。

参考 DocPolicyKG / UniAI-GraphRAG：LLM 受 schema 约束抽取三元组，构建校务知识图谱。
"""
import json
import re

from agents.llm import ask_llm

KG_PROMPT = """你是校务知识图谱构建器。从下方【知识内容】抽取"实体-关系-实体"三元组。

实体类型(仅这些)：部门、政策、事件、对象、时间、文件。
关系类型(仅这些)：发布、废止、修订、适用、隶属、关联、截止、面向、制定。

只输出一个 JSON 数组，每项格式：
{"head":"实体名","head_type":"实体类型","relation":"关系","tail":"实体名","tail_type":"实体类型"}

要求：只保留知识内容中明确出现的实体与关系；无法抽取则输出 []。不要输出数组以外的任何文字。

【知识内容】
{content}"""

QUERY_ENTITIES_PROMPT = (
    "从下列问题中抽取 1-2 个最可能作为知识图谱实体的词（如部门名、政策名、事项名）。"
    '只输出 JSON 数组，如 ["研究生院","奖助学金办法"]。即使不确定，也要输出问题中最重要的 1-2 个实词。不要输出其他文字。\n问题：{query}'
)


async def extract_triples(content: str) -> list[dict]:
    """从校务内容抽三元组。无 key 走 Mock 时可能返回空。"""
    if not content or len(content.strip()) < 20:
        return []
    text = await ask_llm(KG_PROMPT.replace("{content}", content[:3000]))
    m = re.search(r"\[[\s\S]*\]", text)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except (ValueError, json.JSONDecodeError):
        return []
    out = []
    for t in data:
        if isinstance(t, str):  # LLM 有时返回 JSON 字符串元素
            try:
                t = json.loads(t)
            except (ValueError, json.JSONDecodeError):
                continue
        if not isinstance(t, dict):
            continue
        head = str(t.get("head") or "").strip()
        tail = str(t.get("tail") or "").strip()
        relation = str(t.get("relation") or "").strip()
        if not head or not tail or not relation:
            continue
        out.append({
            "head": head,
            "head_type": str(t.get("head_type") or "对象").strip(),
            "relation": relation,
            "tail": tail,
            "tail_type": str(t.get("tail_type") or "对象").strip(),
        })
    return out


async def extract_query_entities(query: str) -> list[str]:
    """从问题抽实体名（供图谱检索）。"""
    text = await ask_llm(QUERY_ENTITIES_PROMPT.replace("{query}", query))
    m = re.search(r"\[[\s\S]*\]", text)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
        return [str(x) for x in data if x]
    except (ValueError, json.JSONDecodeError):
        return []

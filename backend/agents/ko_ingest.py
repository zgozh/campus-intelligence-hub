"""知识对象文件入库（P2-2）：LLM 从本地 md/pdf 文本抽取结构化字段，失败降级规则式。

抽取 {title, category, department, summary, facts, tags}，供创建新知识对象。
无 API key / 解析失败时返回合法最小字段，调用方据此建 KO（不 500）。
"""
import json
import logging

from agents.llm import ask_llm

logger = logging.getLogger(__name__)

INGEST_PROMPT = """你是一名高校校务知识库的录入员。从下面的文本中抽取校务知识，输出 JSON（不要额外文字）：
{{"title":"标题","category":"通知公告|办事指南|规章制度|新闻动态|政策","department":"部门","summary":"一句话摘要","facts":[{{"field":"字段名","value":"值"}}],"tags":["标签1","标签2"]}}

文本：
{text}

要求：title 不超过 50 字；facts 提取关键字段（如 截止日期/申请时间/材料/联系人）；无法确定的事实不要编造。"""


def _fallback(text: str, filename: str) -> dict:
    """规则兜底：用首行做标题，摘要取前 120 字。"""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    title = (lines[0] if lines else filename or "上传文件")[:50]
    return {
        "title": title or filename or "上传文件",
        "category": "通知公告",
        "department": None,
        "summary": (text[:120] or "").replace("\n", " "),
        "facts": [],
        "tags": [],
    }


async def extract_from_text(text: str, filename: str) -> dict:
    """LLM 抽取结构化字段，失败降级规则式。"""
    if not text.strip():
        return _fallback(text, filename)
    try:
        raw = await ask_llm(
            INGEST_PROMPT.replace("{text}", text[:6000]),
            system="你是高校校务知识库录入员。",
        )
        start, end = raw.find("{"), raw.rfind("}")
        if start == -1 or end == -1:
            return _fallback(text, filename)
        data = json.loads(raw[start : end + 1])
        title = (data.get("title") or filename or "上传文件")[:50]
        category = data.get("category") or "通知公告"
        if category not in ("通知公告", "办事指南", "规章制度", "新闻动态", "政策"):
            category = "通知公告"
        facts = data.get("facts", []) if isinstance(data.get("facts"), list) else []
        facts = [f for f in facts if isinstance(f, dict) and f.get("field") and (f.get("value") is not None)]
        tags = data.get("tags", []) if isinstance(data.get("tags"), list) else []
        return {
            "title": title,
            "category": category,
            "department": data.get("department") or None,
            "summary": data.get("summary") or (text[:120] or "").replace("\n", " "),
            "facts": facts[:12],
            "tags": [str(t) for t in tags][:8],
        }
    except Exception as e:
        logger.warning("知识对象文件 LLM 抽取异常（降级规则式）: %s", e)
        return _fallback(text, filename)

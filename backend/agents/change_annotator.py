"""语义变化标注器（B）：LLM 比较新旧正文，判定语义级变化 + 一句话变更摘要。

增强现有基于 hash 的 Change Radar：把"变没变"升级为"变了什么语义"。
无 LLM key / 解析失败时返回 None，由 change_service 降级到规则摘要。
"""
import json
import re

from agents.llm import ask_llm

CHANGE_PROMPT = """你是校务变化检测助手。比较【旧版】与【新版】内容，判断变化的语义级别并生成一句话摘要。

变化类型(选最贴切)：政策取消、政策修订、截止日期变更、适用范围变更、发布方变更、内容微调、无实质变化。
严重度(选一)：HIGH/MEDIUM/LOW。

只输出一个 JSON 对象：{"change_type":"...","severity":"HIGH|MEDIUM|LOW","summary":"一句话摘要"}
不要输出其他文字。

【旧版】
{old}

【新版】
{new}"""


async def annotate_change(old: str, new: str) -> dict | None:
    """返回 {change_type, severity, summary}；失败/无 key 返回 None。"""
    old, new = old or "", new or ""
    if not old.strip() or not new.strip() or old == new:
        return None
    text = await ask_llm(
        CHANGE_PROMPT.replace("{old}", old[:1500]).replace("{new}", new[:1500])
    )
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except (ValueError, json.JSONDecodeError):
        return None
    summary = str(d.get("summary") or "").strip()
    severity = str(d.get("severity") or "").upper()
    if severity not in ("HIGH", "MEDIUM", "LOW"):
        severity = None
    if not summary:
        return None
    return {
        "change_type": str(d.get("change_type") or "").strip(),
        "severity": severity,
        "summary": summary,
    }

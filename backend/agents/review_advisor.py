"""AI 审核助手（E）：对单条知识对象给出 LLM 审核参考（摘要 / 风险 / 推荐动作 / 置信度）。

审核员（Admin）结合该建议做最终 approve/reject，实现"AI 治理 + 人工把关"的可落地闭环。
无 API key 或解析失败时降级为基于 reason 的规则式建议（不会 500）。
"""
import json
import logging

from agents.llm import ask_llm

logger = logging.getLogger(__name__)

ADVISOR_PROMPT = """你是校务知识治理的审核助手。请审核下面这条知识对象，输出 JSON（不要额外文字）：
{{"summary":"一句话要点","risks":["风险1","风险2"],"recommendation":"approve|reject|merge","reason":"简短理由","confidence":0.0-1.0}}

审核对象：
- 标题：{title}
- 类型：{type}
- 部门：{department}
- 来源网址：{url}
- 置信度：{confidence}
- 状态：{status}
- 进入审核原因：{reason}
- 摘要：{summary}
- 关键信息：{facts}

判断要点：是否与校务事实一致、是否可能过期、是否与政策冲突、信息是否完整可引用。recommendation 取值：
- approve：信息可信可直接发布
- reject：明显错误/过期/低价值，应归档
- merge：与既有知识存在部分冲突，建议合并或人工核对"""


def _build_rule_fallback(ko, reason: str) -> dict:
    recommendation = "reject" if reason == "conflict" else "approve"
    return {
        "summary": ko.summary or ko.title,
        "risks": ["低置信/存在冲突，建议人工复核" if reason == "conflict" else "置信度偏低，建议核对"],
        "recommendation": recommendation,
        "reason": f"规则兜底：审核原因 {reason}",
        "confidence": round(float(ko.confidence or 0.5), 2),
    }


async def audit_knowledge_object(ko, reason: str = "manual") -> dict:
    """对单个知识对象生成审核建议。无 key/失败时降级规则式。"""
    if not ko:
        return {"error": "知识对象不存在"}
    facts = json.dumps(ko.facts, ensure_ascii=False) if ko.facts else ""
    try:
        prompt = ADVISOR_PROMPT.replace(
            "{title}", ko.title or ""
        ).replace("{type}", ko.type or "").replace("{department}", ko.department or "").replace(
            "{url}", ko.source_url or ""
        ).replace("{confidence}", str(ko.confidence or 0.5)).replace("{status}", ko.status or "").replace(
            "{reason}", reason
        ).replace("{summary}", ko.summary or "").replace("{facts}", facts)
        raw = await ask_llm(prompt, system="你是校务知识治理审核助手。")
        # 提取 JSON（容忍包裹文本）
        start, end = raw.find("{"), raw.rfind("}")
        if start == -1 or end == -1:
            return _build_rule_fallback(ko, reason)
        data = json.loads(raw[start : end + 1])
        rec = data.get("recommendation", "approve")
        if rec not in ("approve", "reject", "merge"):
            rec = "approve"
        return {
            "summary": data.get("summary", ko.summary or ko.title),
            "risks": data.get("risks", []) if isinstance(data.get("risks"), list) else [],
            "recommendation": rec,
            "reason": data.get("reason", ""),
            "confidence": round(float(data.get("confidence", 0.7)), 2),
        }
    except Exception as e:
        logger.warning("审核建议 LLM 调用异常（降级规则式）: %s", e)
        return _build_rule_fallback(ko, reason)


# ---------------- 冲突消解建议（E） ----------------
CONFLICT_PROMPT = """你是校务知识治理专家。两份知识针对同一事项（{field}）给出冲突信息，请输出 JSON：
{{"keep":"a|b","recommendation":"保留|合并|改用官方最新","note":"一句话说明","confidence":0.0-1.0}}

冲突字段：{field}
A（{a_dep}，{a_status}，置信度{a_conf}）：
  标题：{a_title}
  摘要：{a_summary}
  信息：{a_facts}

B（{b_dep}，{b_status}，置信度{b_conf}）：
  标题：{b_title}
  摘要：{b_summary}
  信息：{b_facts}

判断：谁更新、谁权威、谁更贴近官方。keep 取值 a 或 b；recommendation 用中文短语。"""


async def audit_conflict(conflict, ko_a, ko_b) -> dict:
    """对冲突给出消解建议（保留哪份/合并/改用官方）。失败降级为保留两者中更新者。"""

    def _fallback():
        ts_a, ts_b = ko_a.last_verified_at, ko_b.last_verified_at
        keep = "a" if (ts_a or ko_a.updated_at) >= (ts_b or ko_b.updated_at) else "b"
        return {
            "keep": keep,
            "recommendation": "保留较新版（规则兜底）",
            "note": f"冲突字段：{conflict.field}；{conflict.value_a or ''} vs {conflict.value_b or ''}",
            "confidence": 0.6,
        }

    if not ko_a or not ko_b:
        return _fallback()
    try:
        prompt = (
            CONFLICT_PROMPT.replace("{field}", conflict.field or "")
            .replace("{a_dep}", ko_a.department or "")
            .replace("{a_status}", ko_a.status or "")
            .replace("{a_conf}", str(ko_a.confidence or 0.5))
            .replace("{a_title}", ko_a.title or "")
            .replace("{a_summary}", ko_a.summary or "")
            .replace("{a_facts}", json.dumps(ko_a.facts, ensure_ascii=False) if ko_a.facts else "")
            .replace("{b_dep}", ko_b.department or "")
            .replace("{b_status}", ko_b.status or "")
            .replace("{b_conf}", str(ko_b.confidence or 0.5))
            .replace("{b_title}", ko_b.title or "")
            .replace("{b_summary}", ko_b.summary or "")
            .replace("{b_facts}", json.dumps(ko_b.facts, ensure_ascii=False) if ko_b.facts else "")
        )
        raw = await ask_llm(prompt, system="你是校务知识冲突治理专家。")
        start, end = raw.find("{"), raw.rfind("}")
        if start == -1 or end == -1:
            return _fallback()
        data = json.loads(raw[start : end + 1])
        keep = data.get("keep", "a")
        if keep not in ("a", "b"):
            keep = "a"
        return {
            "keep": keep,
            "recommendation": data.get("recommendation", "保留"),
            "note": data.get("note", ""),
            "confidence": round(float(data.get("confidence", 0.7)), 2),
        }
    except Exception as e:
        logger.warning("冲突消解建议 LLM 调用异常（降级规则式）: %s", e)
        return _fallback()

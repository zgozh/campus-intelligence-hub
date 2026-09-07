"""智能源推荐（C）：LLM 从自动发现候选中筛高价值校务源 + 建议采集频率。

参考 Crawl4AI 类"AI 驱动采集决策"：LLM 判断哪些栏目值得采集、分类、定频率。
"""
import json
import re

from agents.llm import ask_llm

RANK_PROMPT = """你是校务数据采集专家。判断下列候选栏目/页面是否值得作为校务知识采集源
(只保留通知公告/规章制度/办事指南/招考/奖助/教务/政策等有校务知识价值的栏目)。

对每个候选输出一个 JSON 对象，并入一个数组：
{"url":"候选URL","value":"high|medium|low","category":"通知公告|规章制度|办事指南|新闻动态|其他","frequency_hours":24}

value=high 表示高价值采集源(常更新且有决策价值)，medium=一般，low=低价值(导航/纯展示/新闻)。
frequency_hours 建议采集间隔(小时)，如 24 / 48 / 168。
只输出数组，不要其他文字。

候选列表：
{candidates}"""

_VALUE_ORDER = {"high": 0, "medium": 1, "low": 2}


async def rank_candidates(candidates: list[dict]) -> dict:
    """对自动发现的候选做 LLM 价值评分/分类/频率建议。失败降级为 medium。"""
    if not candidates:
        return {"recommended": [], "total": 0}
    lines = "\n".join(f"- {c.get('name','')} ({c.get('url','')})" for c in candidates)
    text = await ask_llm(RANK_PROMPT.replace("{candidates}", lines[:3000]))
    m = re.search(r"\[[\s\S]*\]", text)
    by_url: dict[str, dict] = {}
    if m:
        try:
            data = json.loads(m.group(0))
            for d in data:
                if isinstance(d, dict) and d.get("url"):
                    by_url[str(d["url"])] = d
        except (ValueError, json.JSONDecodeError):
            by_url = {}

    recs = []
    for c in candidates:
        d = by_url.get(c.get("url"), {})
        recs.append({
            "name": c.get("name", ""),
            "url": c.get("url", ""),
            "type": c.get("type", "list_page"),
            "domain": c.get("domain", ""),
            "value": str(d.get("value") or "medium"),
            "category": str(d.get("category") or "其他"),
            "frequency_hours": int(d.get("frequency_hours") or 24),
        })
    recs.sort(key=lambda r: _VALUE_ORDER.get(r["value"], 3))
    return {"recommended": recs, "total": len(recs)}

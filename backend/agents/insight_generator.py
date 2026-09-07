"""校务洞察（F）：基于真实运营数据（新增/变更/冲突/审核积压/来源异常/临期）由 LLM 生成洞察叙事。

与 digest 的结构化日报互补：digest 是"发生了什么"，insight 是"意味着什么 + 建议怎么做"。
无 API key 或失败时降级为规则式摘要，主链路永远可用。
"""
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from agents.llm import ask_llm
from models import ChangeEvent, Conflict, KnowledgeObject, ReviewTask, Source

logger = logging.getLogger(__name__)

INSIGHT_PROMPT = """你是高校校务知识治理的数据分析师。基于下面的本期运营数据，输出一份 300 字以内的「校务知识洞察」，用简体中文、分点：

1) 本期要点（2-3 条）
2) 趋势判断（1 条）
3) 风险提示（1-2 条）
4) 给管理员的建议（1-2 条）

数据：
{data}

只依据数据，不要臆造数字。"""


async def _gather(db) -> dict:
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    since = now - timedelta(days=1)
    week_later = (now + timedelta(days=7)).strftime("%Y-%m-%d")

    new_today = await db.scalar(
        select(func.count(KnowledgeObject.id)).where(KnowledgeObject.created_at >= since)
    )
    published = await db.scalar(
        select(func.count(KnowledgeObject.id)).where(KnowledgeObject.status == "PUBLISHED")
    )
    conflict_open = await db.scalar(select(func.count(Conflict.id)).where(Conflict.status == "open"))
    review_pending = await db.scalar(select(func.count(ReviewTask.id)).where(ReviewTask.status == "pending"))
    source_error = await db.scalar(select(func.count(Source.id)).where(Source.status == "error"))

    # 高严重度变更（近 7 天）
    high_changes = await db.execute(
        select(ChangeEvent)
        .where(ChangeEvent.detected_at >= (now - timedelta(days=7)))
        .order_by(ChangeEvent.detected_at.desc())
        .limit(8)
    )
    change_titles = [c.diff_summary or "变更" for c in high_changes.scalars().all()]

    # 临期事项
    expiring = await db.execute(
        select(KnowledgeObject)
        .where(
            KnowledgeObject.status == "PUBLISHED",
            KnowledgeObject.effective_to.isnot(None),
            KnowledgeObject.effective_to >= today,
            KnowledgeObject.effective_to <= week_later,
        )
        .order_by(KnowledgeObject.effective_to)
        .limit(8)
    )
    expiring_titles = [f"{k.title}（截止{k.effective_to}）" for k in expiring.scalars().all()]

    # 部门分布
    dept_rows = await db.execute(
        select(KnowledgeObject.department, func.count(KnowledgeObject.id))
        .group_by(KnowledgeObject.department)
        .limit(8)
    )
    dept_dist = {str(d or "未归类"): c for d, c in dept_rows}

    return {
        "统计": {
            "今日新增": int(new_today or 0),
            "已发布知识": int(published or 0),
            "开放冲突": int(conflict_open or 0),
            "待审核": int(review_pending or 0),
            "异常来源": int(source_error or 0),
            "部门分布": dept_dist,
        },
        "近期高严重度变更": change_titles,
        "临期事项": expiring_titles,
    }


def _rule_fallback(data: dict) -> str:
    s = data["统计"]
    lines = [
        f"今日新增知识 {s['今日新增']} 条，已发布 {s['已发布知识']} 条。",
        f"当前开放冲突 {s['开放冲突']} 条、待审核 {s['待审核']} 条、异常来源 {s['异常来源']} 个。",
    ]
    if data["临期事项"]:
        lines.append("临期提醒：" + "；".join(data["临期事项"][:3]))
    if data["近期高严重度变更"]:
        lines.append("近期变更：" + "；".join(data["近期高严重度变更"][:3]))
    return "\n".join(lines)


async def generate_insight(db) -> dict:
    """生成校务洞察文本（含数据快照），返回 {content, data}。"""
    data = await _gather(db)
    try:
        raw = await ask_llm(
            INSIGHT_PROMPT.replace("{data}", json.dumps(data, ensure_ascii=False, indent=2)),
            system="你是校务知识治理数据分析师。",
        )
        content = raw.strip()
        if not content:
            content = _rule_fallback(data)
    except Exception as e:
        logger.warning("洞察生成 LLM 调用异常（降级规则式）: %s", e)
        content = _rule_fallback(data)
    return {"content": content, "data": data}

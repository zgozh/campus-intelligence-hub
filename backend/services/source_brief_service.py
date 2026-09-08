"""校务快讯（自动化巡检）：按来源/部门汇总近 N 天新增内容 + 重要变更 + 临期提醒，LLM 生成快讯。

配合数据源监控（source_monitor）与定时调度，让中台"主动发现新消息"并输出简报。
失败降级为规则式摘要（不 500）。
"""
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from agents.llm import ask_llm
from models import BriefReport, ChangeEvent, KnowledgeObject
from services.source_monitor import monitor_sources

logger = logging.getLogger(__name__)

BRIEF_PROMPT = """你是校务信息巡检员。基于下面的监控数据，生成一份 250 字以内的「校务快讯」Markdown，分点：
1) 各来源/部门近 {days} 天新增内容概览（标出新增最多的来源）
2) 重要变更或新通知（若列表为空则写"近 {days} 天暂无重大变更"）
3) 临期提醒（如截止日期将至的事项）
4) 给管理员的关注建议

数据：
{data}

只依据数据，不要臆造。中文。"""


async def _gather(db, days: int = 7):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    monitor = await monitor_sources(db, recent_days=days)

    # 近 days 天新增 KO（按部门）
    dept_rows = await db.execute(
        select(KnowledgeObject.department, func.count(KnowledgeObject.id))
        .where(KnowledgeObject.created_at >= since)
        .group_by(KnowledgeObject.department)
        .limit(10)
    )
    dept_new = {str(d or "未分类"): c for d, c in dept_rows}

    # 近 days 天变更
    changes = (await db.execute(select(ChangeEvent).where(ChangeEvent.detected_at >= since).order_by(ChangeEvent.detected_at.desc()).limit(6))).scalars().all()
    change_titles = [c.diff_summary or "变更" for c in changes]

    # 临期（7 天内过期）
    week_later = (now + timedelta(days=7)).strftime("%Y-%m-%d")
    expiring = (await db.execute(
        select(KnowledgeObject)
        .where(
            KnowledgeObject.status == "PUBLISHED",
            KnowledgeObject.effective_to.isnot(None),
            KnowledgeObject.effective_to >= now.strftime("%Y-%m-%d"),
            KnowledgeObject.effective_to <= week_later,
        )
        .order_by(KnowledgeObject.effective_to)
        .limit(6)
    )).scalars().all()
    expiring_titles = [f"{k.title}（截止 {k.effective_to}）" for k in expiring]

    return {
        "来源新增": [{"name": i["name"], "new": i["new_count"], "recent": i["recent_titles"][:2]} for i in monitor["items"]],
        "部门新增知识": dept_new,
        "近期变更": change_titles,
        "临期事项": expiring_titles,
    }


def _rule_fallback(data: dict) -> str:
    srcs = data["来源新增"]
    hot = [s["name"] for s in srcs if s["new"] > 0]
    lines = [
        f"近 7 天共 {sum(s['new'] for s in srcs)} 条新内容，"
        + ("主要集中在：" + "、".join(sorted(hot, key=lambda n: -next((s['new'] for s in srcs if s['name'] == n), 0))[:4]) if hot else "暂无新增。"),
    ]
    if data["近期变更"]:
        lines.append("近期变更：" + "；".join(data["近期变更"][:3]))
    if data["临期事项"]:
        lines.append("临期提醒：" + "；".join(data["临期事项"][:3]))
    return "\n".join(lines)


async def generate_source_brief(db, days: int = 7, persist: bool = False) -> dict:
    """生成校务快讯；persist=True 时落盘到 BriefReport。"""
    data = await _gather(db, days)
    try:
        raw = await ask_llm(
            BRIEF_PROMPT.replace("{days}", str(days)).replace("{data}", json.dumps(data, ensure_ascii=False, indent=2, default=str)),
            system="你是校务信息巡检员。",
        )
        content = raw.strip() or _rule_fallback(data)
    except Exception as e:
        logger.warning("校务快讯 LLM 调用异常（降级规则式）: %s", e)
        content = _rule_fallback(data)

    out = {"content": content, "data": data}
    if persist:
        br = BriefReport(content=content, data=data)
        db.add(br)
        await db.commit()
        await db.refresh(br)
        out["id"] = br.id
        out["created_at"] = br.created_at
    return out

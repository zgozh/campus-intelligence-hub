"""异常运维告警（agent 导向）：自动巡检健康度/来源异常/临期/审核积压，产生告警通知。

确定性规则实现（复用 radar_service.knowledge_health + Source 状态，不依赖 LLM），
告警推送到站内通知中心（kind='alert'），并可选外发 webhook。幂等：同标题未读告警不重复建。
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from models import KnowledgeObject, Notification, Source
from services.radar_service import knowledge_health

logger = logging.getLogger(__name__)

HEALTH_THRESHOLD = 70.0


async def _has_unread(db, title: str) -> bool:
    r = await db.scalar(select(Notification.id).where(Notification.kind == "alert", Notification.title == title, Notification.read == False))  # noqa: E712
    return r is not None


async def check_alerts(db) -> dict:
    """巡检并生成告警通知；返回告警清单。"""
    now = datetime.now(timezone.utc)
    alerts: list[dict] = []

    # 1. 知识健康度
    health = await knowledge_health(db)
    score = health.get("health_score", 100)
    if score < HEALTH_THRESHOLD:
        alerts.append({"level": "warn", "title": f"知识健康度偏低：{score}", "detail": "健康度低于 70，存在较多陈旧/过期/冲突/积压，建议治理。"})

    # 2. 来源异常
    src_err = await db.scalar(select(func.count(Source.id)).where(Source.status == "error"))
    if src_err:
        err_sources = (await db.execute(select(Source.name).where(Source.status == "error").limit(3))).scalars().all()
        alerts.append({"level": "error", "title": f"来源异常：{src_err} 个", "detail": "异常来源：" + "、".join(err_sources) + "。请检查数据源可访问性。"})

    # 3. 待审核积压
    review_backlog = health.get("review_backlog", 0)
    if review_backlog > 0:
        alerts.append({"level": "info", "title": f"待审核积压：{review_backlog} 条", "detail": "存在待审核知识对象，建议及时审核以保障知识时效。"})

    # 4. 临期事项
    today = now.strftime("%Y-%m-%d")
    week_later = (now + timedelta(days=7)).strftime("%Y-%m-%d")
    expiring = (await db.execute(
        select(KnowledgeObject)
        .where(KnowledgeObject.status == "PUBLISHED", KnowledgeObject.effective_to.isnot(None),
               KnowledgeObject.effective_to >= today, KnowledgeObject.effective_to <= week_later)
        .order_by(KnowledgeObject.effective_to).limit(5)
    )).scalars().all()
    if expiring:
        titles = [f"{k.title}（{k.effective_to} 截止）" for k in expiring]
        alerts.append({"level": "warn", "title": f"临期提醒：{len(expiring)} 项将截止", "detail": "；".join(titles)})

    created = 0
    for a in alerts:
        if await _has_unread(db, a["title"]):
            continue
        db.add(
            Notification(
                kind="alert",
                title=a["title"],
                content=a["detail"],
                link="/notifications",
                read=False,
            )
        )
        created += 1
    await db.commit()
    logger.info("告警巡检：%d 项告警（新建 %d 通知）", len(alerts), created)
    return {"alerts": alerts, "created": created}


async def alerts_summary(db) -> dict:
    """当前告警概览（不落通知）。"""
    alerts = await check_alerts(db)
    return {"alerts": alerts["alerts"], "created": alerts["created"]}

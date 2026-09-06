"""自动日报/周报（EPIC 11）：新增通知 / 即将截止 / 异常 / 来源活跃度。"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from models import Conflict, Digest, KnowledgeObject, RawDocument, ReviewTask, Source

logger = logging.getLogger(__name__)


async def generate_digest(db, period: str = "daily") -> dict:
    now = datetime.now(timezone.utc)
    days = 1 if period == "daily" else 7
    since = now - timedelta(days=days)
    today = now.strftime("%Y-%m-%d")
    week_later = (now + timedelta(days=7)).strftime("%Y-%m-%d")

    # 本期新增知识
    new_kos = (
        await db.execute(
            select(KnowledgeObject)
            .where(KnowledgeObject.created_at >= since)
            .order_by(KnowledgeObject.created_at.desc())
        )
    ).scalars().all()

    # 即将截止
    expiring = (
        await db.execute(
            select(KnowledgeObject)
            .where(
                KnowledgeObject.status == "PUBLISHED",
                KnowledgeObject.effective_to.isnot(None),
                KnowledgeObject.effective_to >= today,
                KnowledgeObject.effective_to <= week_later,
            )
            .order_by(KnowledgeObject.effective_to)
        )
    ).scalars().all()

    # 异常
    conflict_open = await db.scalar(
        select(func.count(Conflict.id)).where(Conflict.status == "open")
    )
    review_pending = await db.scalar(
        select(func.count(ReviewTask.id)).where(ReviewTask.status == "pending")
    )
    source_error = await db.scalar(
        select(func.count(Source.id)).where(Source.status == "error")
    )

    # 来源活跃度
    rows = await db.execute(
        select(RawDocument.source_site, func.count(RawDocument.id)).group_by(
            RawDocument.source_site
        )
    )
    activity = [(r[0] or "未知", r[1]) for r in rows]

    label = "日报" if period == "daily" else "周报"
    lines = [
        f"# 校园 AI 知识{label}",
        "",
        f"> 生成时间：{now.strftime('%Y-%m-%d %H:%M')}",
        "",
        f"## 本期新增知识（{len(new_kos)} 条）",
    ]
    for ko in new_kos:
        lines.append(f"- {ko.title}（{ko.type}·{ko.effective_from or '未知日期'}）")
    lines.append("")
    lines.append(f"## 即将截止事项（{len(expiring)} 条）")
    for ko in expiring:
        lines.append(f"- {ko.title}（截止：{ko.effective_to}）")
    lines.append("")
    lines.append("## 知识库异常")
    lines.append(f"- 冲突知识：{conflict_open or 0} 条")
    lines.append(f"- 待审核：{review_pending or 0} 条")
    lines.append(f"- 来源异常：{source_error or 0} 个")
    lines.append("")
    lines.append("## 来源活跃度")
    for name, cnt in activity:
        lines.append(f"- {name}：{cnt}")

    content = "\n".join(lines)
    digest = Digest(
        period=period,
        title=f"校园 AI 知识{label} {now.strftime('%Y-%m-%d')}",
        content=content,
    )
    db.add(digest)
    await db.commit()
    await db.refresh(digest)
    logger.info("Digest 生成：%s", digest.id)
    return {"id": digest.id, "title": digest.title, "content": content}

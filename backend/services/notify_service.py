"""主动推送服务：站内通知 + 可选群机器人 webhook 外发（多渠道）。

- 站内：向 Notification 表写记录，前端铃声/通知页实时可见。
- 多渠道：若配置 CAMPUS_NOTIFY_WEBHOOK（飞书/企微/钉钉群机器人），best-effort 外发。
"""
import logging

import httpx

from config import settings
from models import Notification

logger = logging.getLogger(__name__)


async def create_notification(
    db, kind: str, title: str, content: str | None, link: str | None = None
) -> Notification:
    """写入站内通知（不 commit，交由调用方）。link 为前端路由跳转目标（如 /insights）。"""
    n = Notification(kind=kind, title=title, content=content, link=link, read=False)
    db.add(n)
    await db.flush()
    return n


async def webhook_notify(kind: str, title: str, content: str | None) -> bool:
    """向配置的群机器人 webhook 外发（best-effort，失败不阻断主链路）。"""
    if not settings.campus_notify_webhook:
        return False
    text = f"【校务智汇中台 · {kind}】\n{title}\n\n{content or ''}"[:2000]
    try:
        payload = {
            "msg_type": "text",
            "content": {"text": text},
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(settings.campus_notify_webhook, json=payload)
            return resp.status_code < 400
    except Exception as e:
        logger.warning("webhook 推送失败（降级仅站内）: %s", e)
        return False


async def push_notification(
    db, kind: str, title: str, content: str | None, link: str | None = None
) -> Notification:
    """站内通知 + 外发 webhook；结束后 commit。既有调用方无需改动（link 可选）。"""
    n = await create_notification(db, kind, title, content, link=link)
    await db.commit()
    if settings.campus_notify_webhook:
        # 不阻塞主流程
        import asyncio

        asyncio.get_event_loop().create_task(webhook_notify(kind, title, content))
    return n

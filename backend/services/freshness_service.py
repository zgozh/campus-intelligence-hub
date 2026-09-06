"""时效引擎（spec §27）：过期检测（effective_to < 今天 → EXPIRED）。"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from models import KnowledgeObject

logger = logging.getLogger(__name__)


async def refresh_freshness(db) -> dict:
    """过期检测：effective_to < 今天 且 PUBLISHED → EXPIRED。返回统计。"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    expired = 0
    result = await db.execute(
        select(KnowledgeObject).where(KnowledgeObject.status == "PUBLISHED")
    )
    for ko in result.scalars():
        if ko.effective_to and ko.effective_to < today:
            ko.status = "EXPIRED"
            expired += 1
    await db.commit()
    logger.info("时效刷新完成：expired=%d", expired)
    return {"expired": expired}

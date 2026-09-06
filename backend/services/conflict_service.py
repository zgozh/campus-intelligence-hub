"""冲突引擎（spec §14）：同 canonical_title 的 KO，同字段值不同 → Conflict。"""
import logging

from sqlalchemy import select

from models import Conflict, KnowledgeObject, RawDocument

logger = logging.getLogger(__name__)


def _get_fact(ko: KnowledgeObject, field: str) -> str | None:
    for f in ko.facts or []:
        if isinstance(f, dict) and f.get("field") == field:
            return f.get("value")
    return None


async def detect_conflicts(db) -> int:
    """检测冲突：同 canonical_title 的 PUBLISHED KO，截止日期值不同。返回新创建冲突数。"""
    created = 0
    rows = await db.execute(
        select(KnowledgeObject, RawDocument.canonical_title)
        .join(RawDocument, KnowledgeObject.raw_document_id == RawDocument.id)
        .where(KnowledgeObject.status == "PUBLISHED")
    )

    groups: dict[str, list[KnowledgeObject]] = {}
    for ko, ctitle in rows:
        key = ctitle or ko.title
        groups.setdefault(key, []).append(ko)

    for key, kos in groups.items():
        if len(kos) < 2:
            continue
        for i in range(len(kos)):
            for j in range(i + 1, len(kos)):
                a_deadline = _get_fact(kos[i], "截止日期")
                b_deadline = _get_fact(kos[j], "截止日期")
                if not (a_deadline and b_deadline) or a_deadline == b_deadline:
                    continue
                exists = await db.scalar(
                    select(Conflict.id).where(
                        Conflict.object_a == kos[i].id,
                        Conflict.object_b == kos[j].id,
                        Conflict.field == "截止日期",
                        Conflict.status == "open",
                    )
                )
                if exists:
                    continue
                cf = Conflict(
                    object_a=kos[i].id,
                    object_b=kos[j].id,
                    field="截止日期",
                    value_a=a_deadline,
                    value_b=b_deadline,
                )
                db.add(cf)
                created += 1

    await db.commit()
    logger.info("冲突检测完成：created=%d", created)
    return created

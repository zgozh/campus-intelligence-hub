"""冲突引擎（spec §14/§16）：同 canonical_title 的 KO，同字段值不同 → Conflict；支持 Use A/Use B/Merge/Ignore。"""
import logging
from datetime import datetime, timezone

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


async def resolve_conflict(
    db, conflict_id: str, decision: str = "use_a", winner_id: str | None = None, admin_id: int = 0
) -> dict:
    """决策解决冲突：use_a / use_b / merge / ignore。"""
    cf = await db.get(Conflict, conflict_id)
    if not cf:
        return {"error": "conflict not found"}
    a = await db.get(KnowledgeObject, cf.object_a)
    b = await db.get(KnowledgeObject, cf.object_b)
    now = datetime.now(timezone.utc)

    if decision == "use_a":
        if a:
            a.status = "PUBLISHED"
            a.updated_at = now
        if b:
            b.status = "ARCHIVED"
            b.updated_at = now
    elif decision == "use_b":
        if b:
            b.status = "PUBLISHED"
            b.updated_at = now
        if a:
            a.status = "ARCHIVED"
            a.updated_at = now
    elif decision == "merge":
        winner, other = a, b
        if winner_id and winner_id == cf.object_b:
            winner, other = b, a
        if winner and other:
            merged = []
            seen = set()
            for f in (winner.facts or []) + (other.facts or []):
                if not isinstance(f, dict):
                    continue
                fid = f.get("field")
                if fid in seen:
                    continue
                merged.append(f)
                seen.add(fid)
            winner.facts = merged
            winner.status = "PUBLISHED"
            winner.updated_at = now
            other.status = "ARCHIVED"
            other.updated_at = now
    elif decision == "ignore":
        if a:
            a.status = "PUBLISHED"
            a.updated_at = now
        if b:
            b.status = "PUBLISHED"
            b.updated_at = now

    cf.status = "resolved"
    cf.resolved_by = str(admin_id)
    cf.resolved_at = now
    await db.commit()
    logger.info("冲突解决：%s decision=%s", conflict_id, decision)
    return {"resolved": True, "decision": decision, "conflict_id": conflict_id}


async def conflict_detail(db, conflict_id: str) -> dict | None:
    """冲突 diff 证据：object A/B 的标题/部门/事实/有效期对照。"""
    cf = await db.get(Conflict, conflict_id)
    if not cf:
        return None
    a = await db.get(KnowledgeObject, cf.object_a)
    b = await db.get(KnowledgeObject, cf.object_b)

    def _obj(ko, value):
        return {
            "id": ko.id if ko else None,
            "title": ko.title if ko else "",
            "department": ko.department if ko else "",
            "effective_to": ko.effective_to if ko else None,
            "facts": ko.facts if ko else [],
            "field_value": value,
        }

    return {
        "id": cf.id,
        "field": cf.field,
        "value_a": cf.value_a,
        "value_b": cf.value_b,
        "status": cf.status,
        "object_a": _obj(a, cf.value_a),
        "object_b": _obj(b, cf.value_b),
    }

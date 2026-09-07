"""对外中台 API（spec §30 / §56）：供校内其它 AI 应用统一调用。

只读端点（知识搜索/详情/数据源/变更/冲突/日报）公开；写操作（审核）需登录。
检索/问答复用融合评分与 Answer Guard。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from api.endpoints.auth import get_current_admin
from database import get_db
from models import AdminUser, ChangeEvent, Conflict, Digest, KnowledgeObject, Source
from services.ask_service import ask
from services.search_service import search_knowledge

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["public-api"])


def _ko_to_dict(ko: KnowledgeObject) -> dict:
    return {
        "id": ko.id,
        "title": ko.title,
        "type": ko.type,
        "department": ko.department,
        "status": ko.status,
        "version": ko.version,
        "effective_from": ko.effective_from,
        "effective_to": ko.effective_to,
        "freshness": ko.freshness_level,
        "authority": ko.authority,
        "confidence": ko.confidence,
        "summary": ko.summary,
        "tags": ko.tags,
        "source_url": ko.source_url,
    }


@router.get("/knowledge/search")
async def public_search(
    q: str = Query(..., min_length=1, description="查询语句"),
    department: str | None = Query(None, description="按部门过滤"),
    freshness: str | None = Query(None, description="Fresh/Aging/Stale/Unknown"),
    limit: int = Query(8, ge=1, le=20),
    db=Depends(get_db),
):
    """知识搜索（融合评分），供外部 AI 应用调用。"""
    kos = await search_knowledge(db, q, top_k=limit)
    items = []
    for ko in kos:
        if department and ko.department != department:
            continue
        if freshness and ko.freshness_level != freshness:
            continue
        items.append(_ko_to_dict(ko))
    return {"query": q, "results": items, "total": len(items)}


@router.get("/knowledge/{ko_id}")
async def public_knowledge(ko_id: str, db=Depends(get_db)):
    """单条知识详情。"""
    ko = await db.get(KnowledgeObject, ko_id)
    if not ko:
        raise HTTPException(status_code=404, detail="知识不存在")
    return _ko_to_dict(ko)


@router.get("/sources")
async def public_sources(db=Depends(get_db)):
    """数据源列表。"""
    rows = await db.execute(select(Source).order_by(Source.created_at.desc()))
    sources = rows.scalars().all()
    return {
        "sources": [
            {
                "id": s.id,
                "name": s.name,
                "source_type": s.source_type,
                "base_url": s.base_url,
                "status": s.status,
                "last_success_at": s.last_success_at.isoformat() if s.last_success_at else None,
                "authority": s.authority,
            }
            for s in sources
        ],
        "total": len(sources),
    }


@router.get("/changes")
async def public_changes(limit: int = Query(10, ge=1, le=50), db=Depends(get_db)):
    """变更列表（Change Radar）。"""
    rows = await db.execute(
        select(ChangeEvent).order_by(ChangeEvent.detected_at.desc()).limit(limit)
    )
    changes = rows.scalars().all()
    return {
        "changes": [
            {
                "id": c.id,
                "source_id": c.source_id,
                "severity": c.severity,
                "change_type": c.change_type or [],
                "diff_summary": c.diff_summary,
                "requires_review": c.requires_review,
                "detected_at": c.detected_at.isoformat() if c.detected_at else None,
            }
            for c in changes
        ],
        "total": len(changes),
    }


@router.get("/conflicts")
async def public_conflicts(db=Depends(get_db)):
    """冲突列表。"""
    rows = await db.execute(select(Conflict).where(Conflict.status == "open"))
    conflicts = rows.scalars().all()
    return {
        "conflicts": [
            {
                "id": c.id,
                "object_a": c.object_a,
                "object_b": c.object_b,
                "field": c.field,
                "value_a": c.value_a,
                "value_b": c.value_b,
                "status": c.status,
            }
            for c in conflicts
        ],
        "total": len(conflicts),
    }


@router.get("/digest")
async def public_digest(db=Depends(get_db)):
    """最新日报。"""
    digest = (
        await db.execute(select(Digest).order_by(Digest.created_at.desc()).limit(1))
    ).scalar_one_or_none()
    if not digest:
        return {"digest": None}
    return {
        "digest": {
            "id": digest.id,
            "period": digest.period,
            "title": digest.title,
            "content": digest.content,
            "created_at": digest.created_at.isoformat() if digest.created_at else None,
        }
    }


@router.post("/chat")
async def public_chat(
    query: str = Query(..., min_length=1, max_length=1000),
    top_k: int = Query(5, ge=1, le=10),
    db=Depends(get_db),
):
    """校务问答（融合检索 + Answer Guard + Evidence citation）。"""
    return await ask(db, query, top_k)


@router.post("/review/{task_id}/approve")
async def public_approve(
    task_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db=Depends(get_db),
):
    """审核通过（需登录）。"""
    from services.review_service import approve_task

    return await approve_task(db, task_id, current_user.id)


@router.post("/review/{task_id}/reject")
async def public_reject(
    task_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db=Depends(get_db),
):
    """审核拒绝（需登录）。"""
    from services.review_service import reject_task

    return await reject_task(db, task_id, current_user.id)

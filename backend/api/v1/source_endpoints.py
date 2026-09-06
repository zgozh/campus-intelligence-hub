"""校务数据源与采集任务 API（EPIC 3-4 Source 域）。

薄路由：本文件只做参数校验与委托，采集执行委托给 services/collection_service.py。
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.endpoints.auth import get_current_admin
from api.v1.schemas import (
    CollectionJobItem,
    CollectionJobListResponse,
    ConflictItem,
    ConflictListResponse,
    ReviewTaskItem,
    ReviewTaskListResponse,
    SourceCreate,
    SourceItem,
    SourceListResponse,
    SourceRunResponse,
    SourceUpdate,
)
from database import get_db
from models import AdminUser, CollectionJob, Conflict, KnowledgeObject, ReviewTask, Source
from services.collection_service import run_collection
from services.conflict_service import detect_conflicts
from services.freshness_service import refresh_freshness
from services.review_service import approve_task, build_review_queue, reject_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")


# ========== Source CRUD ==========


@router.get("/sources", response_model=SourceListResponse)
async def list_sources(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Source).order_by(Source.created_at.desc()))
    sources = result.scalars().all()
    total = await db.scalar(select(func.count(Source.id)))
    return SourceListResponse(sources=list(sources), total=total or 0)


@router.post("/sources", response_model=SourceItem, status_code=status.HTTP_201_CREATED)
async def create_source(
    payload: SourceCreate,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    source = Source(
        name=payload.name,
        source_type=payload.source_type,
        base_url=payload.base_url,
        crawl_frequency=payload.crawl_frequency,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return source


@router.get("/sources/{source_id}", response_model=SourceItem)
async def get_source(
    source_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="数据源不存在")
    return source


@router.put("/sources/{source_id}", response_model=SourceItem)
async def update_source(
    source_id: str,
    payload: SourceUpdate,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="数据源不存在")

    for field in ("name", "base_url", "crawl_frequency", "status"):
        value = getattr(payload, field)
        if value is not None:
            setattr(source, field, value)

    await db.commit()
    await db.refresh(source)
    return source


@router.delete("/sources/{source_id}")
async def delete_source(
    source_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="数据源不存在")
    await db.delete(source)
    await db.commit()
    return {"deleted": True}


@router.post("/sources/{source_id}/run", response_model=SourceRunResponse)
async def run_source(
    source_id: str,
    background_tasks: BackgroundTasks,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="数据源不存在")

    job = CollectionJob(source_id=source_id, status="PENDING", params={"trigger": "manual"})
    db.add(job)
    source.last_crawled_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)

    background_tasks.add_task(run_collection, job.id)
    return SourceRunResponse(job_id=job.id, status="PENDING")


@router.post("/sources/{source_id}/pause", response_model=SourceItem)
async def pause_source(
    source_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="数据源不存在")
    source.status = "paused"
    await db.commit()
    await db.refresh(source)
    return source


# ========== CollectionJob ==========


@router.get("/jobs", response_model=CollectionJobListResponse)
async def list_jobs(
    source_id: str | None = None,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    query = select(CollectionJob).order_by(CollectionJob.created_at.desc())
    if source_id:
        query = query.where(CollectionJob.source_id == source_id)
    result = await db.execute(query)
    jobs = result.scalars().all()
    total = len(jobs)
    return CollectionJobListResponse(jobs=list(jobs), total=total)


@router.get("/jobs/{job_id}", response_model=CollectionJobItem)
async def get_job(
    job_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    job = await db.get(CollectionJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="采集任务不存在")
    return job


# ========== Freshness / Conflict (EPIC 7) ==========


@router.post("/refresh")
async def refresh_knowledge(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """触发时效刷新 + 冲突检测 + 审核队列构建。"""
    freshness = await refresh_freshness(db)
    conflicts = await detect_conflicts(db)
    review = await build_review_queue(db)
    return {"expired": freshness["expired"], "conflicts": conflicts, "review": review}


@router.get("/conflicts", response_model=ConflictListResponse)
async def list_conflicts(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Conflict).order_by(Conflict.created_at.desc()))
    conflicts = result.scalars().all()
    total = len(conflicts)
    return ConflictListResponse(conflicts=list(conflicts), total=total)


@router.post("/conflicts/{conflict_id}/resolve")
async def resolve_conflict(
    conflict_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    cf = await db.get(Conflict, conflict_id)
    if not cf:
        raise HTTPException(status_code=404, detail="冲突不存在")
    cf.status = "resolved"
    cf.resolved_by = str(current_user.id)
    cf.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return {"resolved": True}


# ========== Review Queue (EPIC 9) ==========


@router.get("/review-tasks", response_model=ReviewTaskListResponse)
async def list_review_tasks(
    status: str | None = None,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(ReviewTask, KnowledgeObject)
        .join(KnowledgeObject, ReviewTask.knowledge_object_id == KnowledgeObject.id)
        .order_by(ReviewTask.created_at.desc())
    )
    if status:
        query = query.where(ReviewTask.status == status)
    result = await db.execute(query)
    tasks = []
    for rt, ko in result:
        tasks.append(
            ReviewTaskItem(
                id=rt.id,
                knowledge_object_id=rt.knowledge_object_id,
                reason=rt.reason,
                status=rt.status,
                note=rt.note,
                created_at=rt.created_at,
                reviewed_at=rt.reviewed_at,
                ko_title=ko.title,
                ko_type=ko.type,
            )
        )
    return ReviewTaskListResponse(tasks=tasks, total=len(tasks))


@router.post("/review-tasks/{task_id}/approve")
async def approve_review_task(
    task_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    return await approve_task(db, task_id, current_user.id)


@router.post("/review-tasks/{task_id}/reject")
async def reject_review_task(
    task_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    return await reject_task(db, task_id, current_user.id)

"""校务数据源与采集任务 API（EPIC 3-4 Source 域）。

薄路由：本文件只做参数校验与委托，采集执行委托给 services/collection_service.py。
"""

import logging
import os
import tempfile
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
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
from models import (
    AdminUser,
    BriefReport,
    CollectionJob,
    Conflict,
    Digest,
    DecisionLog,
    InsightReport,
    KnowledgeObject,
    Notification,
    RawDocument,
    ReviewTask,
    Source,
    compute_content_hash,
)
from agents.source_ranker import rank_candidates
from services.change_service import get_change_detail, list_changes
from services.document_parser import DocumentParser
from services.knowledge_service import build_knowledge_object
from services.kg_service import build_graph, graph_ask, list_graph
from services.collection_service import run_collection
from services.discover_service import discover_sources
from services.conflict_service import conflict_detail, detect_conflicts, resolve_conflict as resolve_conflict_svc
from services.digest_service import generate_digest
from services.agent_orchestrator import run_closed_loop
from services.demo_seed import seed_demo
from services.notify_service import push_notification
from services.alert_service import alerts_summary, check_alerts
from services.source_monitor import monitor_sources
from services.source_brief_service import generate_source_brief
from services.freshness_service import refresh_freshness
from services.governance_service import archive_expired, archive_ko, batch_archive, create_ko, edit_ko, publish_ko
from services.radar_service import knowledge_health, radar_stats
from services.review_service import approve_task, build_review_queue, reject_task
from agents.review_advisor import audit_conflict, audit_knowledge_object
from agents.insight_generator import generate_insight
from agents.ko_ingest import extract_from_text
from config import DEFAULT_AUTHORITY

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


@router.get("/sources/monitor")
async def sources_monitor(
    recent_days: int = 7,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """数据源监控：每源的最近采集时间 / 近 N 天新增内容数 / 最新标题（发现新消息/新通知）。"""
    return await monitor_sources(db, recent_days=recent_days)


@router.post("/sources/brief")
async def generate_brief_endpoint(
    days: int = 7,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """一键生成校务快讯（自动化巡检：按来源/部门汇总近 N 天新增内容 + 变更 + 临期）。"""
    brief = await generate_source_brief(db, days=days, persist=True)
    await push_notification(db, "brief", f"校务快讯（近 {days} 天）", brief["content"])
    return brief


@router.get("/sources/brief")
async def list_brief_endpoint(
    limit: int = 10,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """历史校务快讯列表。"""
    result = await db.execute(
        select(BriefReport).order_by(BriefReport.created_at.desc()).limit(limit)
    )
    reports = result.scalars().all()
    return {"reports": list(reports), "total": len(reports)}


# ========== 主动推送 · 站内通知 ==========


@router.get("/notifications")
async def list_notifications(
    limit: int = 20,
    unread_only: bool = False,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """通知列表（未读优先 + 时间倒序）。"""
    q = select(Notification).order_by(Notification.read.asc(), Notification.created_at.desc()).limit(limit)
    if unread_only:
        q = select(Notification).where(Notification.read == False).order_by(Notification.created_at.desc()).limit(limit)  # noqa: E712
    rows = (await db.execute(q)).scalars().all()
    return {
        "notifications": [
            {"id": n.id, "kind": n.kind, "title": n.title, "content": n.content, "read": n.read, "created_at": n.created_at}
            for n in rows
        ],
        "total": len(rows),
    }


@router.get("/notifications/unread-count")
async def unread_count(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    unread = await db.scalar(select(func.count(Notification.id)).where(Notification.read == False))  # noqa: E712
    return {"unread": int(unread or 0)}


@router.post("/notifications/{notification_id}/read")
async def mark_read(
    notification_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    n = await db.get(Notification, notification_id)
    if not n:
        raise HTTPException(status_code=404, detail="通知不存在")
    n.read = True
    await db.commit()
    return {"id": n.id, "read": True}


@router.get("/alerts")
async def get_alerts(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """异常运维告警概览（健康度/来源异常/审核积压/临期）。"""
    return await alerts_summary(db)


@router.post("/alerts/check")
async def check_alerts_endpoint(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """巡检并推送告警（写入通知中心，可选 webhook）。"""
    result = await check_alerts(db)
    return result


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


class DiscoverRequest(BaseModel):
    url: str
    max_links: int = 20


@router.post("/sources/discover")
async def discover_source(
    req: DiscoverRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """自动发现：输入 URL，返回同域候选栏目/部门链接（Allowed Domain 限定）。"""
    try:
        return await discover_sources(req.url, req.max_links)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"自动发现失败: {e}")


@router.post("/sources/recommend")
async def recommend_sources(
    req: DiscoverRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """智能推荐（C）：自动发现 + LLM 筛高价值校务源/分类/建议采集频率。"""
    try:
        disc = await discover_sources(req.url, req.max_links)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"自动发现失败: {e}")
    return await rank_candidates(disc["discovered"])


@router.post("/sources/{source_id}/ingest-file")
async def ingest_file(
    source_id: str,
    file: UploadFile = File(...),
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """文件源采集（EPIC 3）：上传 PDF/DOCX/XLSX/TXT 等 → DocumentParser 解析 → RawDocument + 知识对象。"""
    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="数据源不存在")
    ext = os.path.splitext(file.filename or "")[1].lstrip(".").lower() or "txt"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}")
    try:
        tmp.write(await file.read())
        tmp.close()
        try:
            content = DocumentParser().parse(tmp.name, ext)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"文件解析失败: {e}")
    finally:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)

    if not content:
        raise HTTPException(status_code=400, detail="文件中无可提取文本")

    norm_url = f"file://{source_id}/{file.filename}"
    doc = RawDocument(
        source_id=source.id,
        url=norm_url,
        normalized_url=norm_url,
        title=file.filename or "上传文件",
        canonical_title=file.filename or "上传文件",
        content=content,
        content_hash=compute_content_hash(content),
        version=1,
        source_site=source.name,
        column=None,
    )
    db.add(doc)
    await db.flush()
    ko = await build_knowledge_object(db, doc, source)
    await db.commit()
    return {
        "raw_document_id": doc.id,
        "knowledge_object_id": ko.id,
        "status": "processed",
        "content_len": len(content),
    }


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
    max_pages: int = 1,
    column: str | None = None,
):
    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="数据源不存在")

    params = {"trigger": "manual", "max_pages": max_pages}
    if column:
        params["column"] = column
    job = CollectionJob(source_id=source_id, status="PENDING", params=params)
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


class ResolveConflictRequest(BaseModel):
    decision: str = "use_a"  # use_a / use_b / merge / ignore
    winner_id: str | None = None


@router.post("/conflicts/{conflict_id}/resolve")
async def resolve_conflict(
    conflict_id: str,
    req: ResolveConflictRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await resolve_conflict_svc(db, conflict_id, req.decision, req.winner_id, current_user.id)
    if result.get("error"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.get("/conflicts/{conflict_id}/diff")
async def get_conflict_diff(
    conflict_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """冲突 diff 证据：object A/B 的标题/部门/事实/有效期对照。"""
    detail = await conflict_detail(db, conflict_id)
    if not detail:
        raise HTTPException(status_code=404, detail="冲突不存在")
    return detail


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


@router.post("/review-tasks/{task_id}/ai-suggest")
async def ai_suggest_review_task(
    task_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """AI 审核助手：LLM 审核摘要 + 风险 + 推荐动作（approve/reject/merge）。"""
    task = await db.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="审核任务不存在")
    ko = await db.get(KnowledgeObject, task.knowledge_object_id)
    return await audit_knowledge_object(ko, reason=task.reason)


@router.post("/conflicts/{conflict_id}/ai-suggest")
async def ai_suggest_conflict(
    conflict_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """AI 冲突消解建议：保留哪份 / 合并 / 改用官方，供管理员决策。"""
    cf = await db.get(Conflict, conflict_id)
    if not cf:
        raise HTTPException(status_code=404, detail="冲突不存在")
    ko_a = await db.get(KnowledgeObject, cf.object_a)
    ko_b = await db.get(KnowledgeObject, cf.object_b)
    return await audit_conflict(cf, ko_a, ko_b)


# ========== Knowledge Governance (EPIC 8) ==========


class EditKoRequest(BaseModel):
    title: str | None = None
    type: str | None = None
    department: str | None = None
    effective_from: str | None = None
    effective_to: str | None = None
    summary: str | None = None
    facts: list | None = None
    tags: list | None = None
    confidence: float | None = None


@router.post("/knowledge-objects/{ko_id}/publish")
async def publish_knowledge_object(
    ko_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    ko = await publish_ko(db, ko_id)
    if not ko:
        raise HTTPException(status_code=404, detail="知识对象不存在或不可发布")
    return {"id": ko.id, "status": ko.status}


@router.post("/knowledge-objects/{ko_id}/archive")
async def archive_knowledge_object(
    ko_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    ko = await archive_ko(db, ko_id)
    if not ko:
        raise HTTPException(status_code=404, detail="知识对象不存在")
    return {"id": ko.id, "status": ko.status}


@router.post("/knowledge-objects/{ko_id}/edit")
async def edit_knowledge_object(
    ko_id: str,
    req: EditKoRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    data = req.model_dump(exclude_unset=True)
    ko = await edit_ko(db, ko_id, data)
    if not ko:
        raise HTTPException(status_code=404, detail="知识对象不存在")
    return {
        "id": ko.id,
        "status": ko.status,
        "title": ko.title,
        "department": ko.department,
        "effective_from": ko.effective_from,
        "effective_to": ko.effective_to,
        "summary": ko.summary,
    }


class CreateKoRequest(BaseModel):
    type: str = "Announcement"
    title: str
    department: str | None = None
    effective_from: str | None = None
    effective_to: str | None = None
    summary: str | None = None
    tags: list | None = None
    facts: list | None = None
    confidence: float | None = None


class BatchArchiveRequest(BaseModel):
    ids: list[str]


@router.post("/knowledge-objects/create")
async def create_knowledge_object(
    req: CreateKoRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """人工新增知识对象（除采集外人工录入）。"""
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="标题不能为空")
    ko = await create_ko(db, req.model_dump(exclude_unset=True))
    return {"id": ko.id, "status": ko.status, "title": ko.title}


@router.post("/knowledge-objects/batch-archive")
async def batch_archive_knowledge_objects(
    req: BatchArchiveRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """批量归档指定知识对象。"""
    n = await batch_archive(db, req.ids or [])
    return {"archived": n}


@router.post("/knowledge-objects/archive-expired")
async def archive_expired_knowledge_objects(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """一键归档：把所有已过期(EXPIRED)知识对象转为 ARCHIVED。"""
    n = await archive_expired(db)
    return {"archived": n}


# ========== Knowledge Object 文件入库 (P2-2, LLM 抽取) ==========

_KO_TYPE_MAP = {
    "通知公告": "Announcement",
    "办事指南": "Procedure",
    "规章制度": "Regulation",
    "新闻动态": "Event",
    "政策": "Policy",
}


@router.post("/knowledge-objects/ingest-file")
async def ingest_knowledge_object_file(
    file: UploadFile = File(...),
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """上传本地 md/pdf/txt → LLM 抽取 → 创建知识对象（不依赖数据源）。"""
    ext = os.path.splitext(file.filename or "")[1].lstrip(".").lower() or "md"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}")
    try:
        tmp.write(await file.read())
        tmp.close()
        try:
            content = DocumentParser().parse(tmp.name, ext)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"文件解析失败: {e}")
    finally:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)

    if not content:
        raise HTTPException(status_code=400, detail="文件中无可提取文本")

    extr = await extract_from_text(content, file.filename or "上传文件")
    ko = KnowledgeObject(
        type=_KO_TYPE_MAP.get(extr["category"], "Announcement"),
        title=extr["title"],
        department=extr.get("department"),
        summary=extr.get("summary"),
        facts=extr.get("facts") or [],
        tags=extr.get("tags") or [],
        confidence=0.85,
        status="PUBLISHED",
        version=1,
        source_url=f"file://ko/{file.filename}",
        authority=DEFAULT_AUTHORITY,
        freshness_level="Unknown",
        source_version=1,
    )
    db.add(ko)
    await db.flush()
    # 语义向量入库（失败降级仅关键词检索）
    try:
        from agents.embedding import embed_texts
        from services.vector_service import ensure_collection, upsert_ko

        await ensure_collection()
        embs = await embed_texts([f"{ko.title} {(ko.summary or '')[:500]}"])
        if embs:
            await upsert_ko(ko.id, embs[0], {"title": ko.title, "type": ko.type})
    except Exception:  # noqa: BLE001
        pass
    await db.commit()
    return {"id": ko.id, "title": ko.title, "status": ko.status, "type": ko.type}


# ========== Knowledge Graph (A, LLM 抽取) ==========
@router.post("/knowledge-graph/build")
async def build_knowledge_graph(
    limit: int = 50,
    force: bool = False,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """LLM 从已发布知识对象抽取三元组构建校务知识图谱（增量；force=True 全量重抽）。"""
    return await build_graph(db, limit=limit, force=force)


@router.get("/knowledge-graph")
async def get_knowledge_graph(
    limit: int = 300,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """图谱实体/关系列表。"""
    return await list_graph(db, limit=limit)


@router.post("/knowledge-graph/ask")
async def ask_knowledge_graph(
    query: str = Query(..., min_length=1, max_length=500),
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """图谱问答（实体匹配 + 邻居遍历 + LLM 回答）。"""
    return await graph_ask(db, query)


# ========== Knowledge Radar (EPIC 10) ==========


@router.get("/radar")
async def get_radar(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """知识雷达运营统计。"""
    return await radar_stats(db)


@router.get("/knowledge-health")
async def get_knowledge_health(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Knowledge Health 综合评测（覆盖/新鲜度/冲突率/审核积压/来源健康 + 公开公式）。"""
    await refresh_freshness(db)
    return await knowledge_health(db)


# ========== Digest (EPIC 11) ==========


@router.post("/digests/generate")
async def generate_digest_endpoint(
    period: str = "daily",
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """生成日报/周报。"""
    return await generate_digest(db, period)


@router.get("/digests")
async def list_digests(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Digest).order_by(Digest.created_at.desc()))
    digests = result.scalars().all()
    return {"digests": list(digests), "total": len(digests)}


@router.get("/digests/{digest_id}")
async def get_digest(
    digest_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    digest = await db.get(Digest, digest_id)
    if not digest:
        raise HTTPException(status_code=404, detail="日报不存在")
    return digest


# ========== 三层 Agent 智能运营闭环 (G) ==========


@router.post("/closed-loop/run")
async def run_closed_loop_endpoint(
    collect: bool = False,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """一键智能运营闭环：采集 Agent → 知识治理 Agent → 问答/运营 Agent。"""
    return await run_closed_loop(db, collect=collect)


@router.get("/agents/decisions")
async def list_decisions(
    limit: int = 10,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Agent 决策日志（可视化时间线）：按运行分组返回每层决策。"""
    run_ids = (
        await db.execute(
            select(DecisionLog.run_id)
            .group_by(DecisionLog.run_id)
            .order_by(func.max(DecisionLog.created_at).desc())
            .limit(limit)
        )
    ).scalars().all()
    runs = []
    for rid in run_ids:
        entries = (
            await db.execute(
                select(DecisionLog).where(DecisionLog.run_id == rid).order_by(DecisionLog.created_at)
            )
        ).scalars().all()
        runs.append(
            {
                "run_id": rid,
                "created_at": entries[0].created_at if entries else None,
                "entries": [
                    {"agent": e.agent, "decision": e.decision, "detail": e.detail, "status": e.status, "created_at": e.created_at}
                    for e in entries
                ],
            }
        )
    return {"runs": runs, "total": len(runs)}


@router.post("/demo/seed")
async def seed_demo_data(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """一键导入演示数据（真实风格的校务知识，按标题幂等）。用于演示/评测填充。"""
    return await seed_demo(db)


# ========== 校务洞察 (F, LLM) ==========


@router.post("/insights")
async def generate_insights_endpoint(
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """AI 校务洞察：基于运营数据（新增/变更/冲突/审核/来源/临期）由 LLM 生成并落盘。"""
    ins = await generate_insight(db, persist=True)
    await push_notification(db, "insight", "AI 校务洞察", ins.get("content"))
    return ins


@router.get("/insights")
async def list_insights_endpoint(
    limit: int = 20,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """历史校务洞察报告列表（自动/手动生成）。"""
    result = await db.execute(
        select(InsightReport).order_by(InsightReport.created_at.desc()).limit(limit)
    )
    reports = result.scalars().all()
    return {"reports": list(reports), "total": len(reports)}


# ========== Change Radar (EPIC 5) ==========


@router.get("/changes")
async def get_changes(
    severity: str | None = None,
    limit: int = 20,
    offset: int = 0,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Change Radar 列表：部门/级别/时间/类型。"""
    return await list_changes(db, limit=limit, offset=offset, severity=severity)


@router.get("/changes/{change_id}/diff")
async def get_change_diff(
    change_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Diff Viewer：Before/After 全文 + 行级高亮。"""
    detail = await get_change_detail(db, change_id)
    if not detail:
        raise HTTPException(status_code=404, detail="变更不存在")
    return detail

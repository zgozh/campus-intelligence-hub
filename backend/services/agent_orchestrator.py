"""三层 Agent 智能运营闭环（G）：采集 Agent → 知识治理 Agent → 问答/运营 Agent 一键编排。

把分散的 Collection / Knowledge(治理+图谱) / Answer(洞察+健康) 串成一条自动化闭环，
每层独立 try/except 降级；并将每层 Agent 的「决策」落盘为 DecisionLog，供前端可视化时间线。
"""
import logging
import uuid

from sqlalchemy import select

from models import CollectionJob, DecisionLog, Source

logger = logging.getLogger(__name__)


async def _stage_collection(db, collect: bool) -> dict:
    """采集层：为 active 数据源建采集任务并执行（best-effort）。"""
    if not collect:
        return {
            "name": "采集 Agent",
            "status": "skipped",
            "detail": "未开启实时采集（collect=true 可运行）",
            "jobs": 0,
            "decisions": [{"agent": "采集 Agent", "decision": "跳过实时采集", "detail": "collect=false，未访问外部源", "status": "skip"}],
        }
    sources = (await db.execute(select(Source).where(Source.status == "active"))).scalars().all()
    if not sources:
        return {"name": "采集 Agent", "status": "ok", "detail": "无 active 数据源", "jobs": 0, "decisions": [{"agent": "采集 Agent", "decision": "无活跃数据源", "detail": "跳过采集", "status": "ok"}]}
    from services.collection_service import run_collection

    created = ok = failed = 0
    for src in sources:
        job = CollectionJob(source_id=src.id, status="PENDING", params={"max_pages": 2})
        db.add(job)
        await db.commit()
        await db.refresh(job)
        created += 1
        try:
            await run_collection(job.id)
            refetched = await db.get(CollectionJob, job.id)
            if refetched and refetched.status in ("SUCCESS", "PARTIAL"):
                ok += 1
            else:
                failed += 1
        except Exception as e:
            failed += 1
            logger.warning("采集 Agent 源 %s 失败: %s", src.name, e)
    return {
        "name": "采集 Agent",
        "status": "ok" if failed == 0 else "partial",
        "detail": f"运行 {created} 个数据源：成功 {ok} · 失败 {failed}",
        "jobs": created,
        "decisions": [{"agent": "采集 Agent", "decision": f"采集 {created} 个数据源", "detail": f"成功 {ok} · 失败 {failed}", "status": "ok" if failed == 0 else "partial"}],
    }


async def _stage_knowledge(db) -> dict:
    """知识治理层：新鲜度/冲突/审核/归档/图谱。"""
    out = {}
    from services.freshness_service import refresh_freshness
    from services.conflict_service import detect_conflicts
    from services.review_service import build_review_queue
    from services.governance_service import archive_expired
    from services.kg_service import build_graph

    decisions = []
    fres = await refresh_freshness(db)
    expired = fres.get("expired", 0)
    decisions.append({"agent": "知识治理 Agent", "decision": "新鲜度刷新", "detail": f"过期 {expired}", "status": "ok"})
    cf = await detect_conflicts(db)
    decisions.append({"agent": "知识治理 Agent", "decision": "冲突检测", "detail": f"新增 {cf} 冲突", "status": "ok"})
    rv = await build_review_queue(db)
    decisions.append({"agent": "知识治理 Agent", "decision": "审核队列", "detail": f"入队 {rv}", "status": "ok"})
    ar = await archive_expired(db)
    decisions.append({"agent": "知识治理 Agent", "decision": "归档过期", "detail": f"归档 {ar}", "status": "ok"})
    kg_added = 0
    try:
        kg = await build_graph(db, limit=20)
        kg_added = kg.get("relations_added", 0)
        dec = {"agent": "图谱 Agent", "decision": "图谱增量构建", "detail": f"新增关系 {kg_added}", "status": "ok"}
    except Exception as e:
        logger.warning("知识治理 Agent 图谱构建失败（降级）: %s", e)
        dec = {"agent": "图谱 Agent", "decision": "图谱构建（降级）", "detail": str(e), "status": "partial"}
    decisions.append(dec)
    return {
        "name": "知识治理 Agent",
        "status": "ok",
        "detail": f"冲突 {cf} · 审核 {rv} · 归档过期 {ar} · 新增关系 {kg_added}",
        "decisions": decisions,
    }


async def _stage_answer(db) -> dict:
    """问答/运营层：日报 + AI 洞察 + 健康度。"""
    from services.digest_service import generate_digest
    from agents.insight_generator import generate_insight
    from services.radar_service import knowledge_health

    digest = await generate_digest(db, "daily")
    insight = await generate_insight(db, persist=True)
    health = await knowledge_health(db)
    decisions = [
        {"agent": "问答/运营 Agent", "decision": "生成日报", "detail": digest.get("title", ""), "status": "ok"},
        {"agent": "问答/运营 Agent", "decision": "生成洞察", "detail": f"insight {insight.get('id', '')}", "status": "ok"},
        {"agent": "问答/运营 Agent", "decision": "计算健康度", "detail": str(health.get("health_score", "-")), "status": "ok"},
    ]
    return {
        "name": "问答/运营 Agent",
        "status": "ok",
        "detail": f"健康度 {health.get('health_score', '-')} · 日报 {digest.get('title', '')}",
        "decisions": decisions,
    }


async def run_closed_loop(db, collect: bool = False) -> dict:
    """依次执行三层，落盘每层决策日志，返回带 stage 轨迹与 run_id 的结果。"""
    run_id = uuid.uuid4().hex[:12]
    stages = []
    stages.append(await _stage_collection(db, collect))
    try:
        stages.append(await _stage_knowledge(db))
    except Exception as e:
        logger.exception("知识治理 Agent 失败")
        stages.append({"name": "知识治理 Agent", "status": "error", "detail": str(e), "decisions": [{"agent": "知识治理 Agent", "decision": "治理失败", "detail": str(e), "status": "error"}]})
    try:
        stages.append(await _stage_answer(db))
    except Exception as e:
        logger.exception("问答/运营 Agent 失败")
        stages.append({"name": "问答/运营 Agent", "status": "error", "detail": str(e), "decisions": [{"agent": "问答/运营 Agent", "decision": "运营失败", "detail": str(e), "status": "error"}]})

    # 落盘决策日志
    for s in stages:
        for d in s.get("decisions", []):
            db.add(DecisionLog(run_id=run_id, agent=d["agent"], decision=d["decision"], detail=d.get("detail"), status=d.get("status", "ok")))
    await db.commit()

    ok = sum(1 for s in stages if s["status"] in ("ok", "partial"))
    return {
        "run_id": run_id,
        "stages": stages,
        "summary": f"闭环执行完成：{ok}/{len(stages)} 层正常",
        "status": "ok" if ok == len(stages) else "partial",
    }

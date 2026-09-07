"""三层 Agent 智能运营闭环（G）：采集 Agent → 知识治理 Agent → 问答/运营 Agent 一键编排。

把分散的 Collection / Knowledge(治理+图谱) / Answer(洞察+健康) 串成一条自动化闭环，
每层独立 try/except 降级：任一层失败不影响其它层，返回结构化 stage 轨迹供前端展示。

- 采集 Agent：对 active 数据源执行实时采集（collect=True 时启用，best-effort）。
- 知识治理 Agent：新鲜度刷新 → 冲突检测 → 审核队列 → 归档过期 → 图谱增量构建。
- 问答/运营 Agent：生成日报 + AI 洞察（落盘）→ 知识健康度。
"""
import logging

from sqlalchemy import select

from models import CollectionJob, Source

logger = logging.getLogger(__name__)


async def _stage_collection(db, collect: bool) -> dict:
    """采集层：为 active 数据源建采集任务并执行（best-effort）。"""
    if not collect:
        return {
            "name": "采集 Agent",
            "status": "skipped",
            "detail": "未开启实时采集（collect=true 可运行）",
            "jobs": 0,
        }
    sources = (await db.execute(select(Source).where(Source.status == "active"))).scalars().all()
    if not sources:
        return {"name": "采集 Agent", "status": "ok", "detail": "无 active 数据源", "jobs": 0}
    from services.collection_service import run_collection

    created = 0
    ok = 0
    failed = 0
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
    }


async def _stage_knowledge(db) -> dict:
    """知识治理层：新鲜度/冲突/审核/归档/图谱。"""
    result = {}
    from services.freshness_service import refresh_freshness
    from services.conflict_service import detect_conflicts
    from services.review_service import build_review_queue
    from services.governance_service import archive_expired
    from services.kg_service import build_graph

    result["freshness"] = "过期 %s" % (await refresh_freshness(db)).get("expired", 0)
    result["conflicts_created"] = await detect_conflicts(db)
    result["review_created"] = await build_review_queue(db)
    result["archived"] = await archive_expired(db)
    try:
        kg = await build_graph(db, limit=20)
        result["graph"] = f"新增关系 {kg.get('relations_added', 0)}"
    except Exception as e:
        logger.warning("知识治理 Agent 图谱构建失败（降级）: %s", e)
        result["graph"] = f"图谱跳过：{e}"
    return {
        "name": "知识治理 Agent",
        "status": "ok",
        "detail": (
            f"冲突 {result['conflicts_created']} · 审核 {result['review_created']} · "
            f"归档过期 {result['archived']} · {result.get('graph', '')}"
        ),
    }


async def _stage_answer(db) -> dict:
    """问答/运营层：日报 + AI 洞察 + 健康度。"""
    from services.digest_service import generate_digest
    from agents.insight_generator import generate_insight
    from services.radar_service import knowledge_health

    digest = await generate_digest(db, "daily")
    insight = await generate_insight(db, persist=True)
    health = await knowledge_health(db)
    return {
        "name": "问答/运营 Agent",
        "status": "ok",
        "detail": f"健康度 {health.get('health_score', '-')} · 日报 {digest.get('title', '')}",
    }


async def run_closed_loop(db, collect: bool = False) -> dict:
    """依次执行三层，返回带 stage 轨迹的结果。"""
    stages = []
    stages.append(await _stage_collection(db, collect))
    try:
        stages.append(await _stage_knowledge(db))
    except Exception as e:
        logger.exception("知识治理 Agent 失败")
        stages.append({"name": "知识治理 Agent", "status": "error", "detail": str(e)})
    try:
        stages.append(await _stage_answer(db))
    except Exception as e:
        logger.exception("问答/运营 Agent 失败")
        stages.append({"name": "问答/运营 Agent", "status": "error", "detail": str(e)})

    ok = sum(1 for s in stages if s["status"] in ("ok", "partial"))
    return {
        "stages": stages,
        "summary": f"闭环执行完成：{ok}/{len(stages)} 层正常",
        "status": "ok" if ok == len(stages) else "partial",
    }

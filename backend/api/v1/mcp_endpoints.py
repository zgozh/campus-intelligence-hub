"""Campus Knowledge MCP（spec §29/§56）：MCP (Model Context Protocol) JSON-RPC 2.0 over HTTP。

供其它学校 AI 应用（招生助手/科研助手/校务客服等）经 MCP 统一调用校务知识工具，避免重复爬官网。
协议：POST /api/mcp，支持 initialize / tools/list / tools/call。
"""
import json

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from database import get_db
from models import ChangeEvent, KnowledgeObject, ReviewTask, Source
from services.search_service import search_knowledge
from agents.insight_generator import generate_insight
from services.agent_orchestrator import run_closed_loop

router = APIRouter(prefix="/api")

TOOLS = [
    {
        "name": "campus_search",
        "description": "搜索校务知识（融合评分，含权威度/新鲜度/有效期/置信度）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "检索语句"},
                "limit": {"type": "integer", "default": 5},
            },
            "required": ["query"],
        },
    },
    {
        "name": "campus_source",
        "description": "获取校务数据源列表（名称/类型/状态/权威度）。",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "campus_knowledge",
        "description": "获取单条知识对象详情。",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
        },
    },
    {
        "name": "campus_changes",
        "description": "获取最近知识变更（Change Radar，含严重度/类型/摘要）。",
        "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "default": 10}}},
    },
    {
        "name": "campus_review",
        "description": "获取待审核校务知识。",
        "inputSchema": {"type": "object", "properties": {"status": {"type": "string", "default": "pending"}}},
    },
    {
        "name": "campus_insight",
        "description": "生成 AI 校务洞察（本期要点/趋势/风险/建议，基于运营数据）。",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "campus_closed_loop",
        "description": "一键运行三层智能运营闭环（采集→知识治理→问答/运营）。可选 collect=true 开启实时采集。",
        "inputSchema": {
            "type": "object",
            "properties": {"collect": {"type": "boolean", "default": False}},
        },
    },
]


def _ko_dict(ko: KnowledgeObject) -> dict:
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
        "source_url": ko.source_url,
    }


async def _call_tool(name: str, args: dict, db):
    if name == "campus_search":
        q = args.get("query", "")
        limit = int(args.get("limit") or 5)
        kos = await search_knowledge(db, q, top_k=limit)
        return {"query": q, "results": [_ko_dict(k) for k in kos], "total": len(kos)}

    if name == "campus_source":
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
                    "authority": s.authority,
                }
                for s in sources
            ],
            "total": len(sources),
        }

    if name == "campus_knowledge":
        ko = await db.get(KnowledgeObject, args.get("id"))
        if not ko:
            return {"error": "knowledge object not found"}
        return _ko_dict(ko)

    if name == "campus_changes":
        limit = int(args.get("limit") or 10)
        rows = await db.execute(select(ChangeEvent).order_by(ChangeEvent.detected_at.desc()).limit(limit))
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

    if name == "campus_review":
        status = args.get("status") or "pending"
        rows = await db.execute(
            select(ReviewTask).where(ReviewTask.status == status).order_by(ReviewTask.created_at.desc())
        )
        tasks = rows.scalars().all()
        return {
            "tasks": [
                {
                    "id": t.id,
                    "knowledge_object_id": t.knowledge_object_id,
                    "reason": t.reason,
                    "status": t.status,
                }
                for t in tasks
            ],
            "total": len(tasks),
        }

    if name == "campus_insight":
        result = await generate_insight(db)
        return {"content": result["content"], "data": result.get("data", {})}

    if name == "campus_closed_loop":
        result = await run_closed_loop(db, collect=bool(args.get("collect", False)))
        return {"status": result["status"], "summary": result["summary"], "stages": result["stages"]}

    return {"error": f"unknown tool: {name}"}


@router.post("/mcp")
async def mcp_endpoint(request: Request, db=Depends(get_db)):
    """MCP JSON-RPC 端点。"""
    try:
        body = await request.json()
    except Exception:
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}

    method = body.get("method")
    rid = body.get("id")
    params = body.get("params") or {}

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "campus-knowledge-mcp", "version": "1.0.0"},
            },
        }

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": rid, "result": {"tools": TOOLS}}

    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        try:
            result = await _call_tool(name, args, db)
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]
                },
            }
        except Exception as exc:  # noqa: BLE001
            return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32603, "message": str(exc)}}

    return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "method not found"}}

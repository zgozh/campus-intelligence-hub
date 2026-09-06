"""校务搜索与问答 API（EPIC 8）。"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.endpoints.auth import get_current_admin
from database import get_db
from models import AdminUser
from services.ask_service import ask
from services.search_service import search_knowledge

router = APIRouter(prefix="/api/v1")


class AskRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    top_k: int = Field(5, ge=1, le=20)


@router.post("/search")
async def search(
    payload: AskRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """校务知识搜索（关键词）。"""
    kos = await search_knowledge(db, payload.query, payload.top_k)
    results = [
        {
            "id": ko.id,
            "type": ko.type,
            "title": ko.title,
            "department": ko.department,
            "summary": ko.summary,
            "tags": ko.tags,
            "facts": ko.facts,
            "status": ko.status,
            "source_url": ko.source_url,
        }
        for ko in kos
    ]
    return {"results": results, "total": len(results)}


@router.post("/ask")
async def ask_question(
    payload: AskRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """校务 AI 问答（检索 + citation + freshness-aware）。"""
    return await ask(db, payload.query, payload.top_k)

"""配置 Schema 与栏目发现 API（REFACTOR_PLAN_V2 T3 / T6）。

薄路由：参数校验与委派，逻辑在 services/config_schema_service.py 与
services/column_discovery_service.py。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.endpoints.auth import get_current_admin
from database import get_db
from models import AdminUser, Source
from services import config_schema_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")


@router.get("/version")
async def get_version():
    """构建版本（公开只读）：供前端与真机探针确认"跑的是哪个构建"（REFACTOR_PLAN_V2_2 A2）。

    刻意不加鉴权：版本号不构成攻击面，而探针/用户需要不登录也能核对版本；
    返回内容仅 name/version/build/commit/environment，不含任何配置或密钥。
    """
    from services.version_service import get_version_info

    return get_version_info()


@router.get("/config-schema/{name}")
async def get_config_schema(
    name: str,
    current_user: AdminUser = Depends(get_current_admin),
):
    """返回闭环 / 采集的参数 Schema；前端据此动态渲染配置表单。"""
    try:
        return config_schema_service.get_schema(name)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"未知 Schema: {name}")


@router.get("/sources/{source_id}/columns")
async def list_source_columns(
    source_id: str,
    refresh: bool = False,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """栏目动态发现：返回该数据源真实可用的内容栏目（含历史条数计数）。

    数据来源：RawDocument.column 的真实分布（history）+ 适配器声明的栏目映射（adapter）。
    """
    source = (
        await db.execute(select(Source).where(Source.id == source_id))
    ).scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail="数据源不存在")

    # 延迟导入，避免与 collection_service 形成循环依赖
    from services import column_discovery_service

    return await column_discovery_service.discover_columns(db, source, refresh=refresh)

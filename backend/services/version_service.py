"""构建版本信息（REFACTOR_PLAN_V2_2 A2）。

目的：让"用户/探针跑的是哪个构建"可一眼确认，从根上消除"容器里是新代码、用户标签页跑旧
bundle、双方各说各话"的误判。

单一真源是环境变量 `APP_BUILD`：
- 由 `docker compose` 同时注入后端环境与前端构建参数（见 docker-compose.yml）；
- 前端在构建期写入 `NEXT_PUBLIC_BUILD_ID`（页面侧边栏可见 + 布局 `data-build` 属性）；
- 后端在本接口原样返回，前端启动时比对，不一致就在 Header 提示"前后端版本不一致"。
"""
import os

DEFAULT_VERSION = "2.2.0"


def get_version_info() -> dict:
    """返回最小版本信息（公开只读，不含任何敏感配置）。"""
    build = (os.getenv("APP_BUILD") or "").strip()
    return {
        "name": "campus-intelligence-hub",
        "version": (os.getenv("APP_VERSION") or DEFAULT_VERSION).strip(),
        # 同一个构建标识：前端 NEXT_PUBLIC_BUILD_ID 应与此一致
        "build": build or "unknown",
        "commit": (os.getenv("GIT_COMMIT") or "").strip() or "unknown",
        "environment": (os.getenv("APP_ENVIRONMENT") or "development").strip(),
    }

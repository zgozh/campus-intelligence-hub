"""DashScope Embedding 封装（text-embedding-v3，OpenAI 兼容；失败降级空列表）。"""
import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)

EMBEDDING_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
EMBEDDING_MODEL = "text-embedding-v3"
VECTOR_SIZE = 1024


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """批量生成 embedding；无 key 或失败时返回空列表（主链路降级）。"""
    if not settings.dashscope_api_key or not texts:
        return []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMBEDDING_BASE}/embeddings",
                headers={"Authorization": f"Bearer {settings.dashscope_api_key}"},
                json={"model": EMBEDDING_MODEL, "input": texts, "dimensions": VECTOR_SIZE},
            )
            if resp.status_code != 200:
                logger.warning("embedding 请求失败: %s", resp.status_code)
                return []
            data = resp.json()
            return [d["embedding"] for d in data.get("data", [])]
    except Exception as e:
        logger.warning("embedding 调用异常（降级）: %s", e)
        return []

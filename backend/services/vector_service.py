"""Qdrant 向量检索（语义检索增强，用 REST API，失败降级）。"""
import logging
import uuid

import httpx

from config import settings

logger = logging.getLogger(__name__)

COLLECTION = "campus_knowledge"
VECTOR_SIZE = 1024


async def ensure_collection() -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{settings.qdrant_url}/collections/{COLLECTION}")
        if resp.status_code == 200:
            return
        await client.put(
            f"{settings.qdrant_url}/collections/{COLLECTION}",
            json={"vectors": {"size": VECTOR_SIZE, "distance": "Cosine"}},
        )


async def upsert_ko(ko_id: str, embedding: list[float], payload: dict) -> None:
    """入库：point id 用 UUID，payload 存 ko_id（Qdrant id 只接受 UUID/整数）。"""
    point_id = str(uuid.uuid4())
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.put(
            f"{settings.qdrant_url}/collections/{COLLECTION}/points?wait=true",
            json={
                "points": [
                    {"id": point_id, "vector": embedding, "payload": {**payload, "ko_id": ko_id}}
                ]
            },
        )
        if resp.status_code != 200:
            logger.warning("Qdrant upsert 失败: %s %s", resp.status_code, resp.text[:200])


async def search(query_embedding: list[float], top_k: int = 5) -> list[str]:
    """语义检索，返回 KO id 列表；失败返回空。"""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{settings.qdrant_url}/collections/{COLLECTION}/points/search",
            json={"vector": query_embedding, "limit": top_k, "with_payload": True},
        )
        if resp.status_code != 200:
            return []
        data = resp.json()
        return [
            (hit.get("payload") or {}).get("ko_id", "")
            for hit in data.get("result", [])
            if (hit.get("payload") or {}).get("ko_id")
        ]

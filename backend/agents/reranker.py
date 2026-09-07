"""DashScope Rerank 封装（gte-rerank-v2，文本交叉编码精排；失败降级返回 None）。

D 方向（RAG 增强）：融合检索召回 top_k 候选后，用交叉编码器对(query, document)精排，
提升"证据引用准确率"。无 API key 或调用失败时返回 None，调用方保持原顺序（主链路降级）。
"""
import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)

RERANK_BASE = "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank"
RERANK_MODEL = "gte-rerank-v2"


async def rerank_documents(query: str, documents: list[str], top_n: int = 5) -> list[int] | None:
    """对 documents 按 query 精排，返回按相关性降序的原始下标列表。

    返回 None 表示降级（未配置 key / 请求失败 / 输入为空），调用方应使用原顺序。
    """
    if not settings.dashscope_api_key or not documents or not query:
        return None
    try:
        payload = {
            "model": RERANK_MODEL,
            "input": {"query": query, "documents": documents},
            "parameters": {"top_n": top_n, "return_documents": False},
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                RERANK_BASE,
                headers={"Authorization": f"Bearer {settings.dashscope_api_key}"},
                json=payload,
            )
            if resp.status_code != 200:
                logger.warning("rerank 请求失败: %s %s", resp.status_code, resp.text[:200])
                return None
            data = resp.json()
            results = data.get("output", {}).get("results", [])
            # results 已按 relevance_score 降序排序；取其原始 index
            ordered = [int(r["index"]) for r in results if "index" in r]
            return ordered if ordered else None
    except Exception as e:
        logger.warning("rerank 调用异常（降级）: %s", e)
        return None

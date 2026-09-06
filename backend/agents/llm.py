"""LLM 调用封装（Provider Adapter + Mock 兜底）。"""
from config import settings
from services.llm_service import get_llm_service

DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"


async def ask_llm(
    prompt: str, system: str | None = None, model: str | None = None
) -> str:
    """非流式询问 LLM；无 API key 时自动降级 Mock。"""
    llm = get_llm_service(
        api_key=settings.dashscope_api_key or settings.deepseek_api_key or None,
        api_base=DASHSCOPE_BASE,
        model=model or "qwen-plus",
        provider_type="openai",
    )
    messages = [{"role": "user", "content": prompt}]
    chunks = []
    async for chunk in llm.chat_completion(
        messages, system_prompt=system, stream=False, temperature=0.3
    ):
        chunks.append(chunk)
    return "".join(chunks)

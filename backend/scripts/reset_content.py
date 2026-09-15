"""只清空「内容」数据、保留数据源与账号配置（录制演示前的"半清空"）。

与 `scripts.reset_demo` 的区别：
  reset_demo       = 内容 + **数据源**一起清（连配置都没了，之后要重新导入数据源）
  reset_content.py = 只清内容，**保留**数据源 / 工作空间 / Agent / 管理员等配置与账号

为什么需要这个脚本：
  演示视频里"采集"镜头想看到「新增 N」而不是「跳过 N」，而 `raw_documents` 是
  **全局按 normalized_url 去重**的 —— 只要文章 URL 还在库里，任何数据源再采都只会"跳过"。
  所以要看到真实增量，必须清掉内容，但没必要连数据源配置一起清。

删除顺序复用 `scripts.seed_demo._RESET_ORDER`（外键依赖由深到浅，单一事实来源），
仅剔除 `Source` 一项 —— 顺序错了会被 NO ACTION 外键挡住（详见 seed_demo 注释）。

用法：
  docker compose exec -T backend python -m scripts.reset_content          # 干跑：只打印将清空的条数
  docker compose exec -T backend python -m scripts.reset_content --yes    # 真正执行
"""
import asyncio
import sys

from sqlalchemy import delete, func, select

from database import AsyncSessionLocal
from models import Source
from scripts.seed_demo import _RESET_ORDER

# 内容表（保留 Source：数据源配置属于"配置"，不属于"内容"）
CONTENT_ORDER = tuple(model for model in _RESET_ORDER if model is not Source)


async def count_content(db) -> dict[str, int]:
    """统计各内容表当前条数。"""
    counts: dict[str, int] = {}
    for model in CONTENT_ORDER:
        counts[model.__tablename__] = await db.scalar(select(func.count()).select_from(model))
    return counts


async def reset_content(apply: bool = False) -> dict:
    """清空内容数据；apply=False 时只统计不删除（干跑）。"""
    async with AsyncSessionLocal() as db:
        before = await count_content(db)
        sources = await db.scalar(select(func.count()).select_from(Source))
        if apply:
            for model in CONTENT_ORDER:
                await db.execute(delete(model))
            await db.commit()
            after = await count_content(db)
        else:
            after = dict(before)
        sources_after = await db.scalar(select(func.count()).select_from(Source))
        return {
            "applied": apply,
            "before": before,
            "after": after,
            "sources_before": sources,
            "sources_after": sources_after,
        }


def main() -> None:
    apply = "--yes" in sys.argv
    result = asyncio.run(reset_content(apply))

    total_before = sum(result["before"].values())
    print("=" * 62)
    print("模式：" + ("执行删除" if result["applied"] else "干跑（不删除，只统计）"))
    print("=" * 62)
    for name, n in result["before"].items():
        print(f"  {name:<20} {n:>6}")
    print(f"  {'（合计）':<20} {total_before:>6}")
    print("-" * 62)
    print(f"  数据源（保留）          {result['sources_before']:>6} -> {result['sources_after']:>6}")
    if result["applied"]:
        leftover = sum(result["after"].values())
        print(f"  清理后内容剩余          {leftover:>6}  " + ("(OK)" if leftover == 0 else "(异常：仍有残留！)"))
        print()
        print("下一步建议：")
        print("  1) 数据源管理 → 对目标栏目执行「采集」（此时会显示「新增 N」）")
        print("  2) 知识图谱 → 构建；校务洞察 / 智能闭环 各跑一次，产出洞察与通知")
    else:
        print()
        print("确认无误后执行（会真删上面的内容，数据源与账号保留）：")
        print("  docker compose exec -T backend python -m scripts.reset_content --yes")


if __name__ == "__main__":
    main()

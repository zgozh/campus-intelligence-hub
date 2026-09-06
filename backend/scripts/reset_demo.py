"""清空演示数据（spec §32 RESET_DEMO）。

用法：docker exec campus-backend python3 -m scripts.reset_demo
"""
import asyncio

from scripts.seed_demo import reset_demo

if __name__ == "__main__":
    asyncio.run(reset_demo())
    print("已清空全部数据")

"""迁移：为已有数据库添加校务新字段（幂等，spec EPIC 6/9）。

新增列：
- sources.authority
- knowledge_objects.authority / freshness_level / source_version / last_verified_at

新部署空库由 init_db 的 create_all 直接建含新列的表；本脚本用于升级已有库。
"""
import asyncio

from sqlalchemy import text

from database import engine

ADD_COLUMNS = {
    "sources": [("authority", "DOUBLE PRECISION DEFAULT 0.9")],
    "knowledge_objects": [
        ("authority", "DOUBLE PRECISION DEFAULT 0.8"),
        ("freshness_level", "VARCHAR(20) DEFAULT 'Unknown'"),
        ("source_version", "INTEGER DEFAULT 1"),
        ("last_verified_at", "TIMESTAMPTZ"),
    ],
}


async def migrate():
    async with engine.begin() as conn:
        for table, cols in ADD_COLUMNS.items():
            for col, ddl in cols:
                exists = await conn.execute(
                    text(
                        "SELECT 1 FROM information_schema.columns "
                        "WHERE table_name=:t AND column_name=:c"
                    ),
                    {"t": table, "c": col},
                )
                if not exists.scalar():
                    await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
                    print(f"✓ ADD COLUMN {table}.{col}")
                else:
                    print(f"= already exists {table}.{col}")
    print("迁移完成")


if __name__ == "__main__":
    asyncio.run(migrate())

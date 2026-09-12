"""迁移：闭环运行记录 + 展示层字段（幂等，REFACTOR_PLAN_V2 T1）。

新增表：
- run_records（闭环/长任务运行记录：状态 / 参数快照 / 起止 / 耗时 / 取消标志）

新增列：
- insight_reports.title / brief_reports.title（干净标题，供列表与折叠头展示）
- notifications.link（点击通知的跳转目标）
- decision_logs.finished_at / decision_logs.duration_ms（时间线展示每步完成时刻与耗时）

同时回填历史数据的 title（取 content 首行去 Markdown 后截断）。

新部署空库由 create_all 直接建含新列的表；本脚本用于升级已有库。
脚本可重复执行（幂等），PostgreSQL 与 SQLite 双分支，pytest 的 SQLite 测试库同样可跑通。
"""
import asyncio

from sqlalchemy import text

from database import engine
from services.text_utils import clean_title  # noqa: F401  （清洗逻辑单一出口，生成侧共用）

# 新列定义：{表: [(列, PostgreSQL 类型, SQLite 类型)]}
ADD_COLUMNS: dict[str, list[tuple[str, str, str]]] = {
    "insight_reports": [("title", "VARCHAR(200)", "VARCHAR(200)")],
    "brief_reports": [("title", "VARCHAR(200)", "VARCHAR(200)")],
    "notifications": [("link", "VARCHAR(1000)", "VARCHAR(1000)")],
    "decision_logs": [
        ("finished_at", "TIMESTAMPTZ", "DATETIME"),
        ("duration_ms", "INTEGER", "INTEGER"),
    ],
}

RUN_RECORDS_PG = """
CREATE TABLE IF NOT EXISTS run_records (
    run_id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(20) NOT NULL DEFAULT 'closed_loop',
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    params JSON,
    summary TEXT,
    error TEXT,
    cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
)
"""

RUN_RECORDS_SQLITE = """
CREATE TABLE IF NOT EXISTS run_records (
    run_id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(20) NOT NULL DEFAULT 'closed_loop',
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    params JSON,
    summary TEXT,
    error TEXT,
    cancel_requested BOOLEAN NOT NULL DEFAULT 0,
    started_at DATETIME,
    finished_at DATETIME,
    duration_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
"""

RUN_RECORDS_INDEX = (
    "CREATE INDEX IF NOT EXISTS ix_run_records_type_created ON run_records (type, created_at)"
)

# 需要回填 title 的表（title 为空的历史数据）
TITLE_BACKFILL_TABLES = ("insight_reports", "brief_reports")


async def _column_exists(conn, dialect: str, table: str, column: str) -> bool:
    if dialect == "sqlite":
        rows = await conn.execute(text(f"PRAGMA table_info({table})"))
        return any(row[1] == column for row in rows.fetchall())
    result = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name=:t AND column_name=:c"
        ),
        {"t": table, "c": column},
    )
    return bool(result.scalar())


async def _table_exists(conn, dialect: str, table: str) -> bool:
    if dialect == "sqlite":
        rows = await conn.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:t"), {"t": table}
        )
        return bool(rows.scalar())
    rows = await conn.execute(
        text("SELECT 1 FROM information_schema.tables WHERE table_name=:t"), {"t": table}
    )
    return bool(rows.scalar())


async def _backfill_titles(conn, table: str) -> int:
    """把 content 首行清洗后写入 title（仅 title 为空的行）。返回回填条数。"""
    rows = await conn.execute(
        text(f"SELECT id, content FROM {table} WHERE title IS NULL OR title = ''")
    )
    pending = rows.fetchall()
    updated = 0
    for row_id, content in pending:
        title = clean_title(content)
        if not title:
            continue
        await conn.execute(
            text(f"UPDATE {table} SET title = :t WHERE id = :i"), {"t": title, "i": row_id}
        )
        updated += 1
    return updated


async def migrate(target_engine=None) -> dict:
    """执行迁移（幂等）。返回本次实际执行的动作统计，便于测试断言。"""
    target = target_engine if target_engine is not None else engine
    dialect = target.dialect.name
    stats = {"tables_created": 0, "columns_added": 0, "titles_backfilled": 0}

    async with target.begin() as conn:
        # 1) 新表 run_records
        if not await _table_exists(conn, dialect, "run_records"):
            ddl = RUN_RECORDS_SQLITE if dialect == "sqlite" else RUN_RECORDS_PG
            await conn.execute(text(ddl))
            stats["tables_created"] += 1
            print("✓ CREATE TABLE run_records")
        else:
            print("= already exists run_records")
        await conn.execute(text(RUN_RECORDS_INDEX))

        # 2) 新列
        for table, cols in ADD_COLUMNS.items():
            if not await _table_exists(conn, dialect, table):
                print(f"! skip {table}（表不存在）")
                continue
            for col, pg_type, sqlite_type in cols:
                if await _column_exists(conn, dialect, table, col):
                    print(f"= already exists {table}.{col}")
                    continue
                ddl_type = sqlite_type if dialect == "sqlite" else pg_type
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl_type}"))
                stats["columns_added"] += 1
                print(f"✓ ADD COLUMN {table}.{col}")

        # 3) 历史数据回填 title（放在加列之后，保证列存在）
        for table in TITLE_BACKFILL_TABLES:
            if not await _table_exists(conn, dialect, table):
                continue
            if not await _column_exists(conn, dialect, table, "title"):
                continue
            n = await _backfill_titles(conn, table)
            stats["titles_backfilled"] += n
            if n:
                print(f"✓ BACKFILL {table}.title × {n}")

    print(f"迁移完成：{stats}")
    return stats


if __name__ == "__main__":
    asyncio.run(migrate())

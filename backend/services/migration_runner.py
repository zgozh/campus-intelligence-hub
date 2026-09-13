"""启动时迁移执行器（REFACTOR_PLAN_V2_2 C3）。

问题：新增列依赖人工执行 `backend/scripts/migrate_run_records_and_fields.py`，
而 `create_all` **不会** ALTER 既有表 —— 升级部署一旦忘记执行，新列静默缺失、功能报错。

方案：
- 有序**迁移注册表**（name → 幂等 async 函数）+ `schema_migrations` 执行记录表；
- 应用启动（`main.py` lifespan）时自动执行：已执行的跳过、未执行的依次执行；
- 并发互斥：PostgreSQL 用 `pg_advisory_lock` 包裹（多副本/重复启动安全）；
  SQLite（测试库）无 advisory lock，单进程语义天然安全（分支注释说明）；
- 失败语义：任一迁移抛错 → 记录日志并**向上抛出**，让启动失败（fail fast，绝不带病启动）；
  幂等保证重启重试安全；
- 新部署与升级部署同一入口：新库由 `create_all` 建全量结构后 runner 只写执行记录（秒过），
  升级库由 runner 补差量；
- 回滚策略：只增不删（additive-only），需要毁结构时走 expand-contract（新列/新表 + 代码切换 +
  观察期 + 后续版本清理），不做 down 迁移。
"""
import logging

from sqlalchemy import text

import database

logger = logging.getLogger(__name__)

# 迁移互斥用的固定 advisory lock key（任意常量，仅本用途）
ADVISORY_LOCK_KEY = 823415926


async def _migration_run_records_and_display_fields(target_engine) -> None:
    """run_records 新表 + 展示层新列（title/link/finished_at/duration_ms）+ title 回填。

    复用既有脚本的幂等实现（保留脚本作为手动运维入口，不双份实现）。
    """
    from scripts.migrate_run_records_and_fields import migrate as migrate_fields

    await migrate_fields(target_engine)


# 有序注册表：新增迁移只允许**追加**，不得修改已发布项的行为
MIGRATIONS: list[tuple[str, object]] = [
    ("2026-09-12_run_records_and_display_fields", _migration_run_records_and_display_fields),
]


def _create_table_sql(dialect: str) -> str:
    stamp = "TIMESTAMPTZ DEFAULT now()" if dialect != "sqlite" else "DATETIME DEFAULT CURRENT_TIMESTAMP"
    return (
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "  name VARCHAR(200) PRIMARY KEY,"
        f"  applied_at {stamp}"
        ")"
    )


async def _ensure_table(engine, dialect: str) -> None:
    async with engine.begin() as conn:
        await conn.execute(text(_create_table_sql(dialect)))


async def _applied_names(engine) -> set[str]:
    async with engine.begin() as conn:
        rows = await conn.execute(text("SELECT name FROM schema_migrations"))
        return {row[0] for row in rows.fetchall()}


async def _record(engine, name: str) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO schema_migrations (name) VALUES (:n)"), {"n": name}
        )


async def run_migrations(target_engine=None) -> dict:
    """执行未应用的迁移（幂等）。返回 {applied, skipped, total}。"""
    engine = target_engine if target_engine is not None else database.engine
    dialect = engine.dialect.name
    stats = {"applied": 0, "skipped": 0, "total": len(MIGRATIONS)}

    await _ensure_table(engine, dialect)

    lock_conn = None
    if dialect == "postgresql":
        # 多副本/重复启动互斥：拿到锁的实例执行，其它实例等待后按记录跳过
        lock_conn = await engine.connect()
        await lock_conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": ADVISORY_LOCK_KEY})

    try:
        done = await _applied_names(engine)
        for name, func in MIGRATIONS:
            if name in done:
                stats["skipped"] += 1
                continue
            logger.info("执行迁移：%s", name)
            await func(engine)  # type: ignore[operator]
            await _record(engine, name)
            stats["applied"] += 1
            logger.info("迁移完成：%s", name)
    finally:
        if lock_conn is not None:
            try:
                await lock_conn.execute(
                    text("SELECT pg_advisory_unlock(:k)"), {"k": ADVISORY_LOCK_KEY}
                )
            finally:
                await lock_conn.close()

    logger.info(
        "迁移检查完成：applied=%d skipped=%d total=%d",
        stats["applied"],
        stats["skipped"],
        stats["total"],
    )
    return stats

"""C3 启动时迁移执行器测试：幂等、跳过已应用、失败即中止（fail fast）、可续跑。

背景：新增列依赖人工执行脚本，而 `create_all` 不会 ALTER 既有表 —— 升级部署漏执行会静默缺列。
"""
import os
import sys

import pytest
from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from services import migration_runner  # noqa: E402


async def _applied(engine) -> set[str]:
    async with engine.begin() as conn:
        rows = await conn.execute(text("SELECT name FROM schema_migrations"))
        return {row[0] for row in rows.fetchall()}


class TestMigrationRunner:
    async def test_runs_pending_then_skips_on_second_run(self, setup_test_db):
        stats_first = await migration_runner.run_migrations(database.engine)
        assert stats_first["total"] == len(migration_runner.MIGRATIONS)
        assert stats_first["applied"] == len(migration_runner.MIGRATIONS)

        stats_second = await migration_runner.run_migrations(database.engine)
        assert stats_second["applied"] == 0
        assert stats_second["skipped"] == len(migration_runner.MIGRATIONS)

        names = await _applied(database.engine)
        assert names == {name for name, _ in migration_runner.MIGRATIONS}

    async def test_schema_migrations_table_created(self, setup_test_db):
        await migration_runner.run_migrations(database.engine)
        async with database.engine.begin() as conn:
            rows = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
            )
            assert rows.fetchone() is not None

    async def test_partial_state_simulates_upgrade_db(self, setup_test_db, monkeypatch):
        """模拟"部分已应用"的升级库：只执行缺失的那条。"""
        calls: list[str] = []

        async def fake_a(engine):
            calls.append("a")

        async def fake_b(engine):
            calls.append("b")

        monkeypatch.setattr(migration_runner, "MIGRATIONS", [("m_a", fake_a), ("m_b", fake_b)])

        # 先只应用 m_a（等价于老版本库已执行过 m_a）
        await migration_runner._ensure_table(database.engine, "sqlite")
        await migration_runner._record(database.engine, "m_a")

        stats = await migration_runner.run_migrations(database.engine)
        assert calls == ["b"]
        assert stats["applied"] == 1
        assert stats["skipped"] == 1

    async def test_failure_propagates_and_is_resumable(self, setup_test_db, monkeypatch):
        """失败必须向上抛（fail fast），且修好后续跑只补未完成项。"""
        calls: list[str] = []

        async def broken(engine):
            calls.append("broken")
            raise RuntimeError("迁移失败")

        monkeypatch.setattr(migration_runner, "MIGRATIONS", [("m_broken", broken)])

        with pytest.raises(RuntimeError, match="迁移失败"):
            await migration_runner.run_migrations(database.engine)

        # 失败的迁移不得被记录为已应用 → 重启后会重试
        assert "m_broken" not in await _applied(database.engine)

        async def fixed(engine):
            calls.append("fixed")

        monkeypatch.setattr(migration_runner, "MIGRATIONS", [("m_broken", fixed)])
        stats = await migration_runner.run_migrations(database.engine)
        assert stats["applied"] == 1
        assert calls == ["broken", "fixed"]

    async def test_real_migration_is_idempotent_and_effective(self, setup_test_db):
        """真实注册表：跑完后新列/新表确实存在（SQLite 测试库路径）。"""
        await migration_runner.run_migrations(database.engine)
        async with database.engine.begin() as conn:
            cols = await conn.execute(text("PRAGMA table_info(decision_logs)"))
            names = {row[1] for row in cols.fetchall()}
            assert {"finished_at", "duration_ms"} <= names

            tables = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table'")
            )
            assert "run_records" in {row[0] for row in tables.fetchall()}


class TestStartupIntegration:
    def test_lifespan_calls_migration_runner(self):
        """静态护栏：启动流程必须调用迁移执行器（否则升级库会静默缺列）。"""
        import inspect

        import main

        source = inspect.getsource(main.lifespan)
        assert "run_migrations" in source
        assert "reap_orphaned_runs" in source  # B11 崩溃恢复同样在启动路径上

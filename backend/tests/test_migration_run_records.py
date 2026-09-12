"""T1 迁移测试：run_records 新表 + 展示层新列 + title 回填（幂等）。

对应用户实测缺陷：洞察/快讯列表标题显示原始 ISO 时间戳与未清洗 Markdown。
"""
import os
import sys

from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import BriefReport, DecisionLog, InsightReport, Notification, RunRecord  # noqa: E402
from scripts.migrate_run_records_and_fields import clean_title, migrate  # noqa: E402


def _engine():
    """取当前测试库引擎（configure_database 会重绑定 database.engine，不能import时快照）。"""
    return database.engine


class TestCleanTitle:
    """标题清洗：去 Markdown 标记、取首个非空行、截断。"""

    def test_strips_bold_and_hash(self):
        assert clean_title("**校务知识洞察**") == "校务知识洞察"
        assert clean_title("# 今日校务快讯") == "今日校务快讯"

    def test_strips_links_and_lists(self):
        assert clean_title("[通知公告](https://x.edu.cn/a) 汇总") == "通知公告 汇总"
        assert clean_title("- 第一条要点") == "第一条要点"
        assert clean_title("2. 第二条要点") == "第二条要点"

    def test_takes_first_non_empty_line(self):
        assert clean_title("\n\n**校务知识洞察**\n\n正文内容") == "校务知识洞察"

    def test_literal_backslash_n_escape(self):
        # LLM 偶发双重转义：字面量 \n 应被当作换行处理
        assert clean_title("**校务知识洞察**\\n正文") == "校务知识洞察"

    def test_empty_and_truncate(self):
        assert clean_title(None) == ""
        assert clean_title("   ") == ""
        assert len(clean_title("甲" * 100)) == 60


class TestMigration:
    """迁移幂等性 + 新表/新列/回填效果。"""

    async def test_migrate_is_idempotent(self, setup_test_db):
        first = await migrate(_engine())
        second = await migrate(_engine())
        # 第二次不应再新增任何结构（表由 create_all 建好、列已存在、title 已回填）
        assert second["tables_created"] == 0
        assert second["columns_added"] == 0
        assert second["titles_backfilled"] == 0
        # 首次运行时 SQLite create_all 已含新结构，故首跑同样不该重复动结构
        assert first["columns_added"] == 0

    async def test_backfills_titles_from_content(self, setup_test_db):
        async with database.AsyncSessionLocal() as session:
            session.add(
                InsightReport(id="ins_t1", content="**校务知识洞察**\n\n本周要点…", title=None)
            )
            session.add(
                BriefReport(id="br_t1", content="# 校务快讯（近 7 天）\n\n新增 12 条", title=None)
            )
            await session.commit()

        stats = await migrate(_engine())
        assert stats["titles_backfilled"] == 2

        async with database.AsyncSessionLocal() as session:
            insight = await session.get(InsightReport, "ins_t1")
            brief = await session.get(BriefReport, "br_t1")
            assert insight is not None and insight.title == "校务知识洞察"
            assert brief is not None and brief.title == "校务快讯（近 7 天）"
            assert "*" not in (insight.title or "") and "#" not in (brief.title or "")

        # 再次执行不应重复回填
        assert (await migrate(_engine()))["titles_backfilled"] == 0

    async def test_creates_run_records_table_when_missing(self, setup_test_db):
        async with _engine().begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS run_records"))

        stats = await migrate(_engine())
        assert stats["tables_created"] == 1

        async with database.AsyncSessionLocal() as session:
            session.add(
                RunRecord(
                    run_id="run_t1",
                    type="closed_loop",
                    status="running",
                    params={"collect": False},
                )
            )
            await session.commit()
            row = await session.get(RunRecord, "run_t1")
            assert row is not None
            assert row.status == "running"
            assert row.params == {"collect": False}
            assert row.cancel_requested is False

    async def test_new_columns_exist_and_usable(self, setup_test_db):
        await migrate(_engine())
        async with database.AsyncSessionLocal() as session:
            session.add(
                Notification(
                    id="ntf_t1",
                    kind="insight",
                    title="校务知识洞察",
                    content="正文",
                    link="/insights",
                )
            )
            session.add(
                DecisionLog(
                    id="dec_t1",
                    run_id="run_t1",
                    agent="采集 Agent",
                    decision="采集 2 个数据源",
                    status="ok",
                    duration_ms=1234,
                )
            )
            await session.commit()

            ntf = await session.get(Notification, "ntf_t1")
            dec = await session.get(DecisionLog, "dec_t1")
            assert ntf is not None and ntf.link == "/insights"
            assert dec is not None and dec.duration_ms == 1234

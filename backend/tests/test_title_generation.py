"""T9 title 生成侧测试：洞察/快讯落库时写干净标题，列表响应带 title。

对应用户实测缺陷：历史洞察报告标题显示 `2026-09-08T14:07:42.033674+00:00 · **校务知识洞察**`
（时间未本地化 + Markdown 未清洗）。后端负责提供干净 title，前端负责格式化时间。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database  # noqa: E402
from models import BriefReport, InsightReport  # noqa: E402
from agents.insight_generator import generate_insight  # noqa: E402
from services.source_brief_service import generate_source_brief  # noqa: E402
from services.text_utils import clean_title  # noqa: E402


class TestGeneratorTitles:
    async def test_insight_persists_clean_title(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            result = await generate_insight(db, persist=True)
            assert result.get("id")
            assert result.get("title")

            row = await db.get(InsightReport, result["id"])
            assert row is not None
            assert row.title == clean_title(row.content)
            # 标题必须已清洗，不能残留 Markdown 标记
            assert "**" not in row.title
            assert not row.title.startswith("#")

    async def test_source_brief_persists_clean_title(self, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            result = await generate_source_brief(db, days=7, persist=True)
            assert result.get("id")
            assert result.get("title")

            row = await db.get(BriefReport, result["id"])
            assert row is not None
            assert row.title == clean_title(row.content)
            assert "**" not in row.title

    async def test_insights_list_response_includes_title(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            await generate_insight(db, persist=True)

        resp = await client.get("/api/v1/insights")
        assert resp.status_code == 200
        reports = resp.json()["reports"]
        assert reports
        assert reports[0]["title"]
        assert "**" not in reports[0]["title"]

    async def test_brief_list_response_includes_title(self, client, setup_test_db):
        async with database.AsyncSessionLocal() as db:
            await generate_source_brief(db, days=7, persist=True)

        resp = await client.get("/api/v1/sources/brief")
        assert resp.status_code == 200
        reports = resp.json()["reports"]
        assert reports
        assert reports[0]["title"]
        assert "**" not in reports[0]["title"]


class TestCleanTitleEdgeCases:
    def test_plain_text_passthrough(self):
        assert clean_title("校务快讯（近 7 天）") == "校务快讯（近 7 天）"

    def test_inline_code_and_emphasis(self):
        assert clean_title("## 本周`重点`事项") == "本周重点事项"

    def test_limit(self):
        assert len(clean_title("校" * 200, limit=10)) == 10

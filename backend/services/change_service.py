"""变更检测服务（EPIC 4/5）：Compare → ChangeEvent + Diff。

支持 Change Radar（列表/严重度/部门）与 Diff Viewer（Before/After 行级高亮）。
Diff 用 Python difflib 行级对比生成 changes 结构，前端零依赖渲染高亮。
"""
import logging
from difflib import SequenceMatcher

from sqlalchemy import func, select

from agents.change_annotator import annotate_change
from models import ChangeEvent, RawDocument, Source

logger = logging.getLogger(__name__)

_DATE_KEYWORDS = [
    "截止", "时间", "月", "日", "报名", "申请", "开始", "结束", "deadline", "截止时间",
]


def _classify(old: RawDocument, new: RawDocument, diff_ctx: str = "") -> tuple[list[str], str]:
    """判定 change_type 与 severity。"""
    ctypes: list[str] = []
    if old.title != new.title:
        ctypes.append("TITLE_CHANGED")
    if (old.publish_time or "") != (new.publish_time or ""):
        ctypes.append("DATE_CHANGED")
    if old.content != new.content:
        ctypes.append("CONTENT_CHANGED")

    if "DATE_CHANGED" in ctypes:
        severity = "HIGH"  # 时效变化最关键
    elif "CONTENT_CHANGED" in ctypes:
        severity = "MEDIUM"
        if any(k in diff_ctx for k in _DATE_KEYWORDS):
            severity = "HIGH"  # 正文含关键时点词
    elif ctypes:
        severity = "MEDIUM"
    else:
        severity = "LOW"
    return ctypes, severity


def _diff_summary(old: RawDocument, new: RawDocument, ctypes: list[str], diff_ctx: str) -> str:
    """人类可读的变更摘要。"""
    parts: list[str] = []
    if "TITLE_CHANGED" in ctypes:
        parts.append(f"标题从「{old.title}」改为「{new.title}」")
    if "DATE_CHANGED" in ctypes:
        parts.append(f"发布时间从 {old.publish_time or '无'} 改为 {new.publish_time or '无'}")
    if "CONTENT_CHANGED" in ctypes:
        sm = SequenceMatcher(
            None,
            (old.content or "").splitlines(),
            (new.content or "").splitlines(),
        )
        added = removed = 0
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag in ("insert", "replace"):
                added += j2 - j1
            if tag in ("delete", "replace"):
                removed += i2 - i1
        if added or removed:
            parts.append(f"正文更新（+{added} 行 / -{removed} 行）")
        else:
            parts.append("正文内容发生变化")
    return "；".join(parts) if parts else "内容发生变化"


def _opcodes_to_changes(before: str, after: str) -> list[dict]:
    """行级 diff 结构：unchanged / removed / added。"""
    before_lines = (before or "").splitlines()
    after_lines = (after or "").splitlines()
    sm = SequenceMatcher(None, before_lines, after_lines)
    changes: list[dict] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            changes.append({"type": "unchanged", "lines": before_lines[i1:i2]})
        elif tag == "insert":
            changes.append({"type": "added", "lines": after_lines[j1:j2]})
        elif tag == "delete":
            changes.append({"type": "removed", "lines": before_lines[i1:i2]})
        elif tag == "replace":
            changes.append({"type": "removed", "lines": before_lines[i1:i2]})
            changes.append({"type": "added", "lines": after_lines[j1:j2]})
    return changes


async def detect_and_record_change(db, source: Source, old_doc: RawDocument, new_doc: RawDocument) -> ChangeEvent:
    """比较前后版本并记录一条 ChangeEvent（采集变化时调用）。"""
    diff_ctx = (new_doc.content or "")[:600] + (old_doc.content or "")[:600]
    ctypes, severity = _classify(old_doc, new_doc, diff_ctx)
    summary = _diff_summary(old_doc, new_doc, ctypes, diff_ctx)

    # LLM 语义增强（失败降级规则摘要）
    annotation = await annotate_change(old_doc.content or "", new_doc.content or "")
    if annotation:
        severity = annotation.get("severity") or severity
        summary = annotation.get("summary") or summary

    ce = ChangeEvent(
        source_id=source.id,
        normalized_url=new_doc.normalized_url,
        old_raw_document_id=old_doc.id,
        new_raw_document_id=new_doc.id,
        old_version=old_doc.version,
        new_version=new_doc.version,
        change_type=ctypes,
        severity=severity,
        diff_summary=summary,
        content_hash=new_doc.content_hash,
        requires_review=(severity == "HIGH"),
    )
    db.add(ce)
    await db.flush()
    logger.info("ChangeEvent 记录：%s (%s) %s", ce.id, severity, ctypes)
    return ce


async def list_changes(db, limit: int = 20, offset: int = 0, severity: str | None = None):
    result = await db.execute(
        select(ChangeEvent, Source.name)
        .join(Source, ChangeEvent.source_id == Source.id)
        .where(ChangeEvent.severity == severity if severity else True)
        .order_by(ChangeEvent.detected_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = result.all()
    total = await db.scalar(select(func.count(ChangeEvent.id)))
    items = [
        {
            "id": ce.id,
            "source_id": ce.source_id,
            "source_name": sname,
            "normalized_url": ce.normalized_url,
            "old_version": ce.old_version,
            "new_version": ce.new_version,
            "change_type": ce.change_type or [],
            "severity": ce.severity,
            "diff_summary": ce.diff_summary,
            "requires_review": ce.requires_review,
            "detected_at": ce.detected_at.isoformat() if ce.detected_at else None,
        }
        for ce, sname in rows
    ]
    return {"changes": items, "total": total or 0}


async def get_change_detail(db, change_id: str):
    """单条 ChangeEvent + before/after 全文 + 行级 diff（供 Diff Viewer）。"""
    result = await db.execute(
        select(ChangeEvent, Source.name)
        .join(Source, ChangeEvent.source_id == Source.id)
        .where(ChangeEvent.id == change_id)
    )
    row = result.first()
    if not row:
        return None
    ce, sname = row

    before = after = ""
    title_before = title_after = ""
    old_version = new_version = None
    if ce.old_raw_document_id:
        old_doc = await db.get(RawDocument, ce.old_raw_document_id)
        if old_doc:
            before = old_doc.content or ""
            title_before = old_doc.title or ""
            old_version = old_doc.version
    if ce.new_raw_document_id:
        new_doc = await db.get(RawDocument, ce.new_raw_document_id)
        if new_doc:
            after = new_doc.content or ""
            title_after = new_doc.title or ""
            new_version = new_doc.version

    return {
        "id": ce.id,
        "source_id": ce.source_id,
        "source_name": sname,
        "normalized_url": ce.normalized_url,
        "old_version": ce.old_version or old_version,
        "new_version": ce.new_version or new_version,
        "change_type": ce.change_type or [],
        "severity": ce.severity,
        "diff_summary": ce.diff_summary,
        "detected_at": ce.detected_at.isoformat() if ce.detected_at else None,
        "title_before": title_before,
        "title_after": title_after,
        "content_hash": ce.content_hash,
        "before": before,
        "after": after,
        "changes": _opcodes_to_changes(before, after),
    }

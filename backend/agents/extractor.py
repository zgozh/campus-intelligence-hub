"""字段抽取（规则主链路）：时间/部门/截止日期（迁移自 school-knowledge-hub validity.py + extract.py）。"""
import re
from datetime import datetime, timedelta

DEADLINE_PATTERNS = [
    r"(?:报名)?截止(?:时间|日期)?[:：]?为?\s*(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})",
    r"截至\s*(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})",
    r"有效期至\s*(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})",
]

NOTICE_DEFAULT_DAYS = 90


def extract_deadline(title: str, content: str) -> str | None:
    """从标题+正文识别截止日期。"""
    text = title + " " + content
    for pattern in DEADLINE_PATTERNS:
        m = re.search(pattern, text)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


def infer_expiry(title: str, content: str, category: str, publish_date: str) -> str | None:
    """推断有效期截止日；无法推断且类别无默认值时返回 None。"""
    deadline = extract_deadline(title, content)
    if deadline:
        return deadline
    if category == "通知公告" and publish_date:
        try:
            pub = datetime.strptime(publish_date, "%Y-%m-%d")
            return (pub + timedelta(days=NOTICE_DEFAULT_DAYS)).strftime("%Y-%m-%d")
        except ValueError:
            return None
    return None


def extract_department(content: str) -> str | None:
    """从「来源：XXX」识别发布部门（排除作者/编辑等非部门字段）。"""
    m = re.search(r"来源[:：]\s*([^\s<&:：]{2,30})", content)
    if not m:
        return None
    val = m.group(1).strip()
    if val in ("作者", "编辑", "发布时间", "来源", "未知"):
        return None
    return val


def extract_date(text: str) -> str | None:
    """从文本提取首个 YYYY-MM-DD 日期。"""
    m = re.search(r"(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})", text)
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None

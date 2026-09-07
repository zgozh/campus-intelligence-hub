"""查询路由（D，RAG 增强）：轻量关键词级「意图 + 部门」识别。

不依赖 LLM（保证低延迟、可离线运行），用于：
1) 意图分类：办事流程 / 通知公告 / 规章制度 / 咨询 等，供检索加权与前端展示；
2) 部门识别：把查询里出现的高校部门名称抽出来，供检索时对该部门 KO 加权排序。

department 命中不强制过滤（防止漏召回），只做加权抬高；识别失败返回默认值。
"""
import re

# 常见校务/湾区高校部门（可扩充）
DEPARTMENT_KEYWORDS: dict[str, list[str]] = {
    "研究生院": ["研究生", "硕士", "博士", "保研", "推免", "学硕", "专硕", "研招"],
    "教务处": ["教务", "选课", "辅修", "双学位", "重修", "学分", "缓考", "转专业", "课表"],
    "学生处": ["奖助学金", "奖学金", "助学金", "评优", "奖学金", "困难认定", "辅导员"],
    "招生办": ["招生", "录取", "分数线", "提档", "志愿", "报考", "校考"],
    "财务处": ["学费", "缴费", "报销", "发票", "工资", "补贴", "一卡通充值"],
    "图书馆": ["借书", "还书", "馆藏", "座位", "电子资源", "数据库"],
    "国际交流合作": ["留学", "交换", "访学", "签证", "国际项目", "海外"],
    "就业指导": ["就业", "双选会", "招聘", "派遣", "三方协议", "报到证", "实习"],
    "后勤保障": ["宿舍", "报修", "食堂", "水电网", "门禁", "校车"],
    "党政办公室": ["党委", "校长", "通知", "放假", "校历", "公文"],
    "科研处": ["科研", "项目申报", "课题", "基金", "横向课题", "知识产权"],
    "信息化": ["校园网", "VPN", "统一认证", "邮箱", "一网通办", "正版化"],
}

# 意图 → 关键词
INTENT_KEYWORDS: dict[str, list[str]] = {
    "流程": ["怎么办", "流程", "如何办理", "手续", "申请", "材料", "步骤", "在哪办"],
    "通知": ["通知", "公告", "安排", "提醒", "时间", "截止"],
    "制度": ["规定", "办法", "制度", "细则", "条例", "政策", "办法"],
    "咨询": ["多少", "什么时候", "是什么", "谁", "哪", "吗"],
}

DEFAULT_INTENT = "咨询"
DEFAULT_DEPARTMENT = None


def _match(text: str, words: list[str]) -> bool:
    return any(w in text for w in words)


def route_query(query: str) -> dict:
    """返回 {intent, department}。intent 在 INTENT_KEYWORDS 中，department 为命中部门名或 None。"""
    q = query or ""
    intent = DEFAULT_INTENT
    for name, words in INTENT_KEYWORDS.items():
        if _match(q, words):
            intent = name
            break

    department = None
    for dept, words in DEPARTMENT_KEYWORDS.items():
        if _match(q, words):
            department = dept
            break

    return {"intent": intent, "department": department}

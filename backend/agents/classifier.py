"""一级分类 + 专题域打标（规则主链路，迁移自 school-knowledge-hub rules.py）。"""

CATEGORIES = ["通知公告", "办事指南", "规章制度", "新闻动态"]

RULE_KEYWORDS = {
    "通知公告": ["通知", "公告", "公示", "通告", "安排", "报名", "评选", "征集", "招标"],
    "办事指南": ["指南", "流程", "办事", "办理", "申请", "须知", "攻略", "指引"],
    "规章制度": ["规定", "办法", "制度", "条例", "细则", "章程", "规范", "守则"],
}

COLUMN_TO_CATEGORY = {
    "通知公告": "通知公告",
    "新闻动态": "新闻动态",
}

TOPICS = ["新生入学", "港澳生服务", "教务学籍", "后勤生活", "就业创业", "科研学术"]

TOPIC_KEYWORDS = {
    "新生入学": ["新生", "入学", "报到", "迎新", "军训"],
    "港澳生服务": ["港澳", "港澳台", "香港", "澳门"],
    "教务学籍": ["学籍", "选课", "转专业", "学分", "成绩", "考试", "教务"],
    "后勤生活": ["宿舍", "食堂", "校园卡", "后勤", "公寓", "卡务", "水电"],
    "就业创业": ["就业", "招聘", "创业", "简历", "实习"],
    "科研学术": ["科研", "学术", "实验室", "论文", "课题", "基金"],
}


def classify_category(title: str, column: str) -> str:
    """栏目映射优先；其次标题关键词；兜底新闻动态。"""
    if column in COLUMN_TO_CATEGORY:
        return COLUMN_TO_CATEGORY[column]
    for category, words in RULE_KEYWORDS.items():
        if any(w in title for w in words):
            return category
    return "新闻动态"


def rule_tag_topics(title: str, content: str) -> list[str]:
    """专题域规则打标：标题+正文关键词命中即标。"""
    text = title + " " + content
    return [topic for topic in TOPICS if any(w in text for w in TOPIC_KEYWORDS[topic])]

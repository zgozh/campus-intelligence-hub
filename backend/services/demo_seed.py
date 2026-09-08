"""演示数据种子（A2）：一键向知识库注入一批真实风格的校务知识，让全链路演示"看得见"。

幂等：按标题去重，已存在则跳过。可选向量入库（无 key 降级仅关键词检索）。
"""
import logging

from sqlalchemy import select

from models import KnowledgeObject

logger = logging.getLogger(__name__)

# 真实风格的校务知识（标题/类型/部门/摘要/关键信息/标签/来源）
DEMO_DOCS = [
    {
        "title": "广州大学 2026 届毕业生就业双选会安排",
        "type": "Event",
        "department": "就业指导中心",
        "summary": "2026 届毕业生就业双选会将于 2026-03-15 在大学城校区体育馆举行，面向全体应届毕业生，用人单位现场招聘。",
        "facts": [{"field": "举办时间", "value": "2026-03-15 09:00"}, {"field": "地点", "value": "大学城校区体育馆"}, {"field": "对象", "value": "2026 届毕业生"}],
        "tags": ["就业", "双选会", "毕业生"],
        "url": "https://job.gzhu.edu.cn/2026/0301/c12a24/a56789/page.htm",
    },
    {
        "title": "广州大学本科生转专业实施办法",
        "type": "Regulation",
        "department": "教务处",
        "summary": "本科生转专业每学年办理一次，学生需满足在校期间无违纪、无挂科等条件，申请时间为每学期第 2 周。",
        "facts": [{"field": "申请时间", "value": "每学期第 2 周"}, {"field": "申请条件", "value": "无违纪、无挂科"}, {"field": "办理频率", "value": "每学年一次"}],
        "tags": ["转专业", "教务", "本科生"],
        "url": "https://jwc.gzhu.edu.cn/2025/0901/c8a10/a12345/page.htm",
    },
    {
        "title": "广州大学图书馆借阅证使用说明",
        "type": "Procedure",
        "department": "图书馆",
        "summary": "在校生凭校园一卡通即可借书，本科生可借 10 册、研究生 20 册，借期 30 天，可续借 2 次。",
        "facts": [{"field": "借书上限", "value": "本科生 10 册 / 研究生 20 册"}, {"field": "借期", "value": "30 天"}, {"field": "续借", "value": "可续 2 次"}],
        "tags": ["图书馆", "借书", "一卡通"],
        "url": "https://lib.gzhu.edu.cn/2025/0801/a2b1/d23456/page.htm",
    },
    {
        "title": "广州大学学生宿舍热水供应时间",
        "type": "Announcement",
        "department": "后勤保障处",
        "summary": "学生宿舍热水供应时间为每日 06:30-08:30 与 18:00-23:30，冬季部分楼宇晚间延长至 24:00。",
        "facts": [{"field": "早上", "value": "06:30-08:30"}, {"field": "晚上", "value": "18:00-23:30"}, {"field": "冬季延长", "value": "24:00"}],
        "tags": ["宿舍", "热水", "后勤"],
        "url": "https://hq.gzhu.edu.cn/2025/0701/a3c5/e00123/page.htm",
    },
    {
        "title": "广州大学研究生奖助学金管理办法",
        "type": "Regulation",
        "department": "研究生院",
        "summary": "研究生奖助学金分为学业奖学金、助学金、助研津贴三类，评定按学年进行，覆盖全日制在籍研究生。",
        "facts": [{"field": "分类", "value": "学业奖学金/助学金/助研津贴"}, {"field": "评定周期", "value": "按学年"}, {"field": "对象", "value": "全日制在籍研究生"}],
        "tags": ["研究生", "奖助学金", "管理"],
        "url": "https://yjsy.gzhu.edu.cn/2025/0501/a5f7/b00123/page.htm",
    },
    {
        "title": "广州大学校园网与一网通办账号开通流程",
        "type": "Procedure",
        "department": "信息化中心",
        "summary": "新生入学后需自助开通校园网与一网通办账号，绑定学号与手机号，初始密码为身份证后六位。",
        "facts": [{"field": "开通方式", "value": "自助开通"}, {"field": "初始密码", "value": "身份证后六位"}, {"field": "对象", "value": "新生"}],
        "tags": ["校园网", "一网通办", "账号"],
        "url": "https://net.gzhu.edu.cn/2025/0901/a6b8/c00123/page.htm",
    },
    {
        "title": "广州大学期末考试缓考办理须知",
        "type": "Procedure",
        "department": "教务处",
        "summary": "因病或特殊原因无法参加期末考试的学生，须在考前 3 天提交缓考申请及证明材料，经审批后参加下学期补缓考。",
        "facts": [{"field": "申请时间", "value": "考前 3 天"}, {"field": "材料", "value": "缓考申请表+证明"}, {"field": "考试安排", "value": "下学期补缓考"}],
        "tags": ["缓考", "期末", "教务"],
        "url": "https://jwc.gzhu.edu.cn/2025/0601/c8a10/c00123/page.htm",
    },
    {
        "title": "广州大学学生国际交流项目申请指南",
        "type": "Announcement",
        "department": "国际交流与合作处",
        "summary": "每年 3 月、9 月开放国际交流项目申请，含交换生、短期访学，需提交语言成绩与在校证明。",
        "facts": [{"field": "申请时间", "value": "每年 3 月、9 月"}, {"field": "项目类型", "value": "交换生/短期访学"}, {"field": "材料", "value": "语言成绩+在校证明"}],
        "tags": ["国际交流", "交换生", "访学"],
        "url": "https://io.gzhu.edu.cn/2025/0201/a7d9/a00123/page.htm",
    },
    {
        "title": "广州大学科研项目申报工作安排",
        "type": "Announcement",
        "department": "科研处",
        "summary": "校内科研项目申报集中受理期为每年 4 月，教师可申报科研启动、横向课题等，需通过科研管理系统提交。",
        "facts": [{"field": "申报时间", "value": "每年 4 月"}, {"field": "申报平台", "value": "科研管理系统"}, {"field": "类型", "value": "科研启动/横向课题"}],
        "tags": ["科研", "项目申报", "课题"],
        "url": "https://ky.gzhu.edu.cn/2025/0301/a9e1/a00123/page.htm",
    },
    {
        "title": "广州大学学费缴纳方式说明",
        "type": "Procedure",
        "department": "财务处",
        "summary": "学费可通过线上缴费平台、银行代扣、现场缴费三种方式缴纳，请在每学期开学两周内完成。",
        "facts": [{"field": "方式", "value": "线上/代扣/现场"}, {"field": "缴完时间", "value": "开学两周内"}],
        "tags": ["学费", "缴费", "财务"],
        "url": "https://cw.gzhu.edu.cn/2025/0801/a1b2/a00123/page.htm",
    },
]


async def seed_demo(db) -> dict:
    """注入演示数据（按标题幂等）。返回 {created, skipped}。"""
    created = skipped = 0
    for doc in DEMO_DOCS:
        exists = await db.scalar(select(KnowledgeObject.id).where(KnowledgeObject.title == doc["title"]))
        if exists:
            skipped += 1
            continue
        ko = KnowledgeObject(
            type=doc["type"],
            title=doc["title"],
            department=doc["department"],
            summary=doc["summary"],
            facts=doc["facts"],
            tags=doc["tags"],
            confidence=0.85,
            status="PUBLISHED",
            version=1,
            source_url=doc["url"],
            authority=0.9,
            freshness_level="Fresh",
            source_version=1,
            last_verified_at=None,
        )
        db.add(ko)
        await db.flush()
        # 向量入库（失败降级）
        try:
            from agents.embedding import embed_texts
            from services.vector_service import ensure_collection, upsert_ko

            await ensure_collection()
            embs = await embed_texts([f"{ko.title} {ko.summary}"])
            if embs:
                await upsert_ko(ko.id, embs[0], {"title": ko.title, "type": ko.type})
        except Exception:  # noqa: BLE001
            logger.warning("种子向量入库失败（降级关键词检索）")
        created += 1
    await db.commit()
    logger.info("演示数据种子：created=%d skipped=%d", created, skipped)
    return {"created": created, "skipped": skipped}

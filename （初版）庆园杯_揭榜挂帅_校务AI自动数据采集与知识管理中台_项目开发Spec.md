# 庆园杯揭榜挂帅赛道 —— 面向校务管理的 AI 自动数据采集与知识管理中台 Spec

> **项目暂定名：Campus Intelligence Hub / 校务智汇中台 2.0**
>
> 目标：以现有 `zgozh/school-knowledge-hub` 为“现有成果/需求基线”，但**不要继续在旧项目上堆功能**；重新选取成熟、Docker-first、外部模型 API 驱动的 OSS 作为运行底座，再将现有项目中真正有价值的业务逻辑迁移/吸收，形成更容易部署、展示效果更强、自动采集能力更完整的新版校务知识中台。
>
> 比赛依据：揭榜挂帅赛道聚焦教育领域真实痛点，参赛团队需从 10 个定向主题中选 1 个；本项目选择其中的“③ 面向校务管理的 AI 自动数据采集与知识管理中台”，并要求完成解决方案开发和落地验证。fileciteturn1file6L391-L429

---

# 0. 先说结论：不要在原项目上无限缝

当前 `school-knowledge-hub` 已经有产品基础，但你提出的核心痛点是：

```text
本地部署麻烦
需要多个本地模型
环境复杂
换机器容易炸
```

新版的原则必须反过来：

```text
Docker
  ↓
数据库 / 缓存 / 向量库 / Web Collector / App
  ↓
外部 LLM / Embedding API
  ↓
开箱即用
```

也就是：

> **基础设施容器化，模型服务 API 化，数据采集自动化，知识资产结构化。**

原 Agent spec 已明确提出 Mock First：默认 `docker compose up` 应直接运行，不应该让用户预装一堆 Wazuh / Elastic / Kafka / Kubernetes / Ollama / Qdrant 等服务作为启动门槛。这个原则直接移植到本项目。fileciteturn2file1L23-L30

---

# 1. 产品重新定位

## 1.1 项目名称

中文：**校务智汇中台 2.0——AI 自动数据采集与校园知识运营平台**

英文：**Campus Intelligence Hub — AI-powered Institutional Data & Knowledge Platform**

## 1.2 一句话

> 自动从学校官网、院系网站、通知公告、政策文件、教务资料、公开页面和人工上传文件中持续采集校务信息，通过 AI 进行清洗、去重、分类、结构化、知识化和可追溯问答，最终形成“数据进入—知识形成—业务查询—知识反哺”的校园信息闭环。

## 1.3 不要把它做成普通 RAG

普通项目：

```text
上传 PDF
→ Embedding
→ RAG
→ Chat
```

本项目：

```text
Web / File / URL / API
        ↓
Automatic Collector
        ↓
Parser / OCR / Cleaner
        ↓
Dedup / Version Detection
        ↓
LLM Structuring
        ↓
Knowledge Objects
        ↓
Hybrid Search / Graph / RAG
        ↓
Campus QA / Search / Digest / Alerts
        ↓
Feedback
        ↓
Knowledge Quality Improvement
```

这是“数据采集 + 知识管理中台”，不是知识库聊天机器人。

---

# 2. 主 OSS 底座：Basjoo

GitHub：`https://github.com/haoyiyin/basjoo`

## 2.1 为什么选择它

当前仓库公开信息显示，Basjoo 已经具备：

- FastAPI 后端
- Next.js 14 管理后台
- React / TypeScript
- 多租户知识库
- Qdrant
- PostgreSQL
- Redis
- Scrapling 网页内容抓取微服务
- APScheduler
- SSE 流式聊天
- 管理后台
- Agent 配置
- URL 抓取/重抓
- Docker Compose
- 多 Provider 外部模型 API
- 无 GPU 要求

最关键的是，它明确说明 LLM / Embedding 走外部 API，不需要本地 GPU；Docker Compose 可以启动完整服务。citeturn283443search0turn103602search4

这和你的目标高度匹配：

```text
原有 school-knowledge-hub
     ↓
业务需求/校务场景保留

Basjoo
     ↓
Docker / FastAPI / Next.js / URL Collector / KB / Provider
     ↓
新版 Campus Intelligence Hub
```

## 2.2 为什么不是直接选 Dify / FastGPT

Dify 很成熟，但当前仓库使用的是基于 Apache 2.0 且带附加条件的 Dify Open Source License。citeturn732291search1turn732291search2

FastGPT 同样很强，支持文档、URL、混合检索、Workflow、Agent 等能力，并且 Docker 快速启动；但其 Open Source License 同样附加了特定限制，例如不能未经授权提供与 FastGPT 类似的多租户 SaaS，且不能移除/修改控制台版权信息，另外还涉及交互设计的外观专利声明。citeturn910657search0turn910657search2

本项目是比赛作品，为了降低 License / UI 强绑定风险，**默认不把它们作为直接代码底座**，只作为架构和交互参考。

---

# 3. A 级辅助底座：RAG-Knowledge-Base-Platform

GitHub：`https://github.com/loglux/RAG-Knowledge-Base-Platform`

它已经具备：

- 结构感知文档解析
- Qdrant
- 可选 OpenSearch BM25
- 混合检索
- citations
- retrieve-only API
- PDF 页码和 section metadata
- KB export/import
- FastAPI + React
- Docker-first

官方 README 明确支持 TXT/MD/FB2/DOCX/PDF，并通过 Docker Compose 启动 API、数据库、Qdrant、OpenSearch 和前端。citeturn103602search0turn103602search3

建议把它当作：

```text
“知识检索核心能力的参考实现”
```

尤其适合吸收：

```text
Section-aware retrieval
Hybrid retrieval
Citation
KB export/import
Retrieve-only API
```

---

# 4. A 级辅助底座：OptyxStack/rag-knowledge-base-chatbot

这个项目的匹配点非常高：

- FastAPI
- PostgreSQL
- Redis
- Celery
- OpenSearch
- Qdrant
- OpenAI 可插拔模型
- Playwright Web Crawler
- React 19 + Vite + Tailwind
- Docker Compose
- Dashboard
- Crawl 页面
- Documents 页面
- API Tokens

它已经把“知识库 + Web Crawl + 混合检索 + 后台管理”组合起来。citeturn283443search5turn103602search1

使用时必须先核验仓库 License；如果 License 不满足比赛作品使用边界，只借鉴架构，不直接复制受保护代码。

---

# 5. 现有 school-knowledge-hub 的处理原则

当前仓库本身没有在本对话的文件资料中暴露完整代码结构，因此本 Spec 不假装知道其现有内部实现。

**第一阶段必须让主 Agent 真实检查你自己的仓库：**

```text
https://github.com/zgozh/school-knowledge-hub
```

并产出：

```text
CURRENT_SYSTEM_AUDIT.md
```

必须回答：

```text
现在已经有什么？
哪些逻辑值得迁移？
哪些模型/服务导致部署困难？
哪些 UI 页面可以保留？
哪些功能与新底座重复？
哪些数据模型值得保留？
哪些功能应直接删除？
```

然后按下面决策：

### 保留

```text
校务业务语义
校园知识分类
现有演示数据
已经验证可用的业务规则
```

### 重构

```text
模型调用
知识库底层
Web 采集
部署
前端 Dashboard
```

### 删除

```text
本地模型硬依赖
过度复杂的本地服务
无法一键 Docker 启动的组件
无人使用的实验功能
```

---

# 6. 核心业务：自动数据采集

这是整个比赛作品与普通知识库的最大区别。

## 6.1 数据源

第一版只做 5 类：

```text
① 学校官网 URL
② 院系网站 URL
③ 通知公告列表页
④ 人工上传文件
⑤ 单个 URL
```

第二版再考虑：

```text
RSS
JSON API
微信公众号公开页面
邮箱附件
```

禁止第一版就写 20 种 crawler。

## 6.2 Source

数据源模型：

```text
Source
- id
- name
- source_type
- base_url
- crawl_frequency
- status
- last_crawled_at
- last_success_at
- last_error
```

支持：

```text
manual
website
list_page
file
api
```

## 6.3 Collector Job

```text
Source
 ↓
Collector Job
 ↓
Fetch
 ↓
Normalize
 ↓
Extract
 ↓
Diff
 ↓
Index
```

状态：

```text
PENDING
RUNNING
SUCCESS
FAILED
PARTIAL
```

---

# 7. 自动采集不是“爬下来就结束”

每条内容需要经历：

```text
Raw Page
   ↓
Content Cleaning
   ↓
Main Content Extraction
   ↓
Title / Date / Department extraction
   ↓
Document fingerprint
   ↓
Duplicate detection
   ↓
Version comparison
   ↓
AI Classification
   ↓
Knowledge Object
```

## 7.1 指纹

最小实现：

```text
normalized_url
content_hash
canonical_title
publish_time
```

这样可以判断：

```text
同一网页
内容没变
```

则：

```text
不重复入库
```

如果：

```text
标题相同
正文 hash 不同
```

则：

```text
创建新版本
```

---

# 8. 知识不是 Chunk，而是 Knowledge Object

这是新版最重要的原创模块。

## 8.1 Knowledge Object

类型至少：

```text
Announcement
Policy
Course
Department
Contact
Event
Procedure
FAQ
Regulation
Research
```

统一模型：

```json
{
  "id": "uuid",
  "type": "announcement",
  "title": "关于2026级新生报到的通知",
  "department": "学生处",
  "effective_from": "2026-09-01",
  "effective_to": null,
  "entities": [],
  "facts": [],
  "source_document_id": "uuid",
  "source_url": "https://...",
  "version": 2,
  "confidence": 0.93,
  "status": "active"
}
```

## 8.2 为什么这样设计

因为校务信息不是纯文本：

```text
通知
政策
地点
部门
联系人
时间
流程
条件
```

都可以变成结构化对象。

最终实现：

```text
Document
  ↓
Knowledge Object
  ↓
Relations
  ↓
RAG / Search / Dashboard / Alert
```

---

# 9. 知识生命周期

必须实现：

```text
采集
 ↓
解析
 ↓
审核
 ↓
发布
 ↓
过期
 ↓
归档
```

状态：

```text
DISCOVERED
PROCESSING
REVIEW_REQUIRED
PUBLISHED
UPDATED
EXPIRED
ARCHIVED
```

这样比赛时可以展示：

> “AI 不是把内容扔进向量数据库，而是在维护一个持续变化的校园知识资产库。”

---

# 10. AI 自动知识整理

Agent 不需要很多。

建议 5 个逻辑 Agent：

## Agent 1 — Classifier

判断：

```text
公告
政策
课程
活动
联系方式
办事流程
其他
```

## Agent 2 — Extractor

提取：

```text
时间
地点
部门
人员
截止日期
要求
联系方式
```

## Agent 3 — Dedup / Version Analyst

判断：

```text
是不是重复
是不是新版本
哪些字段发生变化
```

## Agent 4 — Knowledge Curator

把文章变成：

```text
Knowledge Object
+ tags
+ relations
+ summary
```

## Agent 5 — QA Agent

回答前检查：

```text
引用是否存在
知识是否过期
多个来源是否冲突
```

---

# 11. Campus Search：不要只做 Chat

首页不能只有一个 Chat 框。

必须有三个入口：

```text
搜索知识
查看最新信息
向 AI 提问
```

## 11.1 搜索

支持：

```text
关键词
语义搜索
部门过滤
类型过滤
时间过滤
```

## 11.2 AI 问答

例如：

> “本科生申请缓考需要哪些材料？目前执行的是哪个版本？”

系统应该回答：

```text
结论
↓
当前适用版本
↓
依据 1
依据 2
↓
更新时间
↓
来源部门
```

如果冲突：

```text
⚠ 检测到两份文件信息不一致
```

而不是强行生成唯一答案。

---

# 12. 校务“知识雷达”——比赛的加分原创功能

建议加入一个非常容易演示的页面：

**Knowledge Radar**

展示：

```text
今日新增 18
今日更新 7
待审核 4
即将过期 9
来源异常 2
冲突知识 3
```

同时展示：

```text
学生处 ── 23
教务处 ── 31
科研处 ── 17
保卫处 ── 8
各学院 ── 62
```

这一下从“知识库”变成“知识运营中台”。

---

# 13. 自动日报 / 周报

定时生成：

```text
校园 AI Knowledge Digest
```

内容：

```text
过去24小时新增通知
变化最大的政策
即将截止事项
最近更新部门
知识库异常
```

支持：

```text
Markdown
PDF
网页
```

这对演示很有价值，因为能体现“自动采集”确实在持续运行。

---

# 14. 冲突检测

做一个轻量但很有含金量的功能：

例如：

```text
文档 A：报名截止 9 月 10 日
文档 B：报名截止 9 月 15 日
```

AI 标记：

```text
⚠ Potential Conflict
```

给管理员：

```text
[查看来源]
[确认最新]
[标记已解决]
```

这是校务知识管理明显区别于普通 RAG 的功能之一。

---

# 15. 前端：绝对不要从零生成

## 15.1 直接以 Basjoo 前端为主

当前 Basjoo 已有 Next.js 14 / React 18 管理后台、登录、聊天、KB 和 widget 结构。citeturn283443search3turn103602search5

建议直接复用：

```text
Layout
Sidebar
Header
Auth
Tables
Settings
Chat
Knowledge UI
```

然后改业务名词。

## 15.2 新版页面

```text
Dashboard
Sources
Collection Jobs
Knowledge Base
Knowledge Objects
Review Queue
Knowledge Radar
Ask AI
Digests
System Settings
```

---

# 16. Dashboard 页面

布局：

```text
┌──────────────────────────────────────────────────┐
│ Campus Intelligence Hub                          │
├───────────────┬──────────────────────────────────┤
│ Sources       │ 今日知识运行概览                 │
│ Jobs          │                                  │
│ Knowledge     │ +18 new   ↑7 updated            │
│ Review        │ 4 review  ⚠3 conflicts           │
│ Radar         │                                  │
│ Ask AI        │ [Knowledge Trend Chart]          │
│ Digests       │                                  │
└───────────────┴──────────────────────────────────┘
```

不要做成“学生项目 Admin 后台”。

视觉参考：

```text
Linear
Notion
Vercel
现代 SaaS Admin
```

但页面代码仍然基于 OSS 现有组件体系进行修改，避免 Vibe Coding 从零生成一套低质量 UI。

---

# 17. Sources 页面

允许管理员：

```text
添加官网
添加学院站点
添加 URL
上传目录
```

每个 Source：

```text
名称
类型
状态
上次运行
内容数
成功率
```

按钮：

```text
Run Now
Edit
Pause
View Logs
```

---

# 18. Collection Job 页面

这是“自动数据采集”核心演示页面。

显示：

```text
Job #1028

Fetch      ✓
Parse      ✓
Clean      ✓
Classify   ✓
Dedup      ✓
Index      ✓
```

失败时：

```text
Fetch ✓
Parse ✓
LLM ✕ timeout
```

然后允许：

```text
Retry
```

---

# 19. Knowledge Object 页面

查看：

```text
Title
Type
Department
Effective Date
Version
Confidence
Source
Last Updated
```

并能查看：

```text
Original Document
Extracted Facts
Relations
Versions
Citation
```

---

# 20. Review Queue

对于低置信度或冲突知识：

```text
AI Confidence < 0.75
OR
Detected Conflict
```

自动进入人工审核队列。

审核页面：

```text
左：原文
中：AI Extracted Object
右：AI Reasoning / Evidence

[Approve]
[Reject]
[Edit]
```

这是非常适合比赛展示 Human-in-the-loop 的页面。

---

# 21. Provider Adapter

统一配置：

```env
LLM_PROVIDER=openai-compatible
LLM_API_KEY=xxxx
LLM_BASE_URL=https://...
LLM_MODEL=...
EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_API_KEY=xxxx
EMBEDDING_BASE_URL=https://...
EMBEDDING_MODEL=...
```

允许：

```text
OpenAI-compatible
DeepSeek
通义 / SiliconFlow / OpenRouter 等兼容接口
Mock
```

核心原则：

> 不允许业务代码直接写死 OpenAI SDK。

统一：

```text
Provider
 ↓
LLMAdapter
 ↓
Business Service
```

---

# 22. Zero-LLM 模式

必须实现：

```env
LLM_PROVIDER=mock
```

启动：

```bash
docker compose -f docker-compose.demo.yml up -d
```

即可：

```text
打开 Dashboard
看到示例 Sources
模拟采集任务
查看 Knowledge Object
查看 Radar
查看 Review Queue
进行预置问答
```

这样就算：

```text
比赛现场断网
模型 API 限流
Key 过期
```

也可以完成至少 70% 的视觉演示。

---

# 23. Docker-first 架构

## 23.1 期望服务

严格控制：

```text
app / backend
frontend
postgres
redis
qdrant
scrapling / crawler
nginx（可选）
```

不允许：

```text
❌ Ollama
❌ 本地大模型
❌ CUDA
❌ 本地 Whisper
❌ Kafka
❌ Kubernetes
❌ Elastic 全家桶
```

除非后续版本明确开启 optional profile。

## 23.2 启动方式

目标：

```bash
git clone https://github.com/zgozh/campus-intelligence-hub
cd campus-intelligence-hub
cp .env.example .env
# 填写模型 API Key
docker compose up -d --build
```

然后：

```text
http://localhost:3000
```

一个命令完成环境。

---

# 24. 数据库设计

核心实体：

```text
User
Role
Source
CollectionJob
RawDocument
DocumentVersion
KnowledgeObject
KnowledgeRelation
KnowledgeTag
ReviewTask
Conflict
Conversation
AnswerCitation
Digest
AuditLog
ModelUsage
```

### Source

```text
id
name
type
url
schedule
status
last_run_at
```

### RawDocument

```text
id
source_id
url
title
content_hash
publish_time
fetched_at
storage_path
```

### KnowledgeObject

```text
id
raw_document_id
type
title
structured_data
confidence
status
version
valid_from
valid_to
```

### Conflict

```text
id
object_a
object_b
field
value_a
value_b
confidence
status
resolved_by
```

---

# 25. 检索架构

推荐：

```text
Hybrid Search
├── Dense Vector
└── BM25
        ↓
Rerank
        ↓
Citation
        ↓
Answer
```

但第一版允许：

```text
Qdrant Dense Search
```

第二版再加 OpenSearch。

因为目标是先跑通，而不是为了“显得企业级”增加 10 个容器。

原 Agent spec 同样强调 YAGNI、最小实现和每个阶段真实验收。fileciteturn2file3L51-L59

---

# 26. 自动化工作流

### 每小时/每天

```text
Scheduler
 ↓
Source Discovery
 ↓
Crawler
 ↓
Raw Document
 ↓
Diff
 ↓
AI Classification
 ↓
Knowledge Update
 ↓
Vector Index
 ↓
Conflict Scan
 ↓
Digest
```

### 用户查询

```text
Question
 ↓
Intent Detection
 ↓
Filter
 ↓
Hybrid Retrieve
 ↓
Freshness Check
 ↓
Conflict Check
 ↓
Answer
 ↓
Citation
```

---

# 27. Freshness / 过期知识机制

这是非常值得做的原创点。

例如：

```text
政策有效期 2026-01-01 ~ 2026-12-31
```

到了新版本：

```text
OLD → EXPIRED
NEW → ACTIVE
```

问答系统默认：

```text
优先 ACTIVE
```

如果用户问历史：

```text
允许切换到历史版本
```

这样就不会出现典型的“RAG 找到旧 PDF 但不知道它已经失效”。

---

# 28. 自动摘要与知识传播

对于重要通知：

```text
原文
 ↓
AI Summary
 ↓
Student Version
Staff Version
Manager Version
```

例如同一个通知：

```text
学生视角：我需要做什么？
老师视角：我要通知哪些学生？
管理者视角：这项通知影响哪些部门？
```

这是一个很容易被评委理解的“知识重构”功能。

---

# 29. 重要业务场景

只选 3 个做深：

## 场景 A — 教务通知

```text
采集官网通知
→ 自动分类
→ 提取报名时间/对象/材料
→ 形成 Knowledge Object
→ AI 回答
```

## 场景 B — 学生办事

```text
“我想办理缓考，需要什么？”
→ 检索政策
→ 判断当前版本
→ 给出步骤
→ 引用来源
```

## 场景 C — 校务管理

```text
“最近一周哪些部门发布了重要通知？”
→ 自动统计
→ Knowledge Radar
→ 自动生成摘要
```

这三个场景足够支撑比赛视频。

---

# 30. Golden Demo

建议比赛演示完整路径：

```text
1. 打开 Campus Intelligence Hub
2. 打开 Sources
3. 点击“学校官网”
4. 点击 Run Now
5. Collection Job 开始运行
6. 展示抓取 → 清洗 → 分类 → 去重 → 入库
7. 打开 Knowledge Objects
8. 点进某条最新通知
9. 查看 AI 提取出的时间/部门/截止日期
10. 打开 Knowledge Radar
11. 输入“XX事项怎么办？”
12. AI 给出步骤 + 当前版本 + 引用
13. 再演示一份冲突文档
14. 系统标记 Conflict
15. 打开 Review Queue
16. 人工 Approve
17. 回到 Ask AI
18. 展示答案已经更新
```

整段目标：**3–5 分钟**。

---

# 31. EPIC 开发顺序

## EPIC 0 — Current System Audit + OSS Recon

主 Agent 必须先检查：

```text
school-knowledge-hub
Basjoo
RAG-Knowledge-Base-Platform
Optyx
```

输出：

```text
CURRENT_SYSTEM_AUDIT.md
OSS_REUSE.md
ARCHITECTURE.md
ADR-001.md
ADR-002.md
TASKS.md
```

## EPIC 1 — Basjoo 原版启动

目标：

```text
docker compose --profile dev up -d
```

浏览器打开，原项目完整运行。

## EPIC 2 — Campus Shell

改：

```text
Brand
Sidebar
Dashboard
Terminology
```

## EPIC 3 — Source Domain

实现：

```text
Source
CollectionJob
```

## EPIC 4 — Auto Collector

实现：

```text
Website
URL
List page
```

## EPIC 5 — Document Pipeline

实现：

```text
Fetch
Parse
Normalize
Fingerprint
Version
```

## EPIC 6 — Knowledge Object

实现：

```text
Classifier
Extractor
Curator
```

## EPIC 7 — Freshness / Conflict

实现：

```text
Version
Expiry
Conflict
```

## EPIC 8 — Search + Ask AI

实现：

```text
Hybrid / semantic retrieval
Citation
Freshness-aware answer
```

## EPIC 9 — Review Queue

实现：

```text
Low confidence
Conflict review
Approve / Reject / Edit
```

## EPIC 10 — Knowledge Radar

实现：

```text
New
Updated
Expired
Conflict
Department activity
```

## EPIC 11 — Digest

实现：

```text
Daily / Weekly
Markdown / PDF
```

## EPIC 12 — Demo / Evaluation / Final Integration

必须按真实路径验证：

```text
clone
→ env
→ docker
→ source
→ crawl
→ knowledge
→ review
→ ask ai
→ digest
```

原 Agent spec 的原则是“每个 EPIC 能跑、能演示、再 commit、再进入下一步”，这里完全沿用。fileciteturn2file4L163-L173

---

# 32. 测试策略

## Unit

至少测试：

```text
fingerprint
version compare
expiry
classifier
conflict detector
```

## Integration

```text
crawler → DB
crawler → knowledge
knowledge → vector
query → citation
review → update
```

## E2E

只写 5 条黄金路径：

```text
create source
run crawl
create knowledge
ask question
resolve conflict
```

## Demo Test

必须有：

```text
RESET_DEMO
SEED_DEMO
```

每次演示前可恢复干净数据。

---

# 33. 模型成本与路由

不要所有任务都使用高价模型。

推荐：

```text
简单分类         → fast model
字段抽取         → fast model
摘要             → fast model
冲突分析         → strong model
复杂问答         → strong model
```

可记录：

```text
model
input_tokens
output_tokens
latency
estimated_cost
```

做一个轻量 `Model Usage` 页面即可。

这沿用原企业 Agent spec 的“Cost-aware Dynamic Model Routing”理念。fileciteturn1file1L141-L151

---

# 34. 最终目录建议

```text
campus-intelligence-hub/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── collectors/
│   │   ├── ingestion/
│   │   ├── knowledge/
│   │   ├── search/
│   │   ├── agents/
│   │   ├── conflicts/
│   │   ├── review/
│   │   └── providers/
│   └── tests/
├── frontend/
│   ├── app/
│   ├── components/
│   ├── views/
│   └── hooks/
├── collector/
├── worker/
├── evaluation/
├── demo-data/
├── docs/
│   ├── architecture/
│   ├── adr/
│   └── demo/
├── OSS_REUSE.md
├── CURRENT_SYSTEM_AUDIT.md
├── AGENTS.md
├── ARCHITECTURE.md
├── TASKS.md
├── DECISIONS.md
├── docker-compose.yml
├── docker-compose.demo.yml
├── .env.example
└── README.md
```

---

# 35. 必须砍掉的东西

```text
❌ 本地 LLM
❌ Ollama 必装
❌ 本地 GPU
❌ 本地 Whisper
❌ 自研 OCR
❌ 复杂知识图谱算法
❌ Kafka
❌ Kubernetes
❌ 10+ crawler 类型
❌ 10+ Agent
❌ 多租户 SaaS
❌ 计费系统
```

第一版只追求：

```text
自动采集
+ 自动结构化
+ 知识生命周期
+ 引用问答
+ 冲突检测
+ 人工审核
+ Knowledge Radar
```

这已经足够形成一个很完整的比赛作品。

---

# 36. 申报书 / 简历最终话术

## 项目标题

**校务智汇中台——面向校务管理的 AI 自动数据采集与知识管理平台**

## 推荐描述

> 面向高校校务信息分散、更新频繁和知识失效难感知的问题，构建 AI 自动数据采集与知识管理中台。基于 Docker-first 的开源 AI 应用底座，重构 Web/文件/URL 多源采集、内容去重、版本检测、AI 分类与结构化抽取、知识对象管理、时效性控制、冲突检测和人工审核流程；通过混合检索与引用式生成提供面向学生、教师和管理人员的可信问答，并使用 Knowledge Radar 与自动 Digest 对校园知识资产进行持续运营。

## 技术亮点

```text
FastAPI
Next.js
PostgreSQL
Redis
Qdrant
Web Collector
External LLM API
RAG
Knowledge Object
Versioning
Conflict Detection
Human-in-the-loop
Docker Compose
```

## 不要写

> “做了一个校园知识库，支持 RAG 问答。”

## 要写

> “构建面向高校校务场景的数据采集—知识化—审核—检索—问答—更新闭环，将传统静态知识库升级为持续运行的校园知识运营中台。”

---

# 37. OSS 合规与原创边界

赛事规则明确要求参赛作品原创、团队拥有完整合法知识产权，并明确禁止抄袭、盗用等行为；涉及第三方知识产权时，需提前获得合法授权。fileciteturn1file7L471-L489

因此本项目不能变成：

```text
Basjoo
↓
改 Logo
↓
改几个文案
↓
比赛
```

必须形成原创业务增量：

```text
Campus Source System
Collection Pipeline
Knowledge Object Model
Freshness Engine
Conflict Engine
Review Queue
Knowledge Radar
Campus Digest
```

同时维护：

```text
OSS_REUSE.md
```

内容：

```text
Repository
URL
License
Commit
Reused files
Modified files
Removed files
Original modules
Attribution
```

原 Agent spec 也明确要求 OSS_REUSE.md、保留原 License/NOTICE、记录修改和复用边界。fileciteturn1file9L632-L647

---

# 38. 最终成功标准

## P0 必须有

```text
✅ Docker 一键启动
✅ 不需要本地模型
✅ 支持云端模型 API
✅ Mock 模式
✅ 官网/URL 自动采集
✅ 文件导入
✅ AI 自动分类
✅ AI 字段抽取
✅ 去重
✅ 版本管理
✅ 引用问答
✅ 过期知识处理
✅ 冲突检测
✅ Review Queue
✅ Knowledge Radar
```

## P1 建议完成

```text
✅ 自动日报/周报
✅ 混合检索
✅ Model Usage
✅ SSE 实时采集日志
✅ Playwright E2E
✅ Demo Reset
```

## P2 有时间再做

```text
△ 微信公众号公开信息采集
△ 邮件自动采集
△ MCP
△ Knowledge Graph 可视化
△ 多学校配置
```

---

# 39. 给主 Agent 的最终指令

```text
你不是重新生成 school-knowledge-hub。

目标是构建 Campus Intelligence Hub 2.0。

先做两件事：
1. 真实审计当前 zgozh/school-knowledge-hub
2. 真实审计 haoyiyin/basjoo

然后确定：
- 哪些旧业务逻辑迁移
- 哪些直接删除
- 哪些 Basjoo 能力直接保留
- 哪些新能力必须原创

实现策略：
- 直接以 Basjoo 的前后端与 Docker 为底座
- 不从空白生成整套前端
- 保留成熟 Auth / Layout / KB / URL / Chat / Provider / Docker
- 把 customer support 语义重构为 campus knowledge operations
- 增加 Source / CollectionJob / KnowledgeObject / Conflict / ReviewTask / Digest / Radar
- 让自动数据采集成为产品主流程，不是一个工具按钮
- 所有模型调用走 Provider Adapter
- 默认外部 API
- 不要求 Ollama、GPU、本地模型
- 必须支持 Mock Mode
- 每个 EPIC 必须 docker compose 真实验收
- 不能因为“看起来企业级”而引入 10 个不必要服务
- 不得复制没有 License 依据的代码

最终目标：
“一个能真正自动采集学校公开信息、自动形成知识、识别版本与冲突、支持可信问答并可持续运营的校园 AI 知识中台”。
```

# 第二届“庆园杯”人工智能创新应用大赛
# 揭榜挂帅：面向校务管理的 AI 自动数据采集与知识管理中台
# 项目开发 Spec v4.0
# 项目名称：Campus Intelligence Hub 2.0
# 中文定位：从“知识库”升级为“会自己维护知识的校务信息中台”
# 编码：UTF-8

> 本 Spec 默认你已有 `zgozh/campus-intelligence-hub` 原型。
> 本次目标不是另起炉灶，而是：**先把现有原型完整吸收，再最大化复用成熟 OSS 的采集、RAG、管理后台、模型适配、调度能力，把产品升级为真正符合揭榜题目“自动数据采集 + 知识管理中台”的完整闭环。**
>
> Gitee SSH 地址：`git@gitee.com:zgozh/campus-intelligence-hub.git`
> 由于比赛环境、开发机器可能对 Gitee SSH 有访问限制，EPIC 0 必须由本地开发环境直接 clone 并锁定现有 commit；本 Spec 不假装掌握没有实际读取到的代码细节。

---

# 0. 赛题与首届经验

第二届揭榜挂帅明确包含：

> **③ 面向校务管理的 AI 自动数据采集与知识管理中台**

官方要求是围绕选定主题完成解决方案开发与落地验证，并提交作品申报书、演示视频及相关佐证材料。fileciteturn1file6L377-L429

第一届则证明：普通 Web、RAG 并不会因为技术简单而自动失去奖项；真正的问题是是否解决真实场景。一等奖《灵眸智译》具备明确用户对象、硬件/CV 技术、量化识别效果和可演示闭环；其他获奖作品也大量体现教育、环保、芯片、安全等真实问题。citeturn949293search0turn949293search1

因此这个赛题不能做成：

```text
网址采集
→ 切 chunk
→ 向量库
→ 一个聊天框
```

因为这只是“RAG 知识库”。

真正应该做的是：

```text
校务数据源
↓
自动发现
↓
自动采集
↓
清洗
↓
结构化
↓
版本比对
↓
变化检测
↓
知识对象化
↓
时效/可信度判断
↓
冲突检测
↓
人工审核
↓
知识发布
↓
AI 问答 / 校务助手 / 数据洞察
```

---

# 1. 最终项目定位

## 1.1 一句话

> **Campus Intelligence Hub 2.0 是面向高校校务信息的“自动采集—知识治理—变化监测—证据问答—业务提醒”中台。**

## 1.2 与普通知识库的区别

普通：

```text
管理员上传资料
↓
知识库
↓
问答
```

Campus Intelligence Hub 2.0：

```text
学校网站 / 部门页面 / 文件 / 通知
↓
Source Registry
↓
Crawler
↓
Change Detection
↓
Knowledge Object
↓
Freshness / Conflict / Quality
↓
Human Review
↓
Published Knowledge
↓
AI Search / Q&A / Digest / Alert
```

关键词：

```text
自动维护
```

这才真正契合“自动数据采集与知识管理中台”。

---

# 2. 从你已有原型升级，而不是推倒重来

## 2.1 EPIC 0 第一件事

本地执行：

```bash
git clone git@gitee.com:zgozh/campus-intelligence-hub.git
cd campus-intelligence-hub
git rev-parse HEAD
```

然后：

```text
读取全部 README
Docker
.env
Frontend
Backend
Database
Crawler
RAG
```

建立：

```text
EXISTING_SYSTEM_AUDIT.md
```

记录：

```text
已有功能
已有页面
已有接口
已有数据库
已有采集能力
已有模型适配
已有问题
```

## 2.2 核心原则

如果你的原型已经有：

```text
登录
Dashboard
Source
Knowledge
Chat
```

这些全部优先保留。

不要为了“架构看起来高级”而重写。

---

# 3. OSS 主底座：Basjoo

GitHub：

```text
https://github.com/haoyiyin/basjoo
```

它当前已经提供：

```text
FastAPI
Next.js
URL ingestion
File knowledge management
Web scraping
Qdrant
PostgreSQL
Redis
SSE
Scheduling
Multi-provider LLM
RBAC
Admin Dashboard
Embeddable widget
```

并且明确采用外部 API 进行 LLM/Embedding 调用，不要求本地 GPU；官方 README 提供 Docker Compose 部署路径。citeturn817122search0

这非常符合你的硬要求：

```text
换 env
↓
docker compose up
```

## 3.1 可直接复用

优先复用：

```text
URL ingestion
File ingestion
Scrapling
Crawler
Qdrant
Provider layer
Admin UI components
SSE
Scheduling
```

## 3.2 不直接照搬

不要保留：

```text
Customer Support
Agent Widget
```

业务层全部转换为：

```text
Campus Knowledge
```

---

# 4. OSS 第二底座：Caddy / i-dot-ai/caddy

GitHub 搜索结果显示该项目定位是 RAG 平台，包含：

```text
FastAPI model service
scraper
frontend collection/resource/user management UI
Qdrant
Postgres
MinIO
```

并通过 Docker 运行。citeturn486759search6

主要参考：

```text
Collection
Resource
Scraper
Knowledge Management UI
```

如果许可证允许复用，再按实际 commit 决定直接拿组件还是只参考。

---

# 5. OSS 第三参考：SentiWiki AI

GitHub：

```text
https://github.com/andresruizc/sentiwiki-ai
```

它已经形成：

```text
Next.js
FastAPI
LangGraph
Qdrant
Crawl4AI
Docker
Prometheus
Grafana
```

以及一个完整五阶段 Web 内容知识管道：

```text
Scraping
Enhancement
Chunking
Embedding
Indexing
```

还提供 Agentic Intelligence 层。citeturn817122search3

这里重点借鉴：

```text
采集 → 清洗 → 结构化 → 索引 → 检索
```

不需要整仓嵌入。

---

# 6. OSS 第四参考：Open Notebook

`lfnovo/open-notebook` 已提供多种来源接入、Docker Compose、RAG、notes、chat、transformations、podcast 等能力。citeturn464734search8

主要借鉴：

```text
Source
Notebook
Notes
Transformation
```

用来设计：

```text
校务专题
```

---

# 7. OSS 第五参考：rag-demo

`jszhanglab/rag-demo` 提供：

```text
Next.js
FastAPI
PostgreSQL
Chroma
OCR
PDF parsing
Citation
Document status
```

并强调证据引用。citeturn486759search4

借鉴：

```text
PDF → OCR → Citation
```

---

# 8. 最终产品模块

```text
Campus Intelligence Hub
│
├── Source Center
├── Collection Center
├── Knowledge Center
├── Change Radar
├── Review Center
├── Trust Center
├── AI Assistant
├── Insight Center
└── System Settings
```

---

# 9. Source Center

管理：

```text
学校官网
部门官网
通知公告栏目
专题页面
PDF目录
Excel/CSV
手工上传文件
```

每个 Source：

```text
名称
URL
部门
分类
抓取频率
最后成功时间
状态
内容数量
```

---

# 10. 自动采集中心

显示：

```text
Collection Job #182

Source:
教务处通知

Started:
10:21:03

Pages discovered: 42
Changed: 6
New: 2
Removed: 1
Failed: 0
```

这比“一个 loading”更有平台感。

---

# 11. 自动发现

输入：

```text
https://www.gzhu.edu.cn
```

系统自动发现：

```text
通知公告
教务处
科研院
学生处
人事处
财务处
研究生院
```

但生产环境必须支持：

```text
Allowed Domains
```

禁止无限爬取。

---

# 12. Change Radar——全项目最重要的新能力

当网站发生变化：

```text
Old
“2026 年研究生奖助学金管理办法”

New
“2026 年研究生奖助学金管理办法（修订版）”
```

系统识别：

```text
TITLE changed
CONTENT changed
DATE changed
ATTACHMENT changed
```

显示：

```text
⚠ 重要知识发生变化
```

---

# 13. Diff Viewer

必须做一个非常漂亮的：

```text
Before              After
────────────────────────────────
申报截止：9月20日    申报截止：9月25日

申请对象：全日制       申请对象：全日制研究生
```

高亮变化。

这将成为比赛 Demo 的一个视觉亮点。

---

# 14. Knowledge Object

不要把知识只存成 chunk。

建立：

```text
KnowledgeObject
```

例：

```json
{
  "title": "研究生奖助学金申请办法",
  "department": "研究生院",
  "effective_date": "2026-09-01",
  "status": "ACTIVE",
  "source": "url",
  "source_url": "...",
  "version": 3,
  "confidence": 0.98,
  "last_verified_at": "..."
}
```

---

# 15. Freshness

每一条知识都有：

```text
Fresh
Aging
Stale
Unknown
```

颜色只用于语义，不要搞彩虹 dashboard。

规则：

```text
last_verified_at
+ expected_update_frequency
```

计算 Freshness Score。

---

# 16. Conflict Detection

如果：

```text
部门 A：报名截止 9/20
部门 B：报名截止 9/25
```

系统不能直接选择一个。

必须进入：

```text
Conflict Queue
```

显示：

```text
发现 2 条互相冲突的信息

Source A
Source B
```

然后人工确认：

```text
Use A
Use B
Merge
Ignore
```

这是非常适合答辩的“AI 治理”亮点。

---

# 17. Knowledge Governance

建立生命周期：

```text
DISCOVERED
↓
PARSED
↓
PENDING_REVIEW
↓
APPROVED
↓
PUBLISHED
↓
STALE
↓
ARCHIVED
```

---

# 18. Review Center

待审核队列：

```text
新增知识       12
重大变更        3
冲突            2
低可信          5
```

点击一条：

```text
AI Summary
Source
Diff
Evidence
Recommended Action
```

审批：

```text
Approve
Reject
Edit
```

---

# 19. AI 问答升级

不能只做：

```text
Question → Answer
```

应该返回：

```text
Answer
├── Source
├── Effective Date
├── Freshness
├── Confidence
└── Related Documents
```

例如：

```text
2026 年研究生奖学金申请截止时间为 9 月 25 日。

来源：研究生院通知
发布时间：2026-09-01
状态：ACTIVE
```

---

# 20. Answer Guard

如果检索结果不足：

```text
当前知识库没有足够依据确认该问题。
```

禁止模型编造。

---

# 21. Source-aware Retrieval

检索必须考虑：

```text
Semantic similarity
Keyword
Department
Effective date
Status
Freshness
```

最终：

```text
score = semantic
      + lexical
      + authority
      + freshness
      + recency
```

不要只做 cosine similarity。

---

# 22. Authority Score

不同来源定义：

```text
校级官网        1.0
部门官网        0.95
正式通知 PDF    0.95
学院网站        0.85
历史页面        0.60
用户上传        0.70
```

数值必须作为配置，不要硬编码业务判断。

---

# 23. 自动摘要

每天生成：

```text
Campus Intelligence Daily Digest
```

内容：

```text
新增知识 18
发生变化 7
重要通知 3
冲突 2
待审核 9
```

然后：

```text
Top 5 Important Changes
```

---

# 24. Change Radar 首页

首页不要突出 Chat。

第一屏突出：

```text
TODAY

18 New
7 Changed
2 Conflicts
9 Pending Review
```

下方：

```text
Knowledge Health
```

---

# 25. Knowledge Health

指标：

```text
Coverage
Freshness
Citation Rate
Conflict Rate
Review Backlog
Source Health
```

建立一个：

```text
Campus Knowledge Health Score
```

公式公开。

---

# 26. 管理员看到的不是“模型”，而是“知识生命周期”

这是产品定位关键。

后台重点：

```text
Sources
Changes
Knowledge
Conflicts
Review
```

模型配置放 Settings。

---

# 27. “会自己维护知识”才是差异化

系统每天自动：

```text
发现
→ 抓取
→ 对比
→ 解析
→ 标记
→ 等待审核
```

人不需要每天人工上传。

---

# 28. AI Agent 是否需要

需要，但只能做轻量任务 Agent：

```text
Collection Agent
Knowledge Agent
Answer Agent
```

不要：

```text
10+ agent
Supervisor
Agent debate
```

## Collection Agent

```text
Source
→ Determine fetch
→ Trigger crawler
→ Parse
→ Diff
```

## Knowledge Agent

```text
Changed document
→ Extract Knowledge Objects
→ Detect conflicts
→ Draft review
```

## Answer Agent

```text
Question
→ Retrieve
→ Rank
→ Answer
→ Cite
```

这已经足够体现 Agent 闭环。

---

# 29. MCP

不是为了“加分”而强行 MCP。

只做确实有价值的工具：

```text
mcp://campus/search
mcp://campus/source
mcp://campus/knowledge
mcp://campus/changes
mcp://campus/review
```

以后学校其他 AI 应用可以统一调用这些能力。

这才是“中台”价值。

---

# 30. 对外 API

```text
GET /api/knowledge/search
GET /api/knowledge/:id
GET /api/sources
GET /api/changes
GET /api/conflicts
GET /api/digest
POST /api/chat
POST /api/review/:id/approve
```

---

# 31. Database

核心实体：

```text
User
Role
Department
Source
SourceVersion
CollectionJob
Document
DocumentVersion
KnowledgeObject
KnowledgeVersion
Evidence
ChangeEvent
Conflict
ReviewTask
ChatSession
ChatMessage
ModelUsage
```

---

# 32. SourceVersion

这是自动采集真正需要的实体。

```text
source_id
version_no
content_hash
fetched_at
published_at
content
metadata
```

通过：

```text
content_hash
```

快速判断是否变化。

---

# 33. ChangeEvent

```json
{
  "source_id": "s01",
  "old_version": 4,
  "new_version": 5,
  "change_type": "CONTENT_CHANGED",
  "severity": "HIGH",
  "diff_summary": "deadline changed",
  "requires_review": true
}
```

---

# 34. 抓取安全

必须：

```text
Allowed Domain
Robots policy
Rate Limit
Max Depth
Max Pages
Timeout
Content Type filter
File Size limit
```

不能因为“AI 采集”把爬虫变成无限制抓取器。

---

# 35. Prompt Injection 防护

校园网页可能出现恶意文本：

```text
忽略之前所有规则……
```

采集后的网页内容只能作为：

```text
DATA
```

绝不能作为：

```text
INSTRUCTION
```

这是信息安全背景非常好的答辩亮点。

---

# 36. 数据安全

必须：

```text
API Key 加密
RBAC
Audit Log
Source Access Control
```

个人敏感信息默认不入公共知识库。

---

# 37. 模型策略

所有模型走：

```text
Provider Interface
```

支持：

```text
OpenAI-compatible
DeepSeek
Gemini
智谱
火山
```

只改：

```env
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
EMBEDDING_BASE_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=
```

不要本地模型。

---

# 38. Docker

目标：

```bash
cp .env.example .env
docker compose up --build
```

服务尽量控制到：

```text
web
api
worker
postgres
redis
qdrant
scraper
nginx
```

如果现有原型或 Basjoo 某组件已经能合并，不重复新增。

---

# 39. Zero-API Demo

没有 Key：

```text
Demo Sources
Demo Changes
Demo Knowledge
Demo Conflict
Demo Review
Demo Q&A
```

全部可以展示。

---

# 40. Golden Demo

准备真实但允许使用的公开校园资料。

例如：

```text
招生通知
奖助学金通知
考试通知
科研申报通知
校园活动通知
```

Demo 流程：

```text
添加一个官网 Source
↓
立即采集
↓
发现 20+ 页面
↓
解析
↓
生成 Knowledge Objects
↓
Knowledge Health
```

然后故意准备一份更新版本：

```text
截止时间：9/20
→
9/25
```

系统检测：

```text
HIGH PRIORITY CHANGE
```

打开 Diff。

然后问：

> “现在截止时间是什么？”

系统回答：

```text
9 月 25 日

来源：XXX 通知
发布时间：XXX
版本：v2
```

这就是整个项目最重要的 Demo。

---

# 41. 为什么这个 Demo 比“知识库聊天”高级

因为评委会看到：

```text
网站
 ↓
自动采集
 ↓
知识变化
 ↓
结构化
 ↓
人工审核
 ↓
AI 使用最新知识
```

真正形成：

> **知识运营闭环。**

---

# 42. 部门视角

选择：

```text
研究生院
```

可以查看：

```text
我的来源
我的变更
我的知识
我的审核
我的日报
```

未来可复制到：

```text
教务处
学生处
科研院
人事处
财务处
```

这非常符合“中台”。

---

# 43. 校领导驾驶舱

第二级用户：

```text
学校管理人员
```

只看：

```text
Knowledge Health
Critical Changes
Risk
Departments
```

例如：

```text
校务知识健康度：92

本周重大变化：14
冲突：3
待审核：27
陈旧知识：8%
```

---

# 44. 不要做成大而全 OA

不要：

```text
审批
请假
财务
人事
教务
资产
```

这是知识中台，不是 OA。

---

# 45. 不要做成普通 ChatBot

Chat 是最后一个模块：

```text
Knowledge
Changes
Governance
```

排在：

```text
Chat
```

之前。

---

# 46. 前端底座策略

优先顺序：

```text
已有 campus-intelligence-hub UI
↓
Basjoo UI
↓
Caddy UI
↓
自己写
```

只有前三者都没有合适页面才从零实现。

这样符合“能缝就缝”的要求。

---

# 47. 前端页面

```text
/overview
/sources
/collections
/changes
/knowledge
/conflicts
/reviews
/assistant
/digest
/settings
```

---

# 48. 最强页面：Change Radar

页面中心：

```text
WHAT CHANGED?
```

列表：

```text
研究生院   HIGH   12 min ago
教务处     MEDIUM 1h ago
学生处     HIGH   2h ago
```

点击进入 Diff。

---

# 49. 最强页面：Knowledge Object

展示：

```text
Title
Department
Status
Effective Date
Version
Freshness
Confidence
Source
Evidence
```

右边：

```text
Who changed it?
When?
Why?
```

---

# 50. 最强页面：Source Health

```text
Source Health

✓ 正常          42
⚠ 延迟           3
✕ 失败           1
```

点击：

```text
last success
last change
success rate
```

---

# 51. 观测与日志

保留：

```text
crawl latency
parse latency
LLM latency
tokens
errors
```

但不要用复杂可观测平台把部署搞得很重。

比赛版只需：

```text
Job Log
Audit Log
Model Usage
```

---

# 52. 评测体系

建立：

```text
Source Detection
Change Detection
Knowledge Extraction
Citation Accuracy
Answer Grounding
```

Benchmark：

```text
50 source pages
20 modified pages
100 QA
```

全部用真实测试结果。

---

# 53. 关键可量化指标

最终申报书只写真实测得的数据：

```text
采集成功率
变更检测准确率
知识抽取准确率
引用准确率
问题回答 Grounded Rate
人工审核耗时下降
```

千万不要为了“看起来厉害”直接写未经测量的 99%。

---

# 54. 与第一届获奖项目的差异化

第一届已有：

```text
知识库
RAG
网络攻防助手
教学平台
推文生成
```

我们的差异：

```text
自动采集
+
自动变化检测
+
知识生命周期
+
冲突治理
+
Freshness
+
Evidence
+
中台 API
```

重点从：

```text
Answer
```

升级到：

```text
Knowledge Operations
```

---

# 55. 与现实学校 AI 建设方向的匹配

广州大学 AI 应用与资源中心当前公开信息已经显示学校正在把 AI 与网上服务、校务服务、教学科研等业务结合，并持续推动 AI 赋能校园业务。citeturn231102search5

因此本作品的申报书要讲：

```text
不是“再造一个聊天机器人”

而是补充学校 AI 能力底座：

让学校已有公开/授权信息
自动成为可维护的 AI-ready knowledge assets。
```

---

# 56. MCP 中台价值

以后其他学校 AI 应用：

```text
招生助手
科研助手
校务客服
教师助手
```

都不需要自己重新爬官网。

统一调用：

```text
Campus Knowledge MCP
```

例如：

```text
search_policy()
get_notice()
get_latest_version()
get_department()
get_changes()
```

这会让“中台”两个字站得住。

---

# 57. 三类输出

```text
Knowledge
→ 给 AI 使用

Alert
→ 给管理人员

Digest
→ 给领导 / 部门
```

这比一个 Chat 页面完整得多。

---

# 58. AI 自动日报

每天：

```text
校园知识日报

今日新增 21 条
重要变更 7 条
冲突 2 条
待审核 11 条
```

并自动总结：

```text
最重要变化：
研究生奖助学金政策发生截止时间调整。
```

同时附来源。

---

# 59. Agent 闭环

轻量 Agent 最终形成：

```text
Detect
 ↓
Collect
 ↓
Understand
 ↓
Compare
 ↓
Classify
 ↓
Review
 ↓
Publish
 ↓
Answer
```

这是本项目需要向评委展示的 Agent 闭环。

---

# 60. EPIC 0：现有原型审计

必须第一步做：

```text
git clone campus-intelligence-hub
```

然后输出：

```text
EXISTING_SYSTEM_AUDIT.md
```

标记：

```text
KEEP
REUSE
REFACTOR
DELETE
MISSING
```

---

# 61. EPIC 1：把当前原型稳定下来

目标：

```text
docker compose up
```

成功。

先不增加功能。

---

# 62. EPIC 2：Source Registry

完成：

```text
Source
Department
Schedule
Allowed Domain
```

---

# 63. EPIC 3：Crawler / Ingestion

实现：

```text
URL
PDF
DOCX
HTML
```

---

# 64. EPIC 4：Source Version

建立：

```text
content_hash
version
fetched_at
```

---

# 65. EPIC 5：Change Radar

实现：

```text
diff
change classification
severity
```

---

# 66. EPIC 6：Knowledge Object

实现：

```text
knowledge object
version
status
freshness
confidence
```

---

# 67. EPIC 7：Conflict Engine

实现：

```text
conflict detection
review queue
```

---

# 68. EPIC 8：Governance

实现：

```text
approve
reject
edit
publish
archive
```

---

# 69. EPIC 9：AI Assistant

实现：

```text
RAG
citation
freshness
source
```

---

# 70. EPIC 10：Digest / Radar

实现：

```text
Daily Digest
Knowledge Health
Department View
```

---

# 71. EPIC 11：MCP / API

实现：

```text
search
latest
changes
source
knowledge
```

---

# 72. EPIC 12：Final Integration

最终 Golden Path：

```text
Add Source
↓
Auto Crawl
↓
Extract
↓
New Knowledge
↓
Change
↓
Diff
↓
Review
↓
Publish
↓
Ask AI
↓
Correct Citation
```

---

# 73. 模型使用规则

不要：

```text
每个页面调用不同模型
```

统一：

```text
LLM
Embedding
Vision optional
```

配置：

```env
LLM_PROVIDER=
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
EMBEDDING_PROVIDER=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=
```

---

# 74. 不允许本地模型成为启动前提

禁止：

```text
Ollama
vLLM
CUDA
HuggingFace first-run download
```

如确需 local embedding：

```text
必须有 API fallback
```

否则不允许进入 P0。

---

# 75. Fallback

```text
Live crawler fails
→ cached source

LLM fails
→ deterministic template

Embedding API fails
→ keyword retrieval

TTS fails
→ text
```

---

# 76. 现场 Demo 必须固定

固定：

```text
5 Sources
20 Documents
3 Changes
1 Conflict
```

然后现场可以：

```text
点击一次“Refresh”
```

再真实跑一次变更检测。

---

# 77. 最强比赛演示：故意制造一次变更

准备一个测试站点/静态页面。

初始：

```text
报名截止：9/20
```

刷新为：

```text
报名截止：9/25
```

点击：

```text
Collect Now
```

几秒后：

```text
HIGH PRIORITY CHANGE
```

打开：

```text
Diff
```

再问：

```text
现在截止日期？
```

回答：

```text
9/25
```

引用：

```text
Source
Version 2
```

这条线要做到 100% 稳定。

---

# 78. 5 分钟答辩

### 0:00–0:30

问题：

> 学校知识不是没有，而是“散、变、旧、难以持续维护”。

### 0:30–1:10

添加 Source。

### 1:10–1:40

自动采集。

### 1:40–2:20

Knowledge Objects。

### 2:20–3:00

制造变更。

### 3:00–3:30

Change Radar + Diff。

### 3:30–4:00

Conflict。

### 4:00–4:30

AI 问答 + Citation + Freshness。

### 4:30–5:00

展示中台架构：

```text
Source
↓
Knowledge
↓
Governance
↓
AI
↓
MCP/API
```

---

# 79. 评委问：和 RAG 有什么区别？

回答：

> RAG 解决“已有资料怎么查”，我们的中台解决“学校资料怎么持续被发现、更新、验证和供多个 AI 应用使用”。RAG 是其中一个能力，Knowledge Operations 才是整个系统。

---

# 80. 评委问：为什么一定要 AI？

回答：

```text
传统采集：
网页 → 文本

AI 中台：
网页
→ 语义理解
→ 知识对象
→ 变更语义
→ 冲突理解
→ 自然语言问答
```

AI 不是装饰，而是把非结构化校园信息转成可管理知识资产。

---

# 81. 评委问：会不会胡编？

回答：

```text
Answer
必须绑定 Evidence

没有证据
→ 不回答

冲突
→ 进入 Review

过期
→ 显示 Freshness
```

---

# 82. 评委问：为什么用开源？

回答：

> 开源项目承担通用基础设施和重复劳动，我们自主设计校务 Knowledge Object、变化检测、知识生命周期、冲突治理、知识健康度、中台 API/MCP 和校务业务流程，从而把基础设施复用转化为完整的校务知识运营产品。

---

# 83. 评委问：能不能落地学校？

回答：

```text
先接公开官网
↓
再接授权部门网站
↓
再接文件库
↓
再接校内 AI 应用
```

而不是要求一下子打通学校所有核心业务系统。

---

# 84. 前端视觉原则

必须做到：

```text
Enterprise
Clean
Information-dense
Evidence-first
```

重点页面：

```text
Change Radar
Diff Viewer
Knowledge Object
Source Health
```

不要：

```text
大量无意义图表
紫色渐变
AI 卡片墙
```

---

# 85. 工程化原则

沿用原 Agent Spec 的纪律：

```text
最小实现
每步 commit
每个 EPIC 验收
Docker First
Mock First
OSS First
```

原 Spec 已明确要求每个阶段真实 `docker compose up` 验收，不允许只靠单测或口头说“完成”。fileciteturn2file3L51-L59

---

# 86. Agent 编排

```text
Architect
 ├── Existing Prototype Audit
 ├── Backend
 ├── Crawler
 ├── Knowledge
 ├── Frontend
 ├── AI
 ├── MCP
 ├── QA
 └── Docker
```

Frontend Agent 不得重写 Backend。

Crawler Agent 不得重写 RAG。

---

# 87. 目录建议

```text
campus-intelligence-hub/
├── apps/
│   ├── web/
│   └── api/
├── services/
│   ├── crawler/
│   ├── parser/
│   ├── knowledge/
│   ├── retrieval/
│   ├── change-detection/
│   └── digest/
├── domain/
│   ├── sources/
│   ├── documents/
│   ├── knowledge/
│   ├── conflicts/
│   └── reviews/
├── mcp/
├── tests/
├── demo/
├── docs/
├── AGENTS.md
├── ARCHITECTURE.md
├── EXISTING_SYSTEM_AUDIT.md
├── OSS_REUSE.md
├── ASSET_LICENSES.md
├── DECISIONS.md
├── TASKS.md
├── .env.example
└── docker-compose.yml
```

如现有原型目录不同，优先迁移最少量，不机械追求树状目录一致。

---

# 88. 最终产品层级

```text
Layer 1
Data Acquisition

Layer 2
Knowledge Engineering

Layer 3
Knowledge Governance

Layer 4
AI Access

Layer 5
Campus AI Ecosystem
```

这比：

```text
Frontend
Backend
LLM
Vector DB
```

更适合申报书。

---

# 89. 一等奖竞争目标

不能保证一等奖，但目标必须从“能跑”升级到：

```text
需求价值        ★★★★★
技术深度        ★★★★★
中台完整性      ★★★★★
自动化          ★★★★★
可量化          ★★★★★
现场演示        ★★★★★
落地扩展        ★★★★★
```

最重要的三件事：

```text
自动采集
自动发现变化
让 AI 永远优先使用“最新且有证据”的知识
```

---

# 90. 主 Agent 第一条指令

```text
阅读本 Spec。

不要直接开发新功能。

第一阶段只执行 EPIC 0。

第一步：
clone git@gitee.com:zgozh/campus-intelligence-hub.git

第二步：
锁定 commit。

第三步：
完整启动现有系统。

第四步：
输出 EXISTING_SYSTEM_AUDIT.md：
KEEP / REUSE / REFACTOR / DELETE / MISSING。

第五步：
分析以下 OSS：
- haoyiyin/basjoo
- i-dot-ai/caddy
- andresruizc/sentiwiki-ai
- lfnovo/open-notebook
- jszhanglab/rag-demo

第六步：
输出：
- OSS_REUSE.md
- ARCHITECTURE.md
- DECISIONS.md
- TASKS.md

强制原则：
1. 原型能留就留；
2. 成熟前端能缝就缝；
3. 成熟 crawler 能缝就缝；
4. 外部 API 优先；
5. Docker 一键运行；
6. 不允许 Ollama / GPU 成为启动前提；
7. 不增加没有比赛价值的企业级复杂基础设施；
8. 不把项目退化成普通 RAG ChatBot；
9. EPIC 0 完成后停止。
```

---

# 91. 最终一句话

> **Campus Intelligence Hub 2.0 不是“学校知识库”，而是“会持续发现、整理、验证和更新校园知识的 AI 中台”。**

它真正要解决的不是“AI 怎么回答问题”，而是：

> **“学校的信息每天都在变，谁负责发现变化、确认变化、更新知识、让所有 AI 用到最新版本？”**

这才是本赛题最值得拿去冲奖的核心问题。

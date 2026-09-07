# 部署与演示指南（Campus Intelligence Hub 2.0）

> 校务智汇中台 — 面向校务管理的 AI 自动数据采集与知识管理中台
> （自动采集 → 变化检测 → 知识治理 → 证据问答 → 中台 API/MCP 的完整闭环）

## 一、快速启动（一条命令）

```bash
git clone <repo> campus-intelligence-hub
cd campus-intelligence-hub
cp .env.example .env        # 填 DASHSCOPE_API_KEY（阿里云百炼，可选）
docker compose up -d --build
# 打开 http://localhost:3000
```

- 首次启动构建 3 个镜像（backend / frontend / scrapling），拉取 postgres / qdrant / redis，约 5–10 分钟
- 无本地模型、无 GPU、无 Ollama、无 Kafka、无 K8s
- 不填 API key 也能启动：LLM 自动降级 Mock

## 二、Mock / Demo 模式（断网也能演示 70%）

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build
```

- 自动播种 18 篇六大专题域演示知识对象（新生入学 / 港澳生服务 / 教务学籍 / 后勤生活 / 就业创业 / 科研学术）
- `LLM_PROVIDER=mock`，无模型 API key 时问答/分类/摘要走确定性 Mock
- 演示数据管理：
  - 播种：`docker exec campus-backend python3 -m scripts.seed_demo`
  - 播种变更：`docker exec campus-backend python3 -m scripts.seed_change`（制造 9/20→9/25 HIGH 变更）
  - 清空：`docker exec campus-backend python3 -m scripts.reset_demo`

## 三、Golden Demo 演示路径（3–5 分钟）

1. 打开 `http://localhost:3000`，登录管理后台
2. **数据源管理** → 新增「广州大学通知公告」（URL `https://www.gzhu.edu.cn/z__l/tzgg.htm`）
3. **采集任务** → 点击「采集」→ 弹窗选档位/栏目 → 查看 Job 六阶段流转（Fetch→Parse→Clean→Classify→Dedup→Index）
4. **知识对象** → 查看结构化知识（类型/有效期/部门/事实字段）；操作列支持 **编辑 / 发布 / 归档**
5. **变更雷达** → WHAT CHANGED? 列表（部门/级别/时间）→ 点「查看 Diff」→ **Before/After 行级高亮**
6. **知识雷达** → 运营统计；首页 Dashboard 第一屏 = **TODAY 统计 + 校务知识健康度**（公式公开）
7. **审核队列** → Approve / Reject / 编辑 → 知识状态流转（PUBLISHED ↔ REVIEW_REQUIRED ↔ ARCHIVED）
8. **AI 问答** → 提问 → 融合检索答案 + **Evidence citation**（Freshness/权威度/置信度/有效期/版本）；无依据自动拒答（Answer Guard）
9. **日报周报** → 自动汇总；可经**对外 API / MCP** 被其它 AI 应用调用

## 四、配置说明（.env.example）

| 变量 | 必填 | 说明 |
|------|------|------|
| `DASHSCOPE_API_KEY` | ⬜ | 阿里云百炼 API Key（LLM qwen + Embedding + Rerank）；不填自动 Mock |
| `DEEPSEEK_API_KEY` | ⬜ | DeepSeek 备援（可选） |
| `JINA_API_KEY` | ⬜ | Jina Embedding（Basjoo 原版遗留，后续切 DashScope） |
| `SECRET_KEY` | ⬜ | JWT 密钥（不填自动生成持久化） |

## 五、对外 API / MCP（中台能力，供校内 AI 应用统一调用）

**对外 REST API**（`/api` 前缀，只读公开、写需登录）：
```
GET  /api/knowledge/search?q=&department=&freshness=&limit=
GET  /api/knowledge/{id}
GET  /api/sources        GET  /api/changes        GET  /api/conflicts
GET  /api/digest
POST /api/chat
POST /api/review/{id}/approve|reject    # 需登录
```

**Campus Knowledge MCP**（`POST /api/mcp`，MCP JSON-RPC 2.0 over HTTP）：
- `initialize` / `tools/list` / `tools/call`
- 工具：`campus_search`（融合评分）/ `campus_source` / `campus_knowledge` / `campus_changes` / `campus_review`

示例：`curl -X POST http://localhost:8000/api/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"campus_search","arguments":{"query":"奖学金"}}}'`

## 六、验收状态（2026-09 实测）

- ✅ Docker 一键启动（6 容器全 healthy）；前端 25 页面编译通过
- ✅ 真实采集：gzhu 通知公告真实抓取入库（title/日期/正文正确）
- ✅ 文档管道：Fingerprint + 版本去重 + 版本管理（内容不变跳过，标题同正文异→新版本）
- ✅ **变更检测**：ChangeEvent（TITLE/CONTENT/DATE_CHANGED + HIGH/MEDIUM/LOW）+ Change Radar + Diff Viewer（行级高亮）
- ✅ 知识对象化：自动分类 + 专题域 + 字段抽取 + 有效期 + **权威度/新鲜度**
- ✅ **Freshness 分级**：Fresh/Aging/Stale/Unknown + 过期自动 EXPIRED
- ✅ **知识治理**：approve/reject/edit/publish/archive 全链路生命周期
- ✅ **融合检索**：semantic+lexical+authority+freshness+recency 加权评分
- ✅ **Answer Guard**：无知识依据直接拒答，不编造；Evidence citation（freshness/authority/confidence）
- ✅ **Knowledge Health**：健康度评分（公式公开）+ TODAY 统计 + 首页仪表
- ✅ Conflict / Review / Radar / Digest / 日报周报
- ✅ **对外 API**（/api/*）+ **Campus Knowledge MCP**（/api/mcp，JSON-RPC）
- ✅ 全站冒烟：前端 12 页面 200、后端全部端点非 500、组件-API 绑定无遗漏
- ✅ Mock 模式：SEED_DEMO / SEED_CHANGE / RESET_DEMO / docker-compose.demo.yml

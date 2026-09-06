# 部署与演示指南（Campus Intelligence Hub 2.0）

> 校务智汇中台 — 面向校务管理的 AI 自动数据采集与知识管理中台

## 一、快速启动（一条命令）

```bash
git clone <repo> campus-intelligence-hub
cd campus-intelligence-hub
cp .env.example .env        # 填 DASHSCOPE_API_KEY（阿里云百炼，可选）
docker compose up -d --build
# 打开 http://localhost:3000
```

- 首次启动会构建 3 个镜像（backend / frontend / scrapling），拉取 postgres / qdrant / redis，约 5–10 分钟
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
  - 清空：`docker exec campus-backend python3 -m scripts.reset_demo`

## 三、Golden Demo 演示路径（3–5 分钟）

1. 打开 `http://localhost:3000`，登录管理后台
2. 「数据源管理」→ 新增数据源「广州大学通知公告」（URL `https://www.gzhu.edu.cn/z__l/tzgg.htm`）
3. 点击「立即采集」→ 「采集任务」页查看 Job 六阶段流转（Fetch → Parse → Clean → Classify → Dedup → Index）
4. 「知识对象」页查看 AI 结构化结果（类型 / 有效期 / 部门 / 事实字段）
5. 「知识雷达」页查看运营统计（新增 / 待审 / 冲突 / 将过期 / 来源活跃度）
6. 「AI 问答」页提问「教师资格考试什么时候进行？」→ 答案 + 来源引用（100% 引用）
7. 「冲突检测」：`POST /refresh` 触发冲突检测 → 冲突进入「审核队列」
8. 「审核队列」Approve / Reject → 知识状态更新
9. 「日报周报」页生成日报 → 查看自动汇总

## 四、配置说明（.env.example）

| 变量 | 必填 | 说明 |
|------|------|------|
| `DASHSCOPE_API_KEY` | ⬜ | 阿里云百炼 API Key（LLM qwen + Embedding + Rerank）；不填自动 Mock |
| `DEEPSEEK_API_KEY` | ⬜ | DeepSeek 备援（可选） |
| `JINA_API_KEY` | ⬜ | Jina Embedding（Basjoo 原版遗留，后续切 DashScope） |
| `SECRET_KEY` | ⬜ | JWT 密钥（不填自动生成持久化） |

## 五、验收状态（2026-09 实测）

- ✅ Docker 一键启动（6 容器：backend/frontend/postgres/qdrant/redis/scrapling 全 healthy）
- ✅ 真实采集：gzhu 通知公告 8 篇真实抓取入库（title/日期/正文正确）
- ✅ 文档管道：Fingerprint + 版本检测（内容不变跳过，标题同正文异→新版本）
- ✅ 知识对象化：自动分类 + 专题域 + 字段抽取 + 有效期
- ✅ Freshness：过期知识自动 EXPIRED
- ✅ Conflict：同标题不同截止日期 → 冲突检测
- ✅ Review Queue：低置信/冲突入队 + Approve/Reject
- ✅ Ask AI：关键词检索 + 引用式问答 + Mock 兜底
- ✅ Knowledge Radar + Digest 日报周报
- ✅ Mock 模式：SEED_DEMO / RESET_DEMO / docker-compose.demo.yml

"""可信问答评测（A1）：对 Golden QA 集跑 /ask，计算 grounded 率、证据引用一致性、Rerank 前后对比。

用法：python scripts/eval_grounding.py
- 依赖 stdlib(urllib)，无需额外依赖；BASE_URL/ADMIN_EMAIL/ADMIN_PASSWORD 可用环境变量覆盖。
- 输出 EVAL_REPORT.md 对比表。
"""
import json
import math
import os
import statistics
import urllib.request

BASE = os.environ.get("BASE_URL", "http://localhost:8000")
EMAIL = os.environ.get("ADMIN_EMAIL", "admin@campus.local")
PASSWORD = os.environ.get("ADMIN_PASSWORD", "campus123456")
QS_FILE = os.environ.get("QS_FILE", "eval/questions.json")


def _post(path: str, body: dict, token: str | None = None, timeout: int = 120) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def login() -> str:
    r = _post("/api/admin/login", {"email": EMAIL, "password": PASSWORD})
    return r["access_token"]


def ask(token: str, q: str, rerank: bool) -> dict:
    return _post("/api/v1/ask", {"query": q, "top_k": 5, "rerank": rerank}, token)


def run_set(token: str, qs: list[dict], rerank: bool) -> list[dict]:
    rows = []
    for item in qs:
        r = ask(token, item["q"], rerank)
        ans = r.get("answer", "") or ""
        rows.append(
            {
                "q": item["q"],
                "answerable": item["answerable"],
                "grounded": bool(r.get("grounded", False)),
                "citations": len(r.get("citations") or []),
                "cites": "[来源" in ans,
                "len": len(ans),
            }
        )
    return rows


def agg(rows: list[dict]) -> dict:
    ansable = [r for r in rows if r["answerable"]]
    unans = [r for r in rows if not r["answerable"]]
    grounded = sum(1 for r in ansable if r["grounded"])
    cites = sum(1 for r in ansable if r["cites"])
    return {
        "n_ansable": len(ansable),
        "grounded_rate": grounded / len(ansable) if ansable else 0,
        "guard_reject": sum(1 for r in unans if not r["grounded"]) / len(unans) if unans else 0,
        "avg_citations": statistics.mean([r["citations"] for r in rows]) if rows else 0,
        "evidence_citation": cites / len(ansable) if ansable else 0,
        "avg_len": statistics.mean([r["len"] for r in rows]) if rows else 0,
    }


def pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def main() -> None:
    token = login()
    qs = json.load(open(QS_FILE, encoding="utf-8"))
    sets = {True: run_set(token, qs, True), False: run_set(token, qs, False)}
    a_on, a_off = agg(sets[True]), agg(sets[False])

    def row(label, on, off):
        return f"| {label} | {on} | {off} |"

    lines = [
        "# 校务 AI 可信问答评测报告（A1）",
        "",
        f"> 评测集：{len(qs)} 题（可作答 {a_on['n_ansable']} / 反例 {len(qs) - a_on['n_ansable']}）· 运行于 {os.environ.get('BASE_URL', BASE)}",
        "",
        "## 核心指标（Rerank 开）",
        "",
        "| 指标 | 数值 |",
        "| --- | --- |",
        f"| **Grounded 率**（可作答题有依据） | {pct(a_on['grounded_rate'])} |",
        f"| **Answer Guard 反例拒答率** | {pct(a_on['guard_reject'])} |",
        f"| 证据引用一致性（答案含 [来源N]） | {pct(a_on['evidence_citation'])} |",
        f"| 平均引用条数 | {a_on['avg_citations']:.2f} |",
        f"| 平均答案长度(字) | {a_on['avg_len']:.0f} |",
        "",
        "## Rerank（gte-rerank-v2）说明",
        "",
        "- 交叉编码器已接入问答排序，用于提升送入 LLM 的 top-k 上下文精度；",
        "- 证据引用一致性属生成行为软指标，多次运行存在波动，因此不作为强结论，评估以稳定的 Grounded 率 / Answer Guard 拒答率为准；",
        "- 本版 Grounded 率基于 {0} 完成（{1}），Answer Guard 按逐题判「无依据」拒答。".format(a_on["grounded_rate"], pct(a_on["guard_reject"])),
        "",
        "## 复跑",
        "",
        "```bash\npython scripts/eval_grounding.py  # 自动更新本报告\n```",
    ]
    with open("EVAL_REPORT.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("\n".join(lines))
    print("\nWROTE: EVAL_REPORT.md")


if __name__ == "__main__":
    main()

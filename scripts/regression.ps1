# 回归自检脚本（复用成熟 OSS：pytest / vitest）+ 评测
# 用法：pwsh scripts/regression.ps1
$ErrorActionPreference = "Continue"

Write-Host "==> 1. 后端语法检查"
python -m py_compile backend/services/*.py backend/api/v1/*.py backend/agents/*.py 2>&1 | Select-Object -First 5
Write-Host "    [done]"

Write-Host "==> 2. 前端单元测试 (vitest)"
Push-Location frontend-nextjs
npx vitest run
Pop-Location

Write-Host "==> 3. 可信问答评测（30 问，约 5-10 分钟；可选，加 -SkipEval 跳过）"
if ($args -notcontains "-SkipEval") {
  python scripts/eval_grounding.py
} else {
  Write-Host "    已跳过评测（-SkipEval）"
}

Write-Host "==> 回归完成。"

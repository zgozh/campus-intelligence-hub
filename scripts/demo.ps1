# 一键演示脚本（A2/B1）：启动 → 种子 → 图谱 → 洞察 → 闭环 → 评测
# 用法：pwsh scripts/demo.ps1
$ErrorActionPreference = "Stop"
$base = "http://localhost:8000"

Write-Host "==> 1. 启动后端 + 前端"
docker compose up -d --build backend frontend | Out-Null

Write-Host "==> 2. 等待服务就绪"
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  try { $h = Invoke-RestMethod "$base/health" -TimeoutSec 5; if ($h.status -eq "healthy") { $ok = $true; break } } catch { Start-Sleep 2 }
}
if (-not $ok) { Write-Error "后端未就绪，终止"; exit 1 }

Write-Host "==> 3. 登录"
$login = Invoke-RestMethod -Uri "$base/api/admin/login" -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes('{"email":"admin@campus.local","password":"campus123456"}')) -ContentType "application/json"
$headers = @{ Authorization = "Bearer $($login.access_token)" }

Write-Host "==> 4. 导入演示数据（幂等）"
$seed = Invoke-RestMethod -Uri "$base/api/v1/demo/seed" -Method Post -Headers $headers -TimeoutSec 120
Write-Host "    演示数据：新增 $($seed.created) / 跳过 $($seed.skipped)"

Write-Host "==> 5. 构建知识图谱（增量）"
$kg = Invoke-RestMethod -Uri "$base/api/v1/knowledge-graph/build?limit=20" -Method Post -Headers $headers -TimeoutSec 300
Write-Host "    图谱：新增关系 $($kg.relations_added)"

Write-Host "==> 6. 生成校务洞察"
$ins = Invoke-RestMethod -Uri "$base/api/v1/insights" -Method Post -Headers $headers -TimeoutSec 180
Write-Host "    洞察：$($ins.id)"

Write-Host "==> 7. 一键智能闭环"
$loop = Invoke-RestMethod -Uri "$base/api/v1/closed-loop/run?collect=false" -Method Post -Headers $headers -TimeoutSec 180
Write-Host "    闭环：$($loop.summary)"

Write-Host "==> 8. 可信问答评测（30 问，约 5-10 分钟）"
python scripts/eval_grounding.py

Write-Host "==> 完成。查看 EVAL_REPORT.md 与前端 http://localhost:3000"

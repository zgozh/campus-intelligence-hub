# 一键验收编排 —— REFACTOR_PLAN_V2_2 D1（R12 的统一验收命令）
#
# 按序执行：
#   1) 后端 pytest（--ignore=tests/integration）
#   2) 前端 typecheck
#   3) 前端单测
#   4) 前端生产构建
#   5) 真机接口冒烟 scripts/smoke_refactor.ps1
#   6) 真实浏览器场景冒烟 scripts/browser_smoke.mjs
#   7) 文档一致性检查 scripts/docs_check.ps1（存在才跑）
#
# 任一阶段失败即停止并打印失败阶段（其余阶段标记 SKIPPED），退出码非零。
#
# 用法：
#   powershell -File scripts/verify_all.ps1
#   powershell -File scripts/verify_all.ps1 -SkipBuild -SkipBrowser      # 快速回归
#   powershell -File scripts/verify_all.ps1 -Only frontend-test          # 只跑某阶段
#
# 前置：Docker 栈已启动（campus-backend / campus-frontend 等），否则真机阶段会失败。
# 注意：本机是 Windows PowerShell 5.1，含中文的 .ps1 必须存为 UTF-8 with BOM。
param(
  [switch]$SkipBuild,
  [switch]$SkipBrowser,
  [switch]$SkipSmoke,
  [string]$Only = "",
  [int]$BrowserWindowWidth = 1366,
  [int]$BrowserWindowHeight = 768
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $repoRoot "frontend-nextjs"
$results = New-Object System.Collections.ArrayList

function Invoke-Stage {
  param(
    [string]$Name,
    [string]$WorkDir,
    [scriptblock]$Action
  )
  if ($Only -and $Only -ne $Name) {
    [void]$results.Add([pscustomobject]@{ Stage = $Name; Status = "SKIPPED"; Detail = "-Only 未选中" })
    Write-Host ("[SKIP] {0}" -f $Name) -ForegroundColor DarkGray
    return
  }
  Write-Host ("`n===== [{0}] =====" -f $Name) -ForegroundColor Cyan
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  # PowerShell 5.1 会把原生命令的 stderr 当成错误记录并在 EAP=Stop 下终止脚本；
  # 这里临时放宽，成败一律以退出码为准。
  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    Push-Location $WorkDir
    & $Action
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
  }
  catch {
    $code = 1
    Write-Host ("  异常：" + $_.Exception.Message) -ForegroundColor Red
  }
  finally {
    Pop-Location
    $ErrorActionPreference = $previousEap
  }
  $sw.Stop()
  $status = if ($code -eq 0) { "PASS" } else { "FAIL" }
  [void]$results.Add([pscustomobject]@{ Stage = $Name; Status = $status; Detail = ("{0:N1}s" -f $sw.Elapsed.TotalSeconds) })
  Write-Host ("[{0}] {1}（{2:N1}s）" -f $status, $Name, $sw.Elapsed.TotalSeconds) -ForegroundColor $(if ($code -eq 0) { "Green" } else { "Red" })
  if ($code -ne 0) { throw ("阶段失败：" + $Name) }
}

$failed = $null
try {
  Invoke-Stage "backend-pytest" $repoRoot {
    docker compose exec -T backend python -m pytest --ignore=tests/integration -q
  }
  Invoke-Stage "frontend-typecheck" $frontend { npm run typecheck }
  Invoke-Stage "frontend-test" $frontend { npm run test }
  if (-not $SkipBuild) {
    Invoke-Stage "frontend-build" $frontend { npm run build }
  } else {
    [void]$results.Add([pscustomobject]@{ Stage = "frontend-build"; Status = "SKIPPED"; Detail = "-SkipBuild" })
  }
  if (-not $SkipSmoke) {
    Invoke-Stage "api-smoke" $repoRoot { & (Join-Path $PSScriptRoot "smoke_refactor.ps1") }
  } else {
    [void]$results.Add([pscustomobject]@{ Stage = "api-smoke"; Status = "SKIPPED"; Detail = "-SkipSmoke" })
  }
  if (-not $SkipBrowser) {
    Invoke-Stage "browser-smoke" $repoRoot {
      node scripts/browser_smoke.mjs --window ("{0}x{1}" -f $BrowserWindowWidth, $BrowserWindowHeight)
    }
  } else {
    [void]$results.Add([pscustomobject]@{ Stage = "browser-smoke"; Status = "SKIPPED"; Detail = "-SkipBrowser" })
  }
  if (Test-Path (Join-Path $PSScriptRoot "docs_check.ps1")) {
    Invoke-Stage "docs-check" $repoRoot { & (Join-Path $PSScriptRoot "docs_check.ps1") }
  } else {
    [void]$results.Add([pscustomobject]@{ Stage = "docs-check"; Status = "SKIPPED"; Detail = "脚本尚未实现（B10）" })
  }
}
catch {
  $failed = $_.Exception.Message
}

Write-Host "`n================ 验收汇总 ================" -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String | Write-Host
$failCount = @($results | Where-Object { $_.Status -eq "FAIL" }).Count
if ($failCount -gt 0 -or $failed) {
  Write-Host ("结果：失败（{0}）" -f $failed) -ForegroundColor Red
  exit 1
}
Write-Host "结果：全部通过" -ForegroundColor Green
exit 0

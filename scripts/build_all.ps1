# 一键构建并启动（含构建标识注入）——REFACTOR_PLAN_V2_2 A2
#
# 作用：把同一个 APP_BUILD 传给后端（env）与前端（build args），使
#   - 后端 GET /api/v1/version 返回该标识；
#   - 前端页面侧边栏显示该标识、布局带 data-build 属性；
#   - 真机探针可断言"页面 data-build == 后端 version.build"，从而分辨
#     "修复没生效" 与 "用户跑的是旧 bundle（未硬刷新）"。
#
# 用法：
#   pwsh -File scripts/build_all.ps1                 # 构建 backend + frontend
#   pwsh -File scripts/build_all.ps1 -Services frontend
#   pwsh -File scripts/build_all.ps1 -BuildId my-tag # 手工指定标识
#
# 注意：本机为 Windows PowerShell 5.1，含中文的 .ps1 必须存为 UTF-8 with BOM。
param(
  [string]$Services = "backend frontend",
  [string]$BuildId = "",
  [switch]$NoCache
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  if (-not $BuildId) {
    $commit = "nogit"
    try { $commit = (git rev-parse --short HEAD 2>$null) } catch { }
    if (-not $commit) { $commit = "nogit" }
    $BuildId = "{0}-{1}" -f $commit, (Get-Date -Format "yyyyMMdd-HHmmss")
  }
  $env:APP_BUILD = $BuildId
  if (-not $env:APP_VERSION) { $env:APP_VERSION = "2.2.0" }
  if (-not $env:APP_ENVIRONMENT) { $env:APP_ENVIRONMENT = "development" }

  Write-Host ("构建标识 APP_BUILD = {0}" -f $env:APP_BUILD) -ForegroundColor Cyan
  $svcList = $Services.Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)
  $dockerArgs = @("compose", "up", "-d", "--build") + $svcList
  if ($NoCache) { $dockerArgs += "--no-cache" }
  # PowerShell 5.1 会把原生命令的 stderr（docker 构建进度）当成错误记录，在
  # ErrorActionPreference=Stop 下会直接终止脚本（本项目踩过）；此处临时放宽，用退出码判定成败。
  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & docker @dockerArgs
    $dockerExit = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousEap
  }
  if ($dockerExit -ne 0) { throw ("docker compose 构建失败，退出码 " + $dockerExit) }

  Start-Sleep -Seconds 12
  $ver = Invoke-RestMethod -Uri "http://localhost:8000/api/v1/version"
  Write-Host ("后端 /api/v1/version → build={0} version={1} env={2}" -f $ver.build, $ver.version, $ver.environment) -ForegroundColor Green

  $html = (Invoke-WebRequest -Uri "http://localhost:3000/overview" -UseBasicParsing).Content
  if ($html -match [regex]::Escape($env:APP_BUILD)) {
    Write-Host "前端已加载新构建（HTML 中出现该标识）" -ForegroundColor Green
  } else {
    Write-Host "提示：HTML 中未直接出现标识（可能由客户端注入）——请用浏览器硬刷新后查看侧边栏左下角版本号" -ForegroundColor Yellow
  }
  Write-Host "完成。请在浏览器硬刷新（Ctrl+Shift+R）后确认左下角版本号与上面一致。" -ForegroundColor Cyan
}
finally {
  Pop-Location
}

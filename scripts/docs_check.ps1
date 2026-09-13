# 文档与仓库一致性机械校验 —— REFACTOR_PLAN_V2_2 B10
#
# 为什么需要：文档里"声称存在"的路径会随重构漂移（例如根目录 package.json、widget/、
# docs/plans 早已不存在，但 AGENTS.md/CLAUDE.md 仍在引用），人眼很难持续维护。
# 本脚本把可机械判定的部分固化成检查，纳入 scripts/verify_all.ps1。
#
# 用法：powershell -File scripts/docs_check.ps1
# 退出码：0 = 全部通过；1 = 存在不一致（逐条打印）
#
# 注意：本机是 Windows PowerShell 5.1，含中文的 .ps1 必须存为 UTF-8 with BOM。
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
$failures = New-Object System.Collections.ArrayList
$passes = 0

function Check($name, $ok, $detail) {
  if ($ok) { $script:passes++; Write-Host ("  [PASS] {0}" -f $name) -ForegroundColor Green }
  else { [void]$script:failures.Add($name); Write-Host ("  [FAIL] {0} — {1}" -f $name, $detail) -ForegroundColor Red }
}

try {
  Write-Host "`n=== 1) 文档引用的路径必须真实存在 ===" -ForegroundColor Cyan
  # 这些是当前有效的路径（新增引用请同步加入本清单）
  $mustExist = @(
    "backend", "backend/services", "backend/api/v1", "backend/tests", "backend/models.py",
    "backend/services/migration_runner.py", "backend/services/run_service.py",
    "frontend-nextjs", "frontend-nextjs/src/views", "frontend-nextjs/src/components",
    "frontend-nextjs/src/utils/format.ts", "frontend-nextjs/src/utils/constants.ts",
    "frontend-nextjs/tests/setup.ts", "frontend-nextjs/tests/unit/README.md",
    "scripts/smoke_refactor.ps1", "scripts/browser_smoke.mjs", "scripts/browser_probe.mjs",
    "scripts/lib/cdp.mjs", "scripts/verify_all.ps1", "scripts/build_all.ps1",
    "scripts/eval_grounding.py", "docker-compose.yml", "nginx", "scrapling-service",
    "eval/questions.json", "README.md", "ARCHITECTURE.md", "DEPLOY-GUIDE.md"
  )
  foreach ($p in $mustExist) {
    Check ("存在：" + $p) (Test-Path $p) "路径不存在（文档若引用它即为失实）"
  }

  Write-Host "`n=== 2) 文档不得声称这些已不存在的路径 ===" -ForegroundColor Cyan
  # 这些路径在本仓库确实不存在，出现于文档即为漂移（命中时给出文件与行号）
  $forbidden = @("package.json", "widget/", "docs/plans", "docs/specs", "install-deploy.sh")
  $docFiles = @("AGENTS.md", "CLAUDE.md", "README.md", "PROJECT_README.md", "ARCHITECTURE.md", "DEPLOY-GUIDE.md")
  foreach ($needle in $forbidden) {
    $hits = @()
    foreach ($doc in $docFiles) {
      if (-not (Test-Path $doc)) { continue }
      # 注意：-SimpleMatch 已是字面匹配，**不要**再套 [regex]::Escape —— 转义后的反斜杠
      # 会让字面匹配永远失败（本脚本曾因此漏报 install-deploy.sh，自查时才发现）。
      $matched = Select-String -Path $doc -Pattern $needle -SimpleMatch -ErrorAction SilentlyContinue
      foreach ($m in $matched) {
        # 允许"显式说明其不存在/已移除"的句子（这类陈述准确，不应判为漂移）
        if ($m.Line -match "不存在|没有|不含|无关|已不(再)?存在|历史上|曾有|已移除|不再引用|勿再引用|已删") { continue }
        $hits += ("{0}:{1}" -f $doc, $m.LineNumber)
      }
    }
    Check ("不再声称：" + $needle) ($hits.Count -eq 0) ("命中 " + ($hits -join ", "))
  }

  Write-Host "`n=== 3) 展示层清零护栏 ===" -ForegroundColor Cyan
  $srcFiles = Get-ChildItem "frontend-nextjs/src" -Recurse -Include *.ts, *.tsx
  # 3.1 组件内禁止自行格式化时间（唯一出口 src/utils/format.ts 的内部注释除外）
  $localeHits = $srcFiles | Select-String -Pattern "toLocaleString|toLocaleDateString" |
    Where-Object { $_.Path -notlike "*utils\format.ts" }
  Check "源码无 toLocaleString/toLocaleDateString（format.ts 注释除外）" ($localeHits.Count -eq 0) (($localeHits | ForEach-Object { "{0}:{1}" -f $_.Filename, $_.LineNumber }) -join ", ")

  # 3.2 死代码不得复活
  $sanitizerHits = Get-ChildItem "frontend-nextjs" -Recurse -Include *.ts, *.tsx -Exclude node_modules |
    Where-Object { $_.FullName -notlike "*node_modules*" } | Select-String -Pattern "textSanitizer"
  Check "无 textSanitizer 引用（死代码已删）" ($sanitizerHits.Count -eq 0) (($sanitizerHits | ForEach-Object { "{0}:{1}" -f $_.Filename, $_.LineNumber }) -join ", ")

  # 3.3 本地 fmtTime/formatTime 实现只能有 format.ts 一处
  $fmtHits = $srcFiles | Select-String -Pattern "function (fmtTime|formatTime)"
  Check "本地时间格式化实现唯一（仅 format.ts）" ($fmtHits.Count -le 1) (($fmtHits | ForEach-Object { "{0}:{1}" -f $_.Filename, $_.LineNumber }) -join ", ")

  # 3.4 ': any' 数量不得超过既有豁免基线（当前 3 处均为 echarts 三方回调解包）
  $anyCount = ($srcFiles | Select-String -Pattern ": any" | Measure-Object).Count
  Check ("': any' 不超过基线 3（当前 " + $anyCount + "）") ($anyCount -le 3) "禁 any 约定出现回退（新增处请改为显式类型）"

  Write-Host "`n=== 4) 关键脚本必须被 git 跟踪（防 gitignore 误伤） ===" -ForegroundColor Cyan
  $tracked = (git ls-files "scripts/lib/cdp.mjs" "scripts/browser_smoke.mjs" "scripts/verify_all.ps1" "scripts/docs_check.ps1")
  Check "脚本已入库（scripts/lib 曾被 .gitignore 的 lib/ 误伤）" (($tracked | Measure-Object).Count -ge 3) ("已跟踪：" + ($tracked -join ", "))
}
finally {
  Pop-Location
}

Write-Host "`n================ 文档一致性检查 ================" -ForegroundColor Cyan
Write-Host ("通过 {0} / 失败 {1}" -f $passes, $failures.Count) -ForegroundColor $(if ($failures.Count -eq 0) { "Green" } else { "Red" })
if ($failures.Count -gt 0) {
  Write-Host ("失败项：" + ($failures -join "；")) -ForegroundColor Red
  exit 1
}
exit 0

# 生成 Gitee 展示仓库（单 commit 快照）—— REFACTOR_PLAN_V2_2 交付形态
#
# 背景与策略（双仓库）：
#   GitHub  git@github.com:zgozh/campus-intelligence-hub.git
#           = 开发主仓库，保留完整提交历史（每个 commit 可追溯、可 review）。
#   Gitee   git@gitee.com:zgozh/campus-intelligence-hub.git
#           = 赛事展示仓库，只保留 **一个提交**，只含可运行内容 + README +
#             架构/部署文档；开发过程文档（方案、重构计划、审计、任务清单、
#             AI 协作约定、内部 Spec 等）不进入展示仓库。
#
# 用法：
#   powershell -File scripts/release_gitee.ps1                 # 干跑：导出到临时目录 + 自检，不推送
#   powershell -File scripts/release_gitee.ps1 -Push           # 导出后强推（--force）到 Gitee master
#   powershell -File scripts/release_gitee.ps1 -Push -Cleanup  # 推送成功后删除临时目录
#   powershell -File scripts/release_gitee.ps1 -Push -KeepRemoteDocs
#       文档（README / ARCHITECTURE / DEPLOY-GUIDE）**保持展示仓现有版本不动**，
#       只把代码更新成开发仓当前状态（适用于"展示仓文档已人工精简、不想被覆盖"）。
#   powershell -File scripts/release_gitee.ps1 -Push -DocsFromDir <目录>
#       文档取自本地目录（目录内放 README.md / ARCHITECTURE.md / DEPLOY-GUIDE.md），
#       用于"要在展示仓文档上做一处修正、其余保持"的场景。
#
# 为什么用「导出 + 全新 git init + 单 commit + force push」而不是 .gitignore：
#   .gitignore 只对「未跟踪文件」生效，对已跟踪的开发文档无效；且同一份 .gitignore
#   同时作用于 GitHub，会误伤开发主仓库。展示仓库是**派生产物**，应当可重复生成。
#
# 注意：本机是 Windows PowerShell 5.1，含中文的 .ps1 必须存为 UTF-8 with BOM。
param(
  [switch]$Push,
  [string]$Remote = "origin",
  [switch]$Cleanup,
  # 文档以展示仓现有版本为准（只更新代码）；不传则文档从开发仓导出并做死链改写
  [switch]$KeepRemoteDocs,
  # 文档从本地目录取（目录内需有 README.md / ARCHITECTURE.md / DEPLOY-GUIDE.md）。
  # 用于"展示仓文档要改一处、其余保持"的场景；与 -KeepRemoteDocs 互斥。
  [string]$DocsFromDir = ""
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# ── 唯一保留的根目录文档（其余根目录 *.md 一律视为开发过程文档） ──────────────
$keepRootDocs = @("README.md", "ARCHITECTURE.md", "DEPLOY-GUIDE.md")

# 展示仓库内不得出现的目录（前缀匹配）：Basjoo 时期遗留的 Playwright e2e
# —— 本仓库根目录没有 package.json，无法运行，属于开发残留。
$excludePrefixes = @("tests/")

$showcaseMessage = @"
校务智汇中台 2.0（Campus Intelligence Hub）— 赛事展示版源码

面向高校校务管理的 AI 自动数据采集与知识管理中台：
多源自动采集 → 变更雷达 → 知识治理 → 融合检索问答（防幻觉引用）
→ 知识图谱 → 三层 Agent 闭环 → REST / MCP 对外开放。

一键部署（不需要任何本地模型 / GPU）：
  cp .env.example .env          # 填 DASHSCOPE_API_KEY（不填则自动 Mock 降级）
  docker compose up -d --build  # 6 个容器，打开 http://localhost:3000

本仓库为赛事展示用**单提交快照**：仅含可运行源码、配置、
README、架构说明（ARCHITECTURE.md）与部署指南（DEPLOY-GUIDE.md）。
开发过程文档（方案 / 重构计划 / 审计报告 / 任务清单 / AI 协作约定等）
不在本仓库内；完整开发历史请见：
  git@github.com:zgozh/campus-intelligence-hub.git
"@

function Invoke-Git {
  param([string[]]$GitArgs, [string]$WorkDir)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    if ($WorkDir) { $out = & git -C $WorkDir @GitArgs 2>&1 } else { $out = & git @GitArgs 2>&1 }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($code -ne 0) {
    throw ("git " + ($GitArgs -join " ") + " 失败（exit " + $code + "）：`n" + (($out | Out-String).Trim()))
  }
  return $out
}

function Test-ExcludedPath {
  param([string]$Path)
  if ($Path -notmatch "/") {
    # 根目录：只留 README / ARCHITECTURE / DEPLOY-GUIDE 三个 md
    if (($Path -like "*.md") -and ($keepRootDocs -notcontains $Path)) { return $true }
  }
  foreach ($p in $excludePrefixes) { if ($Path.StartsWith($p)) { return $true } }
  return $false
}

# 逐字替换（找不到原文即失败，防止改写规则随文档漂移后静默失效）
function Replace-Exact {
  param([string]$Path, [string]$Old, [string]$New)
  $text = [System.IO.File]::ReadAllText($Path)
  if (-not $text.Contains($Old)) {
    throw ("展示版文档改写失败：在 " + (Split-Path -Leaf $Path) + " 中找不到待替换片段：`n" + $Old)
  }
  [System.IO.File]::WriteAllText($Path, $text.Replace($Old, $New), (New-Object System.Text.UTF8Encoding($false)))
}

# 删除引用了「不进入展示仓库的文档」的 Markdown 表格行
function Remove-DocTableRows {
  param([string]$Path, [string[]]$DocNames)
  $lines = [System.IO.File]::ReadAllLines($Path)
  $kept = New-Object System.Collections.ArrayList
  $removed = 0
  foreach ($line in $lines) {
    $drop = $false
    if ($line.TrimStart().StartsWith("|")) {
      foreach ($m in [regex]::Matches($line, "\]\(([^)]+)\)")) {
        if ($DocNames -contains $m.Groups[1].Value.Trim()) { $drop = $true }
      }
      if (-not $drop) {
        foreach ($d in $DocNames) { if ($line -like ("*" + $d + "*")) { $drop = $true } }
      }
    }
    if ($drop) { $removed++ } else { [void]$kept.Add($line) }
  }
  [System.IO.File]::WriteAllLines($Path, $kept, (New-Object System.Text.UTF8Encoding($false)))
  return $removed
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  Write-Host "`n=== 1) 前置检查 ===" -ForegroundColor Cyan
  $head = (Invoke-Git @("rev-parse", "--short", "HEAD") | Select-Object -First 1)
  $dirty = Invoke-Git @("status", "--porcelain") | Where-Object { $_ -and ($_ -notmatch "^\?\?") }
  if ($dirty) {
    throw ("工作区存在未提交的已跟踪文件改动，请先提交后再导出展示仓库：`n" + (($dirty | Out-String).Trim()))
  }
  Write-Host ("  [OK] 导出源：HEAD = " + $head + "（工作区已跟踪文件干净）") -ForegroundColor Green

  # 文档来源三选一：展示仓现有版本 / 本地目录 / 开发仓（默认，含死链改写）
  if ($KeepRemoteDocs -and $DocsFromDir) {
    throw "参数冲突：-KeepRemoteDocs 与 -DocsFromDir 只能二选一"
  }
  $remoteTip = ""
  $docsFromDirAbs = ""
  if ($KeepRemoteDocs) {
    Invoke-Git @("fetch", $Remote, "master") | Out-Null
    $remoteTip = (Invoke-Git @("rev-parse", ($Remote + "/master")) | Select-Object -First 1)
    $remoteDocs = Invoke-Git @("ls-tree", "--name-only", $remoteTip) |
      Where-Object { $keepRootDocs -contains $_ }
    foreach ($doc in $keepRootDocs) {
      if ($remoteDocs -notcontains $doc) {
        throw ("-KeepRemoteDocs 要求展示仓已存在该文档，但 " + $Remote + "/master(" + $remoteTip + ") 里没有 " + $doc)
      }
    }
    Write-Host ("  [OK] 文档来源：展示仓 " + $Remote + "/master = " + $remoteTip + "（README / ARCHITECTURE / DEPLOY-GUIDE 保持不动）") -ForegroundColor Yellow
  }
  if ($DocsFromDir) {
    if (-not (Test-Path $DocsFromDir)) { throw ("-DocsFromDir 目录不存在：" + $DocsFromDir) }
    $docsFromDirAbs = (Resolve-Path $DocsFromDir).Path
    foreach ($doc in $keepRootDocs) {
      if (-not (Test-Path (Join-Path $docsFromDirAbs $doc))) {
        throw ("-DocsFromDir 目录缺少文档：" + $doc + "（目录：" + $docsFromDirAbs + "）")
      }
    }
    Write-Host ("  [OK] 文档来源：本地目录 " + $docsFromDirAbs + "（逐字节复制，不做改写）") -ForegroundColor Yellow
  }

  Write-Host "`n=== 2) 导出可运行内容到临时目录 ===" -ForegroundColor Cyan
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $out = Join-Path $env:TEMP ("campus-gitee-" + $stamp)
  if (Test-Path $out) { Remove-Item -Recurse -Force $out }
  New-Item -ItemType Directory -Path $out -Force | Out-Null

  $raw = (Invoke-Git @("ls-files", "-z")) -join ""
  $files = $raw -split "`0" | Where-Object { $_ }
  $excluded = New-Object System.Collections.ArrayList
  $copied = 0
  foreach ($f in $files) {
    if (Test-ExcludedPath $f) { [void]$excluded.Add($f); continue }
    $src = Join-Path $repoRoot ($f -replace "/", "\")
    $dst = Join-Path $out ($f -replace "/", "\")
    $dstDir = Split-Path -Parent $dst
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    Copy-Item -LiteralPath $src -Destination $dst -Force
    $copied++
  }
  Write-Host ("  [OK] 纳入 " + $copied + " 个文件；剔除 " + $excluded.Count + " 个开发过程文件") -ForegroundColor Green
  Write-Host "  —— 剔除清单 ——" -ForegroundColor DarkGray
  foreach ($e in $excluded) { Write-Host ("     - " + $e) -ForegroundColor DarkGray }

  Write-Host "`n=== 3) 展示版文档处理 ===" -ForegroundColor Cyan
  $excludedDocNames = @()
  foreach ($e in $excluded) { if ($e -notmatch "/") { $excludedDocNames += $e } }

  if ($KeepRemoteDocs) {
    # 文档保持展示仓现有版本：只做逐字节复制 + 校验，不做任何改写
    foreach ($doc in $keepRootDocs) {
      $dest = Join-Path $out $doc
      $cmdLine = 'git show ' + $remoteTip + ':' + $doc + ' > "' + $dest + '"'
      cmd /c $cmdLine | Out-Null
      if (-not (Test-Path $dest)) { throw ("从展示仓取文档失败：" + $doc) }
      $expectHash = (Invoke-Git @("rev-parse", ($remoteTip + ":" + $doc)) | Select-Object -First 1)
      $gotHash = (Invoke-Git @("hash-object", "--path", $doc, $dest) | Select-Object -First 1)
      if ($expectHash -ne $gotHash) {
        throw ("文档与展示仓版本不一致（未做到保持不动）：" + $doc + " 期望 " + $expectHash + " 实际 " + $gotHash)
      }
      Write-Host ("  [OK] 保持展示仓版本：" + $doc + "（blob " + $gotHash.Substring(0, 8) + "）") -ForegroundColor Green
    }
    Write-Host "  [OK] 未对文档做任何改写（KeepRemoteDocs）" -ForegroundColor Green
  } elseif ($DocsFromDir) {
    # 文档取自本地目录：逐字节复制（含 blob 指纹回显，便于与开发仓版本对照），不做改写
    foreach ($doc in $keepRootDocs) {
      $src = Join-Path $docsFromDirAbs $doc
      $dest = Join-Path $out $doc
      Copy-Item -LiteralPath $src -Destination $dest -Force
      $hash = (Invoke-Git @("hash-object", "--path", $doc, $dest) | Select-Object -First 1)
      Write-Host ("  [OK] 取自本地目录：" + $doc + "（blob " + $hash.Substring(0, 8) + "）") -ForegroundColor Green
    }
  } else {
  $rows = Remove-DocTableRows (Join-Path $out "README.md") $excludedDocNames
  Write-Host ("  [OK] README.md 删除导航表行 " + $rows + " 行") -ForegroundColor Green

  Replace-Exact (Join-Path $out "README.md") `
    '> 数字来自仓库内 `EVAL_REPORT.md` 的实测记录。**需要最新数字请自行复跑**（结果会写入该文件）：' `
    '> 数字来自本项目 30 问评测集的实测记录（需要已起好的栈）。**需要最新数字请自行复跑**：脚本会把新报告写到本地 `EVAL_REPORT.md`（该文件不进展示仓库）：'

  Replace-Exact (Join-Path $out "README.md") `
    '**许可**：见 [`LICENSE`](LICENSE)。底座复用 MIT 协议的 Basjoo，本项目在其之上做校务域二次开发（详见 [`OSS_REUSE.md`](OSS_REUSE.md)）。' `
    '**许可**：见 [`LICENSE`](LICENSE)。底座复用 MIT 协议的 Basjoo，本项目在其之上做校务域二次开发。'

  Replace-Exact (Join-Path $out "ARCHITECTURE.md") `
    '└── OSS_REUSE.md / CURRENT_SYSTEM_AUDIT.md / ARCHITECTURE.md / TASKS.md / AGENTS.md' `
    '└── README.md / ARCHITECTURE.md / DEPLOY-GUIDE.md'

  Replace-Exact (Join-Path $out "DEPLOY-GUIDE.md") `
    '- [ ] **11. 人工演示动线**：按 `DEMO_SCRIPT.md` 走一遍（配置面板 → 实时时间线 → 通知中心），确认浏览器**硬刷新**后版本号正确' `
    '- [ ] **11. 人工演示动线**：走一遍（配置面板 → 实时时间线 → 通知中心），确认浏览器**硬刷新**后版本号正确'
  Write-Host "  [OK] README.md / ARCHITECTURE.md / DEPLOY-GUIDE.md 内文引用已同步" -ForegroundColor Green
  }

  $leftover = @()
  foreach ($d in $excludedDocNames) { if (Test-Path (Join-Path $out $d)) { $leftover += $d } }
  if ($leftover.Count -gt 0) { throw ("被剔除的文档仍存在于展示目录：" + ($leftover -join ", ")) }
  foreach ($needle in @("](EVAL_REPORT.md)", "](OSS_REUSE.md)", "](DEMO_SCRIPT.md)", "](REFACTOR_PLAN", "](DECISIONS.md)", "](COMPETITION_SUBMISSION.md)")) {
    $hit = Select-String -Path (Join-Path $out "*.md") -Pattern $needle -SimpleMatch -ErrorAction SilentlyContinue
    if ($hit) { throw ("展示版文档仍存在死链 " + $needle + "：" + (($hit | ForEach-Object { $_.Filename + ":" + $_.LineNumber }) -join ", ")) }
  }
  Write-Host "  [OK] 死链自查通过（无指向被剔除文档的链接）" -ForegroundColor Green

  Write-Host "`n=== 4) 生成单提交仓库 ===" -ForegroundColor Cyan
  Invoke-Git @("init") -WorkDir $out | Out-Null
  Invoke-Git @("symbolic-ref", "HEAD", "refs/heads/master") -WorkDir $out | Out-Null
  Invoke-Git @("add", "-A", "-f") -WorkDir $out | Out-Null
  $msgFile = Join-Path $out ".showcase-commit-msg.tmp"
  [System.IO.File]::WriteAllText($msgFile, $showcaseMessage, (New-Object System.Text.UTF8Encoding($false)))
  $authorName = (Invoke-Git @("config", "user.name") | Select-Object -First 1)
  $authorMail = (Invoke-Git @("config", "user.email") | Select-Object -First 1)
  Invoke-Git @("-c", ("user.name=" + $authorName), "-c", ("user.email=" + $authorMail), "commit", "-F", $msgFile) -WorkDir $out | Out-Null
  Remove-Item -LiteralPath $msgFile -Force
  $count = (Invoke-Git @("rev-list", "--count", "HEAD") -WorkDir $out | Select-Object -First 1)
  $sha = (Invoke-Git @("rev-parse", "--short", "HEAD") -WorkDir $out | Select-Object -First 1)
  if ([int]$count -ne 1) { throw ("展示仓库必须是单提交，实际提交数 = " + $count) }
  Write-Host ("  [OK] 单提交仓库已生成：commit " + $sha + "，文件 " + $copied + " 个") -ForegroundColor Green

  Write-Host "`n=== 5) 展示仓库自检（文档一致性脚本在展示仓库内必须通过） ===" -ForegroundColor Cyan
  $check = Join-Path $out "scripts\docs_check.ps1"
  if (Test-Path $check) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & powershell -NoProfile -File $check | Select-Object -Last 6
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -ne 0) { throw "展示仓库内 scripts/docs_check.ps1 未通过（exit " + $code + "）" }
    Write-Host "  [OK] 展示仓库文档一致性检查通过" -ForegroundColor Green
  }

  Write-Host "`n=== 6) 推送 ===" -ForegroundColor Cyan
  $url = (Invoke-Git @("remote", "get-url", $Remote) | Select-Object -First 1)
  Write-Host ("  目标：" + $Remote + " -> " + $url)
  if (-not $Push) {
    Write-Host "`n  [干跑] 未推送。临时目录（可直接进去检查）：" -ForegroundColor Yellow
    Write-Host ("  " + $out) -ForegroundColor Yellow
    Write-Host "`n  确认无误后执行：powershell -File scripts/release_gitee.ps1 -Push" -ForegroundColor Yellow
  } else {
    Write-Host "  ⚠ 即将 force push：该远端 master 的历史将被重写为这一个提交（GitHub 不受影响）" -ForegroundColor Yellow
    Invoke-Git @("push", "--force", $url, "master") -WorkDir $out | Out-Null
    $remoteSha = (Invoke-Git @("ls-remote", $url, "refs/heads/master") | Select-Object -First 1)
    Write-Host ("  [OK] 已推送：" + $remoteSha) -ForegroundColor Green
    Write-Host "`n  提示：此后不要再对该远端执行普通的 git push origin master（会因历史分叉被拒）；" -ForegroundColor Yellow
    Write-Host "        更新展示仓库请重跑本脚本。" -ForegroundColor Yellow
    if ($Cleanup) { Remove-Item -Recurse -Force $out; Write-Host "  已清理临时目录" -ForegroundColor DarkGray }
    else { Write-Host ("  临时目录保留：" + $out) -ForegroundColor DarkGray }
  }
} finally {
  Pop-Location
}

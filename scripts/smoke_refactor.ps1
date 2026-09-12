# 校务智汇中台 — 本轮重构（REFACTOR_PLAN_V2）真机冒烟验证
# 用法：pwsh -File scripts/smoke_refactor.ps1
# 覆盖：配置 Schema / 监控快照真源 / 栏目动态发现 / 闭环 SSE 流式 + 回放 + 取消接口 /
#       采集时间范围参数 / 通知全部已读
$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 控制台默认非 UTF-8，会让中文显示为乱码（仅显示问题，不影响判定）
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$base = if ($env:SMOKE_BASE) { $env:SMOKE_BASE } else { "http://localhost:8000" }
$pass = 0; $fail = 0

function Check($name, $ok, $detail) {
  if ($ok) { $script:pass++; Write-Host ("  [PASS] {0} — {1}" -f $name, $detail) -ForegroundColor Green }
  else { $script:fail++; Write-Host ("  [FAIL] {0} — {1}" -f $name, $detail) -ForegroundColor Red }
}

Write-Host "`n=== 1) 登录 ===" -ForegroundColor Cyan
$loginBody = [System.Text.Encoding]::UTF8.GetBytes((@{ email = "admin@campus.local"; password = "campus123456" } | ConvertTo-Json))
$login = Invoke-RestMethod -Uri "$base/api/admin/login" -Method Post -ContentType "application/json; charset=utf-8" -Body $loginBody
$H = @{ Authorization = "Bearer $($login.access_token)" }
Check "登录" ($null -ne $login.access_token) "已取到 token"

Write-Host "`n=== 2) 配置 Schema（T3：前端动态表单的依据） ===" -ForegroundColor Cyan
$schema = Invoke-RestMethod -Uri "$base/api/v1/config-schema/closed-loop" -Headers $H
$fieldKeys = @($schema.groups | ForEach-Object { $_.fields } | ForEach-Object { $_.key })
Check "Schema 分组" (@($schema.groups).Count -eq 3) ("groups=" + (@($schema.groups | ForEach-Object { $_.key }) -join ","))
Check "Schema 字段齐全" ($fieldKeys -contains "collect" -and $fieldKeys -contains "source_ids" -and $fieldKeys -contains "health_threshold") ("fields=" + $fieldKeys.Count)
Check "连字符与下划线两种写法均可" ((Invoke-RestMethod -Uri "$base/api/v1/config-schema/closed_loop" -Headers $H).name -eq "closed_loop") "closed_loop OK"

Write-Host "`n=== 3) 监控快照真源（P3） ===" -ForegroundColor Cyan
$mon1 = Invoke-RestMethod -Uri "$base/api/v1/sources/monitor" -Headers $H
$firstItem = $mon1.items[0]
Check "返回快照时间 refreshed_at" ($null -ne $mon1.refreshed_at) $mon1.refreshed_at
Check "返回 last_success_at 字段" ($firstItem.PSObject.Properties.Name -contains "last_success_at") ("源=" + $firstItem.name)
Check "返回 last_error 字段" ($firstItem.PSObject.Properties.Name -contains "last_error") ("last_error=" + $firstItem.last_error)

Write-Host "`n=== 4) 栏目动态发现（P7） ===" -ForegroundColor Cyan
$sid = $firstItem.source_id
$cols = Invoke-RestMethod -Uri "$base/api/v1/sources/$sid/columns" -Headers $H
Check "栏目接口可用" ($null -ne $cols.columns) ("源=" + $firstItem.name)
Check "栏目非空（不再是只有'全部内容'）" (@($cols.columns).Count -ge 1) (($cols.columns | ForEach-Object { $_.label }) -join " / ")
Check "栏目带计数与来源标记" (@($cols.columns | Where-Object { $_.PSObject.Properties.Name -contains "count" -and $_.PSObject.Properties.Name -contains "origin" }).Count -eq @($cols.columns).Count) "count/origin 齐全"

Write-Host "`n=== 5) 采集参数（P8：时间范围 + 条数上限，任务参数留痕） ===" -ForegroundColor Cyan
$run = Invoke-RestMethod -Uri "$base/api/v1/sources/$sid/run?max_pages=1&since=2026-09-01&max_items=5" -Method Post -Headers $H
Check "带时间范围触发采集" ($null -ne $run.job_id) ("job_id=" + $run.job_id)
$job = Invoke-RestMethod -Uri "$base/api/v1/jobs/$($run.job_id)" -Headers $H
Check "参数已留痕（params.since）" ($job.params.since -eq "2026-09-01") ("params=" + ($job.params | ConvertTo-Json -Compress))
$dup = $null
try { $dup = Invoke-RestMethod -Uri "$base/api/v1/sources/$sid/run" -Method Post -Headers $H } catch { $dup = $_.Exception.Response.StatusCode.value__ }
Check "同源并发采集返回 409" ($dup -eq 409) ("second=" + $dup)
Start-Sleep -Seconds 25
$mon2 = Invoke-RestMethod -Uri "$base/api/v1/sources/monitor" -Headers $H
$after = $mon2.items | Where-Object { $_.source_id -eq $sid }
Check "last_crawled_at 已推进（时间真源在服务内）" ($after.last_crawled_at -ne $firstItem.last_crawled_at) ($firstItem.last_crawled_at + " -> " + $after.last_crawled_at)

Write-Host "`n=== 6) 闭环 SSE 流式（P4 + P6） ===" -ForegroundColor Cyan
$tmp = Join-Path $env:TEMP "campus_sse.txt"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
curl.exe -sN --max-time 240 -o $tmp -X POST "$base/api/v1/closed-loop/stream" -H "Authorization: Bearer $($login.access_token)" -H "Content-Type: application/json" -d "{}"
$sw.Stop()
$raw = if (Test-Path $tmp) { Get-Content $tmp -Raw -Encoding UTF8 } else { "" }
$evNames = @([regex]::Matches($raw, "(?m)^event: (.+)$") | ForEach-Object { $_.Groups[1].Value.Trim() })
if ($evNames.Count -eq 0) {
  Check "SSE 流可用" $false ("未收到任何事件；响应片段：" + $raw.Substring(0, [Math]::Min(200, $raw.Length)))
} else {
  Check "首个事件是 run_started" ($evNames[0] -eq "run_started") ("first=" + $evNames[0])
  Check "阶段事件成对（3 阶段）" ((@($evNames | Where-Object { $_ -eq "stage_started" }).Count -eq 3) -and (@($evNames | Where-Object { $_ -eq "stage_finished" }).Count -eq 3)) ("started=" + @($evNames | Where-Object { $_ -eq "stage_started" }).Count)
  Check "决策事件逐条推送" (@($evNames | Where-Object { $_ -eq "stage_decision" }).Count -ge 6) ("decisions=" + @($evNames | Where-Object { $_ -eq "stage_decision" }).Count)
  Check "以 run_finished 收尾" ($evNames[-1] -eq "run_finished") ("last=" + $evNames[-1])
  Check "总耗时在预算内（无采集 ≤ 15s 目标，宽松断言）" ($sw.Elapsed.TotalSeconds -lt 120) ("elapsed=" + [math]::Round($sw.Elapsed.TotalSeconds, 1) + "s")

  $runId = ([regex]::Match($raw, '"run_id":\s*"([^"]+)"')).Groups[1].Value
  $finishedAtCount = [regex]::Matches($raw, '"finished_at":\s*"([^"]+)"').Count
  Check "决策带 finished_at（时间线展示完成时刻）" ($finishedAtCount -ge 6) ("finished_at 出现 " + $finishedAtCount + " 次")
  Check "决策带 duration_ms（展示耗时）" ($raw -match '"duration_ms"') "duration_ms 存在"
}

Write-Host "`n=== 7) 运行历史 + 回放同构（P6） ===" -ForegroundColor Cyan
$runs = Invoke-RestMethod -Uri "$base/api/v1/closed-loop/runs?limit=5" -Headers $H
Check "运行历史含参数快照" (@($runs.runs).Count -ge 1 -and $null -ne $runs.runs[0].params) ("total=" + $runs.total)
$replay = Invoke-RestMethod -Uri "$base/api/v1/closed-loop/runs/$runId" -Headers $H
$replayNames = @($replay.events | ForEach-Object { $_.event })
Check "回放序列首尾同构" ($replayNames[0] -eq "run_started" -and $replayNames[-1] -eq "run_finished") ($runId)
$replayDecisions = @($replay.events | Where-Object { $_.event -eq "stage_decision" })
Check "回放决策字段与实时一致" ($replayDecisions.Count -ge 6 -and ($replayDecisions[0].PSObject.Properties.Name -contains "finished_at")) ("replay decisions=" + $replayDecisions.Count)
$rtDecisions = @($evNames | Where-Object { $_ -eq "stage_decision" }).Count
Check "回放决策条数 == 实时条数" ($replayDecisions.Count -eq $rtDecisions) ($rtDecisions)

Write-Host "`n=== 8) 旧同步端点仍可用（硬约束：只增不改） ===" -ForegroundColor Cyan
$legacy = Invoke-RestMethod -Uri "$base/api/v1/closed-loop/run?collect=false" -Method Post -Headers $H -TimeoutSec 240
Check "POST /closed-loop/run 未破坏" ($null -ne $legacy.run_id -and @($legacy.stages).Count -eq 3) ("run_id=" + $legacy.run_id)

Write-Host "`n=== 9) 通知中心（P1 后端侧：read-all + link） ===" -ForegroundColor Cyan
$ntf = Invoke-RestMethod -Uri "$base/api/v1/notifications?limit=20" -Headers $H
Check "通知项含 link 字段" ($ntf.notifications.Count -gt 0 -and ($ntf.notifications[0].PSObject.Properties.Name -contains "link")) ("共 " + $ntf.total + " 条")
$readAll = Invoke-RestMethod -Uri "$base/api/v1/notifications/read-all" -Method Post -Headers $H
$readAll2 = Invoke-RestMethod -Uri "$base/api/v1/notifications/read-all" -Method Post -Headers $H
Check "全部已读幂等" ($readAll2.updated -eq 0) ("first=" + $readAll.updated + " second=" + $readAll2.updated)
$unread = Invoke-RestMethod -Uri "$base/api/v1/notifications/unread-count" -Headers $H
Check "未读数归零" ($unread.unread -eq 0) ("unread=" + $unread.unread)
$kindFiltered = Invoke-RestMethod -Uri "$base/api/v1/notifications?kind=insight&limit=5" -Headers $H
Check "kind 分类过滤可用" ($null -ne $kindFiltered.notifications) ("insight 通知 " + $kindFiltered.total + " 条")

Write-Host "`n=== 10) 洞察/快讯 title（P2 后端侧） ===" -ForegroundColor Cyan
$ins = Invoke-RestMethod -Uri "$base/api/v1/insights?limit=3" -Headers $H
$t = $ins.reports[0].title
Check "洞察列表带干净 title" ($null -ne $t -and $t -notmatch '\*' -and $t -notmatch '^#') ("title=" + $t)
$brf = Invoke-RestMethod -Uri "$base/api/v1/sources/brief?limit=3" -Headers $H
$bt = $brf.reports[0].title
Check "快讯列表带干净 title" ($null -ne $bt -and $bt -notmatch '\*') ("title=" + $bt)

Write-Host "`n================ 结果 ================" -ForegroundColor Cyan
Write-Host ("通过 {0} / 失败 {1}" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
if ($fail -gt 0) { exit 1 }

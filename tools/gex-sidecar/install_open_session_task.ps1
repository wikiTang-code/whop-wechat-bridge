# Register or update the weekday GEX pre-open Task Scheduler jobs (Auto EDT/EST DST aware).
# Pre-open: wake 07:45 ET -> pull 08:00 ET -> deadline 08:25 ET.
# Winter EST (Asia/Shanghai): 20:45 -> 21:00 -> 21:25; summer EDT: 19:45 -> 20:00 -> 20:25.
# Post-close: wake 20:10 ET -> pull 20:15 ET -> deadline 20:40 ET.
# Winter EST (Asia/Shanghai): next-day 09:10 -> 09:15 -> 09:40; summer EDT: 08:10 -> 08:15 -> 08:40.
# Source update only in this change; live task installation is handled separately by ops.
# Re-run this script to update the existing tasks in place. Do not run on GCP.
#
# Usage (from repo root, on win-host):
#   powershell -ExecutionPolicy Bypass -File tools/gex-sidecar/install_open_session_task.ps1
#   powershell -ExecutionPolicy Bypass -File tools/gex-sidecar/install_open_session_task.ps1 -Season winter
#   powershell -File tools/gex-sidecar/install_open_session_task.ps1 -Uninstall

param(
  [switch]$Uninstall,
  [string]$TaskName = "WhopGexOpenSession0940ET",
  [string]$MorningTaskName = "WhopGexMorningSession2100ET",
  [ValidateSet("auto", "winter", "summer")][string]$Season = "auto"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

$Python = $null
foreach ($cand in @("python", "py")) {
  $cmd = Get-Command $cand -ErrorAction SilentlyContinue
  if ($cmd) { $Python = $cmd.Source; break }
}
if (-not $Python) { throw "python not found on PATH" }

$Runner = Join-Path $RepoRoot "tools\gex-sidecar\open_session_run.py"
if (-not (Test-Path $Runner)) { throw "missing $Runner" }

$ConfigExample = Join-Path $RepoRoot "tools\gex-sidecar\open_session_config.example.json"
$Config = Join-Path $RepoRoot "tools\gex-sidecar\open_session_config.json"
if (-not (Test-Path $Config)) {
  Copy-Item $ConfigExample $Config
  Write-Host "Created $Config from example — edit mode/symbols before relying on schedule."
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $MorningTaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed tasks $TaskName and $MorningTaskName"
  exit 0
}

$Wrapper = Join-Path $RepoRoot "tools\gex-sidecar\_open_session_task.cmd"
$WrapperBody = @"
@echo off
cd /d "$RepoRoot"
set PYTHONIOENCODING=utf-8
if not defined LONGBRIDGE_REGION set LONGBRIDGE_REGION=global
"$Python" "$Runner" --wake-et 07:45 --target-et 08:00 --deadline-et 08:25 --finish-window-et 08:20-08:25
"@
Set-Content -Path $Wrapper -Value $WrapperBody -Encoding ASCII

# --- 时区与冬夏令时感知计算 ---
$etZone = [System.TimeZoneInfo]::FindSystemTimeZoneById("Eastern Standard Time")
$nowUtc = [DateTime]::UtcNow
$nowEt = [System.TimeZoneInfo]::ConvertTimeFromUtc($nowUtc, $etZone)
$isDst = $etZone.IsDaylightSavingTime($nowEt)

$useWinter = if ($Season -eq "winter") { $true } elseif ($Season -eq "summer") { $false } else { -not $isDst }
$seasonLabel = if ($useWinter) { "冬令时 EST (UTC-5)" } else { "夏令时 EDT (UTC-4)" }

$localTz = [System.TimeZoneInfo]::Local

# 晚场唤醒 07:45 ET；08:00 ET 拉链，08:25 ET 截止。
# 冬令 EST: wake 12:45 UTC = 北京 20:45；pull 北京 21:00；deadline 北京 21:25。
# 夏令 EDT: wake 11:45 UTC = 北京 19:45；pull 北京 20:00；deadline 北京 20:25。
$eveningRefUtcStr = if ($useWinter) { "2026-12-01 12:45:00" } else { "2026-07-01 11:45:00" }
$eveningRefUtc = [DateTime]::SpecifyKind([DateTime]$eveningRefUtcStr, [DateTimeKind]::Utc)
$eveningLocal = [System.TimeZoneInfo]::ConvertTimeFromUtc($eveningRefUtc, $localTz)
$localHHmm = $eveningLocal.ToString("HH:mm")

$nextLocal = (Get-Date).Date.AddHours($eveningLocal.Hour).AddMinutes($eveningLocal.Minute)
while ($nextLocal.DayOfWeek -eq [DayOfWeek]::Saturday -or $nextLocal.DayOfWeek -eq [DayOfWeek]::Sunday -or $nextLocal -le (Get-Date)) {
  $nextLocal = $nextLocal.AddDays(1)
}
$startBoundary = $nextLocal.ToString("yyyy-MM-ddTHH:mm:00")

$wrapperEsc = [System.Security.SecurityElement]::Escape($Wrapper)
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Whop GEX pre-open collect Mon-Fri wake 07:45 Eastern ($seasonLabel, local wall=$localHHmm), chain pull 08:00 ET, deadline 08:25 ET. win-host OpenD only.</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <DaysOfWeek>
          <Monday />
          <Tuesday />
          <Wednesday />
          <Thursday />
          <Friday />
        </DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$wrapperEsc</Command>
    </Exec>
  </Actions>
</Task>
"@

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null

# --- 早场任务: 美东 20:10 ET 唤醒，20:15 ET 拉链，20:40 ET 截止 ---
# 冬令 EST: wake 01:10 UTC (次日) = 北京 09:10；pull 北京 09:15；deadline 北京 09:40。
# 夏令 EDT: wake 00:10 UTC (次日) = 北京 08:10；pull 北京 08:15；deadline 北京 08:40。
$MorningWrapper = Join-Path $RepoRoot "tools\gex-sidecar\_morning_session_task.cmd"
$MorningWrapperBody = @"
@echo off
cd /d "$RepoRoot"
set PYTHONIOENCODING=utf-8
if not defined LONGBRIDGE_REGION set LONGBRIDGE_REGION=global
"$Python" "$Runner" --wake-et 20:10 --target-et 20:15 --deadline-et 20:40 --finish-window-et 20:35-20:40
"@
Set-Content -Path $MorningWrapper -Value $MorningWrapperBody -Encoding ASCII

$morningRefUtcStr = if ($useWinter) { "2026-12-02 01:10:00" } else { "2026-07-02 00:10:00" }
$morningRefUtc = [DateTime]::SpecifyKind([DateTime]$morningRefUtcStr, [DateTimeKind]::Utc)
$morningLocal = [System.TimeZoneInfo]::ConvertTimeFromUtc($morningRefUtc, $localTz)
$morningHHmm = $morningLocal.ToString("HH:mm")

$nextMorning = (Get-Date).Date.AddHours($morningLocal.Hour).AddMinutes($morningLocal.Minute)
while ($nextMorning.DayOfWeek -eq [DayOfWeek]::Sunday -or $nextMorning.DayOfWeek -eq [DayOfWeek]::Monday -or $nextMorning -le (Get-Date)) {
  $nextMorning = $nextMorning.AddDays(1)
}
$startMorningBoundary = $nextMorning.ToString("yyyy-MM-ddTHH:mm:00")

$morningWrapperEsc = [System.Security.SecurityElement]::Escape($MorningWrapper)
$morningXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Whop GEX morning post-market collect Tue-Sat wake 20:10 Eastern ($seasonLabel, local wall=$morningHHmm), chain pull 20:15 ET, deadline 20:40 ET. win-host OpenD only.</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$startMorningBoundary</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <DaysOfWeek>
          <Tuesday />
          <Wednesday />
          <Thursday />
          <Friday />
          <Saturday />
        </DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$morningWrapperEsc</Command>
    </Exec>
  </Actions>
</Task>
"@

Unregister-ScheduledTask -TaskName $MorningTaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $MorningTaskName -Xml $morningXml -Force | Out-Null

Write-Host ""
Write-Host "Installed Dual-Session Tasks (方案 A 早晚双轨 - $seasonLabel):"
Write-Host "1. 晚场开盘前任务: $TaskName"
Write-Host "   Wake: Mon-Fri 07:45 ET (本地北京时间壁钟=$localHHmm). Chain pull 08:00 ET (本地=$($eveningLocal.AddMinutes(15).ToString('HH:mm'))). Deadline 08:25 ET."
Write-Host "   StartBoundary: $startBoundary"
Write-Host "   Wrapper: $Wrapper"
Write-Host "2. 早场盘后结算任务: $MorningTaskName"
Write-Host "   Wake: Tue-Sat 20:10 ET (本地北京时间壁钟=$morningHHmm). Chain pull 20:15 ET (本地=$($morningLocal.AddMinutes(5).ToString('HH:mm'))). Deadline 20:40 ET."
Write-Host "   StartBoundary: $startMorningBoundary"
Write-Host "   Wrapper: $MorningWrapper"
Write-Host "Config: $Config"
Write-Host "Season: $Season (Detected isDst=$isDst, active=$seasonLabel)"
Write-Host "Uninstall: powershell -File tools/gex-sidecar/install_open_session_task.ps1 -Uninstall"

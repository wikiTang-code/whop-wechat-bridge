# Register or update the weekday GEX pre-open Task Scheduler job.
# Wake 08:45 America/New_York; open_session_run.py waits until 09:00 ET to pull the chain.
# Deadline 09:25 ET is enforced in Python (latest.json preopen.deadline_status=late).
# Re-run this script to update the existing task in place. Do not run the collector on GCP.
#
# Usage (from repo root, on win-host):
#   powershell -ExecutionPolicy Bypass -File tools/gex-sidecar/install_open_session_task.ps1
#   powershell -File tools/gex-sidecar/install_open_session_task.ps1 -Uninstall
#
# The trigger is the summer (EDT) UTC instant of 08:45 ET converted to this PC's wall clock.
# Python then waits until 09:00 ET, so a later EST shift only wakes earlier. Re-run once to
# apply CHG-059; do not re-install on every DST transition.

param(
  [switch]$Uninstall,
  [string]$TaskName = "WhopGexOpenSession0940ET"
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
  Write-Host "Removed task $TaskName"
  exit 0
}

$Wrapper = Join-Path $RepoRoot "tools\gex-sidecar\_open_session_task.cmd"
$WrapperBody = @"
@echo off
cd /d "$RepoRoot"
set PYTHONIOENCODING=utf-8
if not defined LONGBRIDGE_REGION set LONGBRIDGE_REGION=global
"$Python" "$Runner"
"@
Set-Content -Path $Wrapper -Value $WrapperBody -Encoding ASCII

# Wake anchor: 08:45 ET. Summer EDT (UTC-4) 08:45 = 12:45 UTC; winter EST (UTC-5) 08:45 = 13:45 UTC.
# Anchoring the trigger to summer 12:45 UTC wakes at 08:45 ET in summer and earlier in winter
# on a fixed-offset host. open_session_run.py waits until 09:00 ET (CHG-059 / DEBT-013).
$localTz = [System.TimeZoneInfo]::Local
$summerRefUtc = [DateTime]::SpecifyKind([DateTime]"2026-07-01 12:45:00", [DateTimeKind]::Utc)
$summerLocal = [System.TimeZoneInfo]::ConvertTimeFromUtc($summerRefUtc, $localTz)
$localHHmm = $summerLocal.ToString("HH:mm")

$nextLocal = (Get-Date).Date.AddHours($summerLocal.Hour).AddMinutes($summerLocal.Minute)
while ($nextLocal.DayOfWeek -eq [DayOfWeek]::Saturday -or $nextLocal.DayOfWeek -eq [DayOfWeek]::Sunday -or $nextLocal -le (Get-Date)) {
  $nextLocal = $nextLocal.AddDays(1)
}
$startBoundary = $nextLocal.ToString("yyyy-MM-ddTHH:mm:00")

$wrapperEsc = [System.Security.SecurityElement]::Escape($Wrapper)
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Whop GEX pre-open collect Mon-Fri wake 08:45 Eastern, chain pull 09:00, deadline 09:25 (CHG-059, DEBT-013). Local wall=$localHHmm. Python waits until 09:00 ET. OI is prior-close T+1. win-host OpenD only.</Description>
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

Write-Host ""
Write-Host "Installed task: $TaskName"
Write-Host "  Wake: Mon-Fri 08:45 ET (local wall=$localHHmm). Chain pull 09:00 ET. Deadline 09:25 ET."
Write-Host "  StartBoundary: $startBoundary"
Write-Host "  Wrapper: $Wrapper"
Write-Host "  Config: $Config"
Write-Host "  DST: summer UTC anchor 12:45; Python waits until 09:00 ET. Re-run this script once to apply; no seasonal reinstall."
Write-Host "  OI: prior-close T+1. 09:31 spot-only refresh must not repull OI (python --spot-only-refresh is a stub)."
Write-Host "Dry-run: python tools/gex-sidecar/open_session_run.py --dry-run"
Write-Host "Uninstall: powershell -File tools/gex-sidecar/install_open_session_task.ps1 -Uninstall"

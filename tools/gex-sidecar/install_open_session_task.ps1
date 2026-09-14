# Register weekday GEX open-session Task Scheduler job at 09:40 Eastern Time.
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File tools/gex-sidecar/install_open_session_task.ps1
#   powershell -File tools/gex-sidecar/install_open_session_task.ps1 -Uninstall
#
# Hosts not on US Eastern: trigger StartBoundary is converted to *current* local wall-clock
# equivalent of Eastern 09:40 (re-run this script after DST transitions).

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

# Convert next Eastern 09:40 to local wall-clock for CalendarTrigger (CN-safe).
$et = [System.TimeZoneInfo]::FindSystemTimeZoneById("Eastern Standard Time")
$localTz = [System.TimeZoneInfo]::Local
$utcNow = [DateTime]::UtcNow
$candidates = @()
for ($d = 0; $d -lt 14; $d++) {
  $etNow = [System.TimeZoneInfo]::ConvertTimeFromUtc($utcNow.AddDays($d), $et)
  $etDay = $etNow.Date
  if ($etDay.DayOfWeek -eq [DayOfWeek]::Saturday -or $etDay.DayOfWeek -eq [DayOfWeek]::Sunday) { continue }
  $etTarget = $etDay.AddHours(9).AddMinutes(40)
  # Interpret etTarget as Eastern wall time -> UTC -> local
  $etAsUnspec = [DateTime]::SpecifyKind($etTarget, [DateTimeKind]::Unspecified)
  $utcTarget = [System.TimeZoneInfo]::ConvertTimeToUtc($etAsUnspec, $et)
  $localTarget = [System.TimeZoneInfo]::ConvertTimeFromUtc($utcTarget, $localTz)
  if ($localTarget -gt (Get-Date)) { $candidates += $localTarget }
}
if ($candidates.Count -eq 0) {
  throw "Could not compute next Eastern 09:40 local wall-clock"
}
$nextLocal = $candidates[0]
$localHHmm = $nextLocal.ToString("HH:mm")
$startBoundary = $nextLocal.ToString("yyyy-MM-ddTHH:mm:00")

$wrapperEsc = [System.Security.SecurityElement]::Escape($Wrapper)
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Whop GEX open-session collect Mon-Fri ~09:40 Eastern (REQ-003). Local wall=$localHHmm at install; re-run after DST.</Description>
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
Write-Host "  Target: Mon-Fri Eastern 09:40 -> local wall-clock $localHHmm (host TZ=$($localTz.Id))"
Write-Host "  StartBoundary: $startBoundary"
Write-Host "  Wrapper: $Wrapper"
Write-Host "  Config: $Config"
Write-Host "  Re-run this installer after US DST changes."
Write-Host "Dry-run: python tools/gex-sidecar/open_session_run.py --dry-run"
Write-Host "Uninstall: powershell -File tools/gex-sidecar/install_open_session_task.ps1 -Uninstall"

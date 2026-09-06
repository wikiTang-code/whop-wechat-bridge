# Register weekday GEX open-session Task Scheduler job at 09:40 Eastern Time.
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File tools/gex-sidecar/install_open_session_task.ps1
#   powershell -File tools/gex-sidecar/install_open_session_task.ps1 -Uninstall

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
  schtasks.exe /Delete /F /TN $TaskName 2>$null | Out-Null
  Write-Host "Removed task $TaskName"
  exit 0
}

# Wrapper .cmd so WorkingDirectory is repo root and env is inherited from user session.
$Wrapper = Join-Path $RepoRoot "tools\gex-sidecar\_open_session_task.cmd"
$WrapperBody = @"
@echo off
cd /d "$RepoRoot"
set PYTHONIOENCODING=utf-8
if not defined LONGBRIDGE_REGION set LONGBRIDGE_REGION=global
"$Python" "$Runner"
"@
Set-Content -Path $Wrapper -Value $WrapperBody -Encoding ASCII

schtasks.exe /Delete /F /TN $TaskName 2>$null | Out-Null
schtasks.exe /Create /F `
  /TN $TaskName `
  /SC WEEKLY `
  /D MON,TUE,WED,THU,FRI `
  /ST 09:40 `
  /TZ "Eastern Standard Time" `
  /TR "`"$Wrapper`"" `
  /RL LIMITED | Out-Host

Write-Host ""
Write-Host "Installed task: $TaskName"
Write-Host "  When: Mon-Fri 09:40 Eastern Standard Time (Windows applies DST)"
Write-Host "  Wrapper: $Wrapper"
Write-Host "  Config: $Config"
Write-Host "Dry-run: python tools/gex-sidecar/open_session_run.py --dry-run"
Write-Host "Uninstall: powershell -File tools/gex-sidecar/install_open_session_task.ps1 -Uninstall"

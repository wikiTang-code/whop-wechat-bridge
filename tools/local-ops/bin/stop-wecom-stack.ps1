# Stop WeCom local-ops stack started by start-wecom-stack.ps1
$ErrorActionPreference = 'Continue'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$PidFile = Join-Path $Root 'tools\local-ops\state\wecom-stack.pids.json'

if (Test-Path $PidFile) {
  $meta = Get-Content $PidFile -Raw | ConvertFrom-Json
  foreach ($name in @('http_pid', 'ssh_pid')) {
    $pidVal = $meta.$name
    if ($pidVal) {
      try {
        Stop-Process -Id $pidVal -Force -ErrorAction Stop
        Write-Host "[wecom-stack] stopped $name=$pidVal"
      } catch {
        Write-Host "[wecom-stack] $name=$pidVal already gone"
      }
    }
  }
}

# Fallback: kill listeners / matching ssh
Get-NetTCPConnection -LocalPort 18789 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '18789:127\.0\.0\.1:18789' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Write-Host '[wecom-stack] stopped'

# Start WeCom local-ops stack: ops:http (18789) + SSH reverse to gcp-vm.
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File tools/local-ops/bin/start-wecom-stack.ps1

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
Set-Location $Root

$StateDir = Join-Path $Root 'tools\local-ops\state'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$PidFile = Join-Path $StateDir 'wecom-stack.pids.json'

function Test-PortListen([int]$Port) {
  try {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    return $null -ne $c
  } catch { return $false }
}

# --- ops:http ---
$httpPid = $null
if (Test-PortListen 18789) {
  Write-Host '[wecom-stack] ops:http already listening on 18789'
  $httpPid = (Get-NetTCPConnection -LocalPort 18789 -State Listen | Select-Object -First 1 -ExpandProperty OwningProcess)
} else {
  $http = Start-Process -FilePath 'node' -ArgumentList 'tools/local-ops/http-server.js' `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $StateDir 'ops-http.out.log') `
    -RedirectStandardError (Join-Path $StateDir 'ops-http.err.log')
  $httpPid = $http.Id
  Start-Sleep -Seconds 1
  if (-not (Test-PortListen 18789)) {
    throw 'ops:http failed to bind 18789 — see tools/local-ops/state/ops-http.err.log'
  }
  Write-Host "[wecom-stack] ops:http started pid=$httpPid"
}

# --- SSH reverse tunnel ---
$sshPid = $null
$existingSsh = Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '18789:127\.0\.0\.1:18789' } |
  Select-Object -First 1
if ($existingSsh) {
  $sshPid = $existingSsh.ProcessId
  Write-Host "[wecom-stack] ssh -R 18789 already running pid=$sshPid"
} else {
  $ssh = Start-Process -FilePath 'ssh' -ArgumentList @(
    '-o', 'BatchMode=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-N',
    '-R', '127.0.0.1:18789:127.0.0.1:18789',
    'gcp-vm'
  ) -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $StateDir 'ssh-r18789.out.log') `
    -RedirectStandardError (Join-Path $StateDir 'ssh-r18789.err.log')
  $sshPid = $ssh.Id
  Start-Sleep -Seconds 2
  Write-Host "[wecom-stack] ssh -R started pid=$sshPid"
}

@{
  started_at = (Get-Date).ToString('o')
  root = "$Root"
  http_pid = $httpPid
  ssh_pid = $sshPid
  callback = 'https://wiki111.dpdns.org/wecom/callback'
} | ConvertTo-Json | Set-Content -Path $PidFile -Encoding utf8

Write-Host '[wecom-stack] ready'
Write-Host "  healthz:  http://127.0.0.1:18789/healthz"
Write-Host "  callback: https://wiki111.dpdns.org/wecom/callback"
Write-Host "  pids:     $PidFile"

# Register logon autostart for WeCom local-ops stack (current user).
# Run once:
#   powershell -ExecutionPolicy Bypass -File tools/local-ops/bin/register-autostart.ps1
# Remove:
#   Unregister-ScheduledTask -TaskName 'whop-local-ops-wecom' -Confirm:$false

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$StartScript = Join-Path $Root 'tools\local-ops\bin\start-wecom-stack.ps1'
$TaskName = 'whop-local-ops-wecom'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument `
  "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "[wecom-stack] registered Scheduled Task '$TaskName' at logon for $env:USERNAME"
Write-Host "  start now: powershell -ExecutionPolicy Bypass -File `"$StartScript`""
Write-Host "  remove:    Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"

# DEPRECATED (CHG-023): do not use 8081 bridge.
# Boot path is scripts/whop-lm-tunnel.bat -> wsl-ai-cutover.js then ssh -R 8080:127.0.0.1:8080
Write-Host "CHG-023: WhopTunnelGuard.ps1 retired. Use whop-lm-tunnel.bat"
exit 1

@echo off
REM Whop AI - boot: WSL cutover then single SSH reverse tunnel (CHG-023)
REM Do NOT start LM Studio. Do NOT use 8081 lm_bridge.
title Whop AI Tunnel (WSL 8080)
cd /d "%~dp0\.."

:RECONNECT
echo [%date% %time%] CHG-023 cutover then ssh -R 8080...
node tools\wsl-ai-cutover.js
if errorlevel 1 (
  echo CUTOVER_FAILED - retry in 30s
  timeout /t 30 /nobreak > nul
  goto RECONNECT
)

taskkill /F /IM ssh.exe /T 2>nul
timeout /t 2 /nobreak > nul

ssh -i "C:\Users\86597\.ssh\stable_key" ^
    -o StrictHostKeyChecking=no ^
    -o ServerAliveInterval=30 ^
    -o ServerAliveCountMax=3 ^
    -o ConnectTimeout=10 ^
    -N -R 8080:127.0.0.1:8080 ^
    wikitang628@35.212.142.173

echo [%date% %time%] tunnel down - reconnect in 60s
timeout /t 60 /nobreak > nul
goto RECONNECT

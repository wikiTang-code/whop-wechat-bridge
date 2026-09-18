@echo off
title Whop AI - 工作模式 (装载 14B)
chcp 65001 >nul
set "PROJ_DIR=%~dp0\.."
if not exist "%PROJ_DIR%\scripts\lms_load.js" (
  set "PROJ_DIR=C:\Users\86597\.gemini\antigravity\scratch\whop-wechat-bridge"
)
cd /d "%PROJ_DIR%"
echo ============================================================
echo   Whop AI 显存调度: 正在切换至 [工作模式] (装载 14B 模型)...
echo ============================================================
echo.
node scripts/lms_load.js --work
echo.
echo ============================================================
echo   按任意键关闭窗口...
pause >nul

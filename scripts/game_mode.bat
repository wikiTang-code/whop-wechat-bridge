@echo off
title Whop AI - 游戏模式 (排空显存)
chcp 65001 >nul
set "PROJ_DIR=%~dp0\.."
if not exist "%PROJ_DIR%\scripts\lms_load.js" (
  set "PROJ_DIR=C:\Users\86597\.gemini\antigravity\scratch\whop-wechat-bridge"
)
cd /d "%PROJ_DIR%"
echo ============================================================
echo   Whop AI 显存调度: 正在切换至 [游戏模式] (释放显存与共享内存)...
echo ============================================================
echo.
node scripts/lms_load.js --game
echo.
echo ============================================================
echo   按任意键关闭窗口...
pause >nul

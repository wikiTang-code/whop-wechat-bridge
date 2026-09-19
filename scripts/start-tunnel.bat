@echo off
REM Deprecated dual-path (8081 bridge). Use whop-lm-tunnel.bat (CHG-023).
title Whop AI Tunnel Guard DEPRECATED
echo CHG-023: 8081 lm_bridge path retired. Launching whop-lm-tunnel.bat instead.
cd /d "%~dp0"
call "%~dp0whop-lm-tunnel.bat"

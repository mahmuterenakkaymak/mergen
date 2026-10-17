@echo off
rem One click: brings the whole local agent stack up in Agent mode.
rem   1. Strata (Qwen3.8-Flash-Next, 256K) loads on the GPU   2. OpenClaw uses it
rem   3. the OpenClaw gateway is checked                       4. dashboard, mode panel and voice widget open
title MERGEN start
set "ROOT=%~dp0"

echo [1/3] Agent mode: Strata + OpenClaw (1-3 min on a cold start; the PC can stutter while the model loads)
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\switch-mode.ps1" -Mode agent
if errorlevel 1 (
    echo Agent mode failed - see the messages above and the Strata log named in config\active-model.cmd
    pause
    exit /b 1
)

echo [2/3] Local search (SearXNG in Docker) and the OpenClaw gateway
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\start-searxng.ps1"
call openclaw gateway status 2>nul | findstr /c:"Connectivity probe: ok" >nul
if errorlevel 1 call openclaw gateway start

echo [3/3] Opening the OpenClaw dashboard, the mode panel and MERGEN voice
call openclaw dashboard >nul 2>&1 || start "" http://127.0.0.1:18789/
start "" /min powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%ROOT%scripts\mode-panel.ps1"
call "%ROOT%voice\mergen-voice.bat"

echo.
echo Ready.  Chat: OpenClaw dashboard  ^|  Voice: "Mergen, ..." (widget bottom-right, Ctrl+Alt+M on/off)  ^|  Modes: the panel
timeout /t 8 >nul 2>&1

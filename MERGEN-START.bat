@echo off
rem One click: brings the whole local agent stack up in Agent mode.
rem Everything that does not need the model starts first and in parallel (the steps used to run one after another,
rem and Docker only started after Strata had loaded):
rem   1. SearXNG (Docker), the mode panel and the voice widget, in the background
rem   2. Strata (Qwen3.8-Flash-Next, 256K) loads on the GPU - the long part
rem   3. the OpenClaw gateway is checked (it starts at logon by itself), then the dashboard opens
title MERGEN start
set "ROOT=%~dp0"

echo [1/3] In the background: local search (SearXNG in Docker), mode panel, MERGEN voice
start "SearXNG" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\start-searxng.ps1"
rem One mode panel only: a second click on the shortcut used to open a second panel.
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -match 'mode-panel.ps1' }) { exit 1 } else { exit 0 }"
if not errorlevel 1 start "" /min powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%ROOT%scripts\mode-panel.ps1"
call "%ROOT%voice\mergen-voice.bat"

echo [2/3] Agent mode: Strata + OpenClaw (1-3 min on a cold start; the PC can stutter while the model loads)
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\switch-mode.ps1" -Mode agent
if errorlevel 1 (
    echo Agent mode failed - see the messages above and the Strata log named in config\active-model.cmd
    pause
    exit /b 1
)

echo [3/3] OpenClaw gateway and dashboard
call openclaw gateway status 2>nul | findstr /c:"Connectivity probe: ok" >nul
if errorlevel 1 call openclaw gateway start
call openclaw dashboard >nul 2>&1 || start "" http://127.0.0.1:18789/

echo.
echo Ready.  Chat: OpenClaw dashboard  ^|  Voice: "Mergen, ..." (widget bottom-right, Ctrl+Alt+M on/off)  ^|  Modes: the panel
timeout /t 8 >nul 2>&1

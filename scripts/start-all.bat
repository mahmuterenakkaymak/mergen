@echo off
rem Starts Strata in its own window, waits until the model is loaded, then checks the OpenClaw gateway.
rem --- config ---
rem STRATA_DIR, STRATA_RUN, STRATA_LOG, STRATA_MODEL: the model chosen in 01-install-strata.ps1
call "%~dp0..\config\active-model.cmd"
set "STRATA_HEALTH=http://127.0.0.1:8080/health"
set "WAIT_SECONDS=600"
rem ---------------

rem findstr /r: "." matches the quote after "loaded" (quotes cannot be escaped reliably in cmd).
curl -s -m 3 %STRATA_HEALTH% | findstr /r /c:"loaded.: true" >nul
if not errorlevel 1 (
    echo Strata is already running.
    goto gateway
)

rem Something else (or a Strata still loading) may hold the port: do not start a second copy.
curl -s -m 3 %STRATA_HEALTH% | findstr /c:"strata" >nul
if not errorlevel 1 (
    echo Strata is already starting - waiting for it.
    goto waitstart
)

echo Starting Strata. The PC can stutter for 1-3 minutes while the model loads - do not close its window.
start "Strata" /d "%STRATA_DIR%" "%STRATA_DIR%\%STRATA_RUN%"

:waitstart
set /a tries=%WAIT_SECONDS% / 5
:wait
curl -s -m 3 %STRATA_HEALTH% | findstr /r /c:"loaded.: true" >nul
if not errorlevel 1 goto loaded
set /a tries-=1
if %tries% LEQ 0 (
    echo Strata did not report loaded within %WAIT_SECONDS% s. See %STRATA_LOG%
    exit /b 1
)
rem "timeout" needs a console with keyboard input; ping works everywhere (~5 s).
ping -n 6 127.0.0.1 >nul
goto wait

:loaded
echo Strata is ready: http://127.0.0.1:8080

:gateway
call openclaw gateway status 2>nul | findstr /c:"Connectivity probe: ok" >nul
if errorlevel 1 (
    echo OpenClaw gateway is not answering - starting it.
    call openclaw gateway start
) else (
    echo OpenClaw gateway is running: http://127.0.0.1:18789
)

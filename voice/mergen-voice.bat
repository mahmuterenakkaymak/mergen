@echo off
rem MERGEN voice: starts the voice widget (no console). Say "Mergen, ..." or hold F9.
rem Click the widget or press Ctrl+Alt+M to turn listening on/off; right-click it for the menu.
rem Log: %LOCALAPPDATA%\mergen\voice.log   Console version for debugging: .venv\Scripts\python.exe mergen_voice.py
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" | Where-Object { $_.CommandLine -match 'mergen_widget.py' }) { exit 1 } else { exit 0 }"
if errorlevel 1 (
    echo MERGEN voice is already running.
    exit /b 0
)
start "" /d "%~dp0" "%~dp0.venv\Scripts\pythonw.exe" "%~dp0mergen_widget.py"

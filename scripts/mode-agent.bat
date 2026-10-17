@echo off
rem One-click launcher: switches the GPU to "agent" mode.
powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0switch-mode.ps1" -Mode agent

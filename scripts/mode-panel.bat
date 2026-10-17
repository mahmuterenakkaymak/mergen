@echo off
rem Opens the MERGEN mode panel (the panel hides its own console window).
start "" /min powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0mode-panel.ps1"
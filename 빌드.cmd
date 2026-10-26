@echo off
rem Double-click: build from the units folder, then check each unit in Chrome.
rem Drop another folder on this file to build from that folder.
rem (Keep this file ASCII-only: cmd.exe misreads Korean text in batch files.)
chcp 65001 > nul
where node > nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node "%~dp0build.mjs" %1 && echo. && node "%~dp0check.mjs"
pause

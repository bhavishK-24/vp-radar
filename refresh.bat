@echo off
REM Re-scrape ValuePickr Stock Opportunities and open the dashboard.
REM Optional args are passed through, e.g.:  refresh.bat -Latest 100 -TrackTopics 500
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scrape.ps1" %*
start "" "%~dp0site\index.html"

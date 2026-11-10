@echo off
setlocal
cd /d "%~dp0"
if exist "release\win-unpacked\FeiCalendar.exe" (
  start "" "release\win-unpacked\FeiCalendar.exe"
) else (
  call npm start
)

@echo off
setlocal
cd /d "%~dp0"
if exist "release\FeiCalendar-0.5.2-win-x64.exe" (
  start "" "release\FeiCalendar-0.5.2-win-x64.exe"
) else (
  if exist "release\win-unpacked\FeiCalendar.exe" (
    start "" "release\win-unpacked\FeiCalendar.exe"
  ) else (
    echo Please put the FeiCalendar portable executable in the release folder.
    pause
  )
)

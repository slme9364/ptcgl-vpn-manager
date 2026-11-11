@echo off
setlocal EnableExtensions
title PTCGL VPN Manager Cleanup

fltmc >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator privileges...
  powershell.exe -NoProfile -NonInteractive -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo PTCGL VPN Manager cleanup
echo This does NOT remove PTCGL, WireGuard, GCP credentials, or saved app settings.
echo.

echo [1/4] Stopping the application...
taskkill /F /T /IM "PTCGL VPN Manager.exe" >nul 2>&1
if errorlevel 1 (echo   NOT RUNNING) else (echo   STOPPED)

echo [2/4] Removing installed files and updater cache...
call :RemoveDir "%LOCALAPPDATA%\Programs\PTCGL VPN Manager"
call :RemoveDir "%LOCALAPPDATA%\Programs\@ptcgldesktop"
call :RemoveDir "%LOCALAPPDATA%\ptcgl-vpn-manager-updater"
call :RemoveDir "%LOCALAPPDATA%\@ptcgldesktop-updater"
call :RemoveDir "%ProgramFiles%\PTCGL VPN Manager"
if exist "%SystemDrive%\Program Files (x86)\NUL" call :RemoveDir "%SystemDrive%\Program Files (x86)\PTCGL VPN Manager"
echo   Scanning NSIS temporary files...
for /f "delims=" %%F in ('where /r "%TEMP%" "PTCGL VPN Manager.exe" 2^>nul') do call :RemoveDetectedInstall "%%~dpF"

echo [3/4] Removing shortcuts...
call :RemoveFile "%APPDATA%\Microsoft\Windows\Start Menu\Programs\PTCGL VPN Manager.lnk"
call :RemoveFile "%USERPROFILE%\Desktop\PTCGL VPN Manager.lnk"
call :RemoveFile "%PUBLIC%\Desktop\PTCGL VPN Manager.lnk"

echo [4/4] Removing stale uninstall registration...
call :RemoveRegistry "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall"
call :RemoveRegistry "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall"
call :RemoveRegistry "HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"

echo.
echo Cleanup finished. You can now extract and use the ZIP release.
echo Saved VPN Manager settings were kept.
pause
exit /b 0

:RemoveDir
if exist "%~1" (
  rd /S /Q "%~1"
  if exist "%~1" (echo   FAILED: %~1) else (echo   REMOVED: %~1)
) else (
  echo   NOT FOUND: %~1
)
exit /b 0

:RemoveFile
if exist "%~1" (
  del /F /Q "%~1"
  if exist "%~1" (echo   FAILED: %~1) else (echo   REMOVED: %~1)
) else (
  echo   NOT FOUND: %~1
)
exit /b 0

:RemoveRegistry
rem Stable uninstall GUID generated from dev.ptcgl.vpn-manager. Never use
rem substring matches across arbitrary uninstall values to select deletion.
set "APP_UNINSTALL_KEY=%~1\ca841ef7-ba23-5453-9861-b0975a26858b"
reg query "%APP_UNINSTALL_KEY%" /v DisplayName 2>nul | findstr /R /C:"REG_SZ *PTCGL VPN Manager$" /C:"REG_SZ *PTCGL VPN Manager [0-9]" >nul
if errorlevel 1 (
  echo   NOT FOUND under %~1
) else (
  reg delete "%APP_UNINSTALL_KEY%" /f >nul 2>&1
  if errorlevel 1 (echo   FAILED: %APP_UNINSTALL_KEY%) else (echo   REMOVED: %APP_UNINSTALL_KEY%)
)
exit /b 0

:RemoveDetectedInstall
set "DETECTED_DIR=%~1"
if exist "%DETECTED_DIR%resources\app.asar" (
  call :RemoveDir "%DETECTED_DIR%"
) else (
  echo   SKIPPED UNVERIFIED: %DETECTED_DIR%
)
exit /b 0

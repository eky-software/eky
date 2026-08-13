@echo off
setlocal DisableDelayedExpansion
cd /d "%SystemRoot%" || exit /b 31
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0rollbackWindowsInstallerLauncher.ps1"
exit /b %errorlevel%

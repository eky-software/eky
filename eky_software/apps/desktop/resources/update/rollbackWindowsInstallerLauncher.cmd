@echo off
setlocal DisableDelayedExpansion
start "" /b /d "%SystemRoot%" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0rollbackWindowsInstallerLauncher.ps1"
exit /b 0

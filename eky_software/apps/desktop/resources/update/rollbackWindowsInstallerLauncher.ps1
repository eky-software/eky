[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Read-RequiredRollbackEnvironmentValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $value = [System.Environment]::GetEnvironmentVariable(
    $Name,
    [System.EnvironmentVariableTarget]::Process
  )
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw 'ROLLBACK_LAUNCHER_ENVIRONMENT_INVALID'
  }
  return $value
}

try {
  $rollbackScriptPath = Join-Path $PSScriptRoot 'rollbackWindowsInstaller.ps1'
  $rollbackScript = Get-Item -LiteralPath $rollbackScriptPath -Force
  if (
    $rollbackScript.PSIsContainer -or
    (($rollbackScript.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) -or
    $rollbackScript.Length -lt 1
  ) {
    throw 'ROLLBACK_LAUNCHER_SCRIPT_INVALID'
  }

  $launcherProcessIdValue = Read-RequiredRollbackEnvironmentValue `
    -Name 'EKY_ROLLBACK_LAUNCHER_PROCESS_ID'
  $launcherProcessId = 0
  if (
    ![int]::TryParse($launcherProcessIdValue, [ref]$launcherProcessId) -or
    $launcherProcessId -lt 1
  ) {
    throw 'ROLLBACK_LAUNCHER_PROCESS_INVALID'
  }

  $rollbackParameters = @{
    FailedPackagePath = Read-RequiredRollbackEnvironmentValue `
      -Name 'EKY_ROLLBACK_FAILED_PACKAGE_PATH'
    FailedProductCode = Read-RequiredRollbackEnvironmentValue `
      -Name 'EKY_ROLLBACK_FAILED_PRODUCT_CODE'
    LauncherProcessId = $launcherProcessId
    MsiExecPath = Read-RequiredRollbackEnvironmentValue `
      -Name 'EKY_ROLLBACK_MSIEXEC_PATH'
    RollbackPackagePath = Read-RequiredRollbackEnvironmentValue `
      -Name 'EKY_ROLLBACK_PACKAGE_PATH'
  }
  $progressPath = [System.Environment]::GetEnvironmentVariable(
    'EKY_ROLLBACK_PROGRESS_PATH',
    [System.EnvironmentVariableTarget]::Process
  )
  if (![string]::IsNullOrWhiteSpace($progressPath)) {
    $rollbackParameters.ProgressPath = $progressPath
  }

  & $rollbackScriptPath @rollbackParameters
  $rollbackExitCode = $LASTEXITCODE
  if ($rollbackExitCode -notin @(0, 20, 21, 22, 23, 24, 25, 26, 27)) {
    exit 30
  }
  exit $rollbackExitCode
} catch {
  exit 30
}

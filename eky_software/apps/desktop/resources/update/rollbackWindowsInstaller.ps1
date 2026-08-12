[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$')]
  [string]$FailedProductCode,

  [Parameter(Mandatory = $true)]
  [string]$FailedPackagePath,

  [Parameter(Mandatory = $true)]
  [string]$RollbackPackagePath,

  [Parameter(Mandatory = $true)]
  [string]$MsiExecPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-RegularFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Extension
  )

  if ([string]::IsNullOrWhiteSpace($Path) -or $Path.IndexOf([char]0) -ge 0) {
    throw 'ROLLBACK_PATH_INVALID'
  }
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if ($resolved -cne $Path -or [System.IO.Path]::GetExtension($resolved).ToLowerInvariant() -ne $Extension) {
    throw 'ROLLBACK_PATH_INVALID'
  }
  $item = Get-Item -LiteralPath $resolved -Force
  if (
    $item.PSIsContainer -or
    (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) -or
    $item.Length -lt 1
  ) {
    throw 'ROLLBACK_FILE_INVALID'
  }
}

function Invoke-MsiExec {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & $MsiExecPath @Arguments
  return $LASTEXITCODE
}

try {
  Assert-RegularFile -Path $MsiExecPath -Extension '.exe'
  Assert-RegularFile -Path $FailedPackagePath -Extension '.msi'
  Assert-RegularFile -Path $RollbackPackagePath -Extension '.msi'

  $uninstallExitCode = Invoke-MsiExec -Arguments @(
    '/x', $FailedProductCode, '/qn', '/norestart'
  )
  if ($uninstallExitCode -ne 0) {
    exit 20
  }

  $rollbackExitCode = Invoke-MsiExec -Arguments @(
    '/i', $RollbackPackagePath, '/qn', '/norestart'
  )
  if ($rollbackExitCode -eq 0) {
    exit 0
  }

  $repairExitCode = Invoke-MsiExec -Arguments @(
    '/i', $FailedPackagePath, '/qn', '/norestart'
  )
  if ($repairExitCode -eq 0) {
    exit 21
  }
  exit 22
} catch {
  exit 23
}

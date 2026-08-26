[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$')]
  [string]$FailedProductCode,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$LauncherProcessId,

  [Parameter(Mandatory = $true)]
  [string]$FailedPackagePath,

  [Parameter(Mandatory = $true)]
  [string]$RollbackPackagePath,

  [Parameter(Mandatory = $true)]
  [string]$MsiExecPath,

  [Parameter(Mandatory = $true)]
  [string]$RollbackScriptPath,

  [Parameter(Mandatory = $false)]
  [string]$ProgressPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-RegularFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Extension
  )

  if (
    [string]::IsNullOrWhiteSpace($Path) -or
    $Path.IndexOf([char]0) -ge 0 -or
    $Path.Contains('"')
  ) {
    throw 'ROLLBACK_LAUNCH_PATH_INVALID'
  }
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (
    $resolved -cne $Path -or
    [System.IO.Path]::GetExtension($resolved).ToLowerInvariant() -ne $Extension
  ) {
    throw 'ROLLBACK_LAUNCH_PATH_INVALID'
  }
  $item = Get-Item -LiteralPath $resolved -Force
  if (
    $item.PSIsContainer -or
    (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) -or
    $item.Length -lt 1 -or
    !$item.FullName.Equals($resolved, [StringComparison]::OrdinalIgnoreCase)
  ) {
    throw 'ROLLBACK_LAUNCH_FILE_INVALID'
  }
}

function Assert-OptionalProgressPath {
  if ([string]::IsNullOrWhiteSpace($ProgressPath)) {
    return
  }
  if ($ProgressPath.IndexOf([char]0) -ge 0 -or $ProgressPath.Contains('"')) {
    throw 'ROLLBACK_LAUNCH_PROGRESS_PATH_INVALID'
  }
  $resolved = [System.IO.Path]::GetFullPath($ProgressPath)
  if (
    $resolved -cne $ProgressPath -or
    [System.IO.Path]::GetExtension($resolved).ToLowerInvariant() -ne '.jsonl'
  ) {
    throw 'ROLLBACK_LAUNCH_PROGRESS_PATH_INVALID'
  }
  $parentPath = [System.IO.Path]::GetDirectoryName($resolved)
  $parent = Get-Item -LiteralPath $parentPath -Force
  if (
    !$parent.PSIsContainer -or
    (($parent.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) -or
    !$parent.FullName.Equals($parentPath, [StringComparison]::OrdinalIgnoreCase)
  ) {
    throw 'ROLLBACK_LAUNCH_PROGRESS_PATH_INVALID'
  }
  if (Test-Path -LiteralPath $resolved) {
    $existing = Get-Item -LiteralPath $resolved -Force
    if (
      $existing.PSIsContainer -or
      (($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) -or
      !$existing.FullName.Equals($resolved, [StringComparison]::OrdinalIgnoreCase)
    ) {
      throw 'ROLLBACK_LAUNCH_PROGRESS_PATH_INVALID'
    }
  }
}

function ConvertTo-NativeArgument {
  param([Parameter(Mandatory = $true)][string]$Value)

  if ($Value.IndexOf([char]0) -ge 0 -or $Value.Contains('"')) {
    throw 'ROLLBACK_LAUNCH_ARGUMENT_INVALID'
  }
  if ($Value -match '\s') {
    return '"' + $Value + '"'
  }
  return $Value
}

try {
  $powerShellPath = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  Assert-RegularFile -Path $powerShellPath -Extension '.exe'
  Assert-RegularFile -Path $MsiExecPath -Extension '.exe'
  Assert-RegularFile -Path $FailedPackagePath -Extension '.msi'
  Assert-RegularFile -Path $RollbackPackagePath -Extension '.msi'
  Assert-RegularFile -Path $RollbackScriptPath -Extension '.ps1'
  Assert-OptionalProgressPath

  $arguments = @(
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    $RollbackScriptPath,
    '-MsiExecPath',
    $MsiExecPath,
    '-FailedProductCode',
    $FailedProductCode,
    '-LauncherProcessId',
    [string]$LauncherProcessId,
    '-FailedPackagePath',
    $FailedPackagePath,
    '-RollbackPackagePath',
    $RollbackPackagePath
  )
  if (![string]::IsNullOrWhiteSpace($ProgressPath)) {
    $arguments += @('-ProgressPath', $ProgressPath)
  }
  $nativeArguments = @(
    foreach ($argument in $arguments) {
      ConvertTo-NativeArgument -Value $argument
    }
  )

  $helper = Start-Process -FilePath $powerShellPath `
    -ArgumentList $nativeArguments -WindowStyle Hidden -PassThru
  # Start-Process owns the independent Windows process creation. The helper
  # reports its later rollback phases through the private proof channel.
  $helper.Dispose()

  [Console]::Out.WriteLine('EKY_ROLLBACK_HELPER_STARTED')
  exit 0
} catch {
  exit 30
}

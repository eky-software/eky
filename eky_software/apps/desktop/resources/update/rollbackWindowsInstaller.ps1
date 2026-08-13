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

  [Parameter(Mandatory = $false)]
  [string]$ProgressPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:ProgressFilePath = $null
$script:ProgressClock = [System.Diagnostics.Stopwatch]::StartNew()

function Initialize-RollbackProgress {
  if ([string]::IsNullOrWhiteSpace($ProgressPath)) {
    return
  }
  try {
    if ($ProgressPath.IndexOf([char]0) -ge 0) {
      return
    }
    $resolved = [System.IO.Path]::GetFullPath($ProgressPath)
    if (
      $resolved -cne $ProgressPath -or
      [System.IO.Path]::GetExtension($resolved).ToLowerInvariant() -ne '.jsonl'
    ) {
      return
    }
    $parent = Get-Item -LiteralPath ([System.IO.Path]::GetDirectoryName($resolved)) -Force
    if (
      !$parent.PSIsContainer -or
      (($parent.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
    ) {
      return
    }
    if (Test-Path -LiteralPath $resolved) {
      $existing = Get-Item -LiteralPath $resolved -Force
      if (
        $existing.PSIsContainer -or
        (($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
      ) {
        return
      }
    }
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($resolved, '', $encoding)
    $script:ProgressFilePath = $resolved
  } catch {
    $script:ProgressFilePath = $null
  }
}

function Write-RollbackProgress {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
      'inputValidation',
      'launcherExitWait',
      'failedPackageUninstall',
      'rollbackPackageInstall',
      'failedPackageRepair'
    )]
    [string]$Phase,

    [Parameter(Mandatory = $true)]
    [ValidateSet('started', 'completed', 'failed')]
    [string]$Event,

    [Parameter(Mandatory = $true)]
    [long]$DurationMs
  )

  if ($null -eq $script:ProgressFilePath) {
    return
  }
  try {
    $payload = [ordered]@{
      event = $Event
      phase = $Phase
      durationMs = [Math]::Max(0, $DurationMs)
      elapsedMs = [Math]::Max(0, $script:ProgressClock.ElapsedMilliseconds)
    }
    $line = $payload | ConvertTo-Json -Compress
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::AppendAllText(
      $script:ProgressFilePath,
      $line + [Environment]::NewLine,
      $encoding
    )
  } catch {
    # Test progress must never change rollback behavior.
  }
}

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

  $nativeArguments = @()
  foreach ($argument in $Arguments) {
    if ($null -eq $argument -or $argument.IndexOf([char]0) -ge 0 -or $argument.Contains('"')) {
      throw 'ROLLBACK_ARGUMENT_INVALID'
    }
    $nativeArguments += if ($argument -match '\s') { '"' + $argument + '"' } else { $argument }
  }
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $MsiExecPath
  $startInfo.Arguments = $nativeArguments -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (!$process.Start()) {
      return 1603
    }
    $process.WaitForExit()
    return [int]$process.ExitCode
  } finally {
    $process.Dispose()
  }
}

function Wait-LauncherProcessExit {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  $launcher = $null
  try {
    try {
      $launcher = [System.Diagnostics.Process]::GetProcessById($ProcessId)
    } catch [System.ArgumentException] {
      return $true
    }
    return $launcher.WaitForExit(30000)
  } catch {
    return $false
  } finally {
    if ($null -ne $launcher) {
      $launcher.Dispose()
    }
  }
}

Initialize-RollbackProgress

try {
  $phaseStartedAt = $script:ProgressClock.ElapsedMilliseconds
  Write-RollbackProgress -Phase 'inputValidation' -Event 'started' -DurationMs 0
  try {
    Assert-RegularFile -Path $MsiExecPath -Extension '.exe'
  } catch {
    Write-RollbackProgress -Phase 'inputValidation' -Event 'failed' `
      -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)
    exit 24
  }
  try {
    Assert-RegularFile -Path $FailedPackagePath -Extension '.msi'
  } catch {
    Write-RollbackProgress -Phase 'inputValidation' -Event 'failed' `
      -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)
    exit 25
  }
  try {
    Assert-RegularFile -Path $RollbackPackagePath -Extension '.msi'
  } catch {
    Write-RollbackProgress -Phase 'inputValidation' -Event 'failed' `
      -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)
    exit 26
  }
  Write-RollbackProgress -Phase 'inputValidation' -Event 'completed' `
    -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)

  $phaseStartedAt = $script:ProgressClock.ElapsedMilliseconds
  Write-RollbackProgress -Phase 'launcherExitWait' -Event 'started' -DurationMs 0
  if (!(Wait-LauncherProcessExit -ProcessId $LauncherProcessId)) {
    Write-RollbackProgress -Phase 'launcherExitWait' -Event 'failed' `
      -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)
    exit 27
  }
  Write-RollbackProgress -Phase 'launcherExitWait' -Event 'completed' `
    -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)

  $phaseStartedAt = $script:ProgressClock.ElapsedMilliseconds
  Write-RollbackProgress -Phase 'failedPackageUninstall' -Event 'started' -DurationMs 0
  $uninstallExitCode = Invoke-MsiExec -Arguments @(
    '/x', $FailedProductCode, '/qn', '/norestart'
  )
  if ($uninstallExitCode -ne 0) {
    Write-RollbackProgress -Phase 'failedPackageUninstall' -Event 'failed' `
      -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)
    exit 20
  }
  Write-RollbackProgress -Phase 'failedPackageUninstall' -Event 'completed' `
    -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)

  $phaseStartedAt = $script:ProgressClock.ElapsedMilliseconds
  Write-RollbackProgress -Phase 'rollbackPackageInstall' -Event 'started' -DurationMs 0
  $rollbackExitCode = Invoke-MsiExec -Arguments @(
    '/i', $RollbackPackagePath, '/qn', '/norestart'
  )
  if ($rollbackExitCode -eq 0) {
    Write-RollbackProgress -Phase 'rollbackPackageInstall' -Event 'completed' `
      -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)
    exit 0
  }
  Write-RollbackProgress -Phase 'rollbackPackageInstall' -Event 'failed' `
    -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)

  $phaseStartedAt = $script:ProgressClock.ElapsedMilliseconds
  Write-RollbackProgress -Phase 'failedPackageRepair' -Event 'started' -DurationMs 0
  $repairExitCode = Invoke-MsiExec -Arguments @(
    '/i', $FailedPackagePath, '/qn', '/norestart'
  )
  if ($repairExitCode -eq 0) {
    Write-RollbackProgress -Phase 'failedPackageRepair' -Event 'completed' `
      -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)
    exit 21
  }
  Write-RollbackProgress -Phase 'failedPackageRepair' -Event 'failed' `
    -DurationMs ($script:ProgressClock.ElapsedMilliseconds - $phaseStartedAt)
  exit 22
} catch {
  exit 23
}

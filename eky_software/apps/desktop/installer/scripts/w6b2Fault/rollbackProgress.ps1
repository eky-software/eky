Set-StrictMode -Version Latest

$script:W6b2RollbackProgressPhases = @(
  'inputValidation',
  'launcherExitWait',
  'failedPackageUninstall',
  'rollbackPackageInstall',
  'failedPackageRepair'
)
$script:W6b2RollbackProgressEvents = @('started', 'completed', 'failed')
$script:W6b2RollbackProgressResultCodes = @{
  'inputValidation:started' = 'rollbackInputValidationStarted'
  'inputValidation:completed' = 'rollbackInputValidationCompleted'
  'inputValidation:failed' = 'rollbackInputValidationFailed'
  'launcherExitWait:started' = 'rollbackLauncherExitWaitStarted'
  'launcherExitWait:completed' = 'rollbackLauncherExitWaitCompleted'
  'launcherExitWait:failed' = 'rollbackLauncherExitWaitFailed'
  'failedPackageUninstall:started' = 'rollbackFailedPackageUninstallStarted'
  'failedPackageUninstall:completed' = 'rollbackFailedPackageUninstallCompleted'
  'failedPackageUninstall:failed' = 'rollbackFailedPackageUninstallFailed'
  'rollbackPackageInstall:started' = 'rollbackPackageInstallStarted'
  'rollbackPackageInstall:completed' = 'rollbackPackageInstallCompleted'
  'rollbackPackageInstall:failed' = 'rollbackPackageInstallFailed'
  'failedPackageRepair:started' = 'rollbackFailedPackageRepairStarted'
  'failedPackageRepair:completed' = 'rollbackFailedPackageRepairCompleted'
  'failedPackageRepair:failed' = 'rollbackFailedPackageRepairFailed'
}

function Resolve-W6b2FaultRollbackProgressPath {
  param([Parameter(Mandatory = $true)][string]$ProofRoot)

  $resultRoot = Assert-W6b2SuccessCanonicalDirectory `
    -Path (Join-Path $ProofRoot 'result')
  return Join-Path $resultRoot 'w6b2-rollback-installer-progress.jsonl'
}

function Publish-W6b2FaultRollbackProgress {
  param([Parameter(Mandatory = $true)]$Context)

  try {
    $records = @(Read-W6b2FaultRollbackProgress `
      -Path $Context.RollbackProgressPath)
    if ($records.Count -lt $Context.RollbackProgressReportedCount) {
      return
    }
    for (
      $index = $Context.RollbackProgressReportedCount;
      $index -lt $records.Count;
      $index += 1
    ) {
      $record = $records[$index]
      $key = "$($record.phase):$($record.event)"
      $resultCode = $script:W6b2RollbackProgressResultCodes[$key]
      if ([string]::IsNullOrEmpty($resultCode)) {
        return
      }
      Write-W6b2FaultObservation -ResultCode $resultCode
    }
    $Context.RollbackProgressReportedCount = $records.Count
  } catch {
    # Test observability must never change the rollback result.
  }
}

function Read-W6b2FaultRollbackProgress {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (!(Test-Path -LiteralPath $Path)) {
    return @()
  }
  $item = Get-Item -LiteralPath $Path -Force
  if (
    $item.PSIsContainer -or
    ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    !$item.FullName.Equals(
      [IO.Path]::GetFullPath($Path),
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    $item.Length -gt (16 * 1024)
  ) {
    throw 'W6B2_FAULT_ROLLBACK_PROGRESS_INVALID'
  }

  $encoding = [Text.UTF8Encoding]::new($false, $true)
  $text = $encoding.GetString([IO.File]::ReadAllBytes($item.FullName))
  if ($text.IndexOf([char]0) -ge 0) {
    throw 'W6B2_FAULT_ROLLBACK_PROGRESS_INVALID'
  }
  $normalized = $text.Replace("`r`n", "`n")
  if (!$normalized.EndsWith("`n")) {
    $lastNewline = $normalized.LastIndexOf("`n")
    $normalized = if ($lastNewline -lt 0) {
      ''
    }
    else {
      $normalized.Substring(0, $lastNewline + 1)
    }
  }
  $lines = @($normalized.Split("`n") | Where-Object { $_.Length -gt 0 })
  if ($lines.Count -gt 16) {
    throw 'W6B2_FAULT_ROLLBACK_PROGRESS_INVALID'
  }

  $records = @()
  foreach ($line in $lines) {
    try {
      $value = ConvertFrom-Json -InputObject $line
    } catch {
      throw 'W6B2_FAULT_ROLLBACK_PROGRESS_INVALID'
    }
    $keys = @($value.PSObject.Properties.Name | Sort-Object)
    if (
      @(Compare-Object $keys @('durationMs', 'elapsedMs', 'event', 'phase')).Count -ne 0 -or
      $script:W6b2RollbackProgressPhases -cnotcontains [string]$value.phase -or
      $script:W6b2RollbackProgressEvents -cnotcontains [string]$value.event -or
      !($value.durationMs -is [ValueType]) -or
      !($value.elapsedMs -is [ValueType]) -or
      [string]$value.durationMs -cnotmatch '^\d+$' -or
      [string]$value.elapsedMs -cnotmatch '^\d+$' -or
      [long]$value.durationMs -gt 3600000 -or
      [long]$value.elapsedMs -gt 3600000
    ) {
      throw 'W6B2_FAULT_ROLLBACK_PROGRESS_INVALID'
    }
    $records += [pscustomobject]@{
      durationMs = [long]$value.durationMs
      elapsedMs = [long]$value.elapsedMs
      event = [string]$value.event
      phase = [string]$value.phase
    }
  }
  return $records
}

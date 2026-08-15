Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerUpgradeAttempt.ps1')

function Assert-Equal {
  param($Actual, $Expected, [string]$Code)
  if ($Actual -ne $Expected) {
    throw $Code
  }
}

function Assert-ThrowsCode {
  param([scriptblock]$Action, [string]$ExpectedCode)
  try {
    & $Action
  }
  catch {
    if ($_.Exception.Message -ne $ExpectedCode) {
      throw 'INSTALLER_UPGRADE_HARNESS_UNEXPECTED_ERROR'
    }
    return
  }
  throw 'INSTALLER_UPGRADE_HARNESS_EXPECTED_ERROR_MISSING'
}

Assert-Equal (Get-EkyUpgradeAttemptOutcome -State running -ExitCode $null) `
  'waitingForApplicationExit' 'INSTALLER_UPGRADE_HARNESS_RUNNING_INVALID'
Assert-Equal (Get-EkyUpgradeAttemptOutcome -State exited -ExitCode 0) `
  'succeeded' 'INSTALLER_UPGRADE_HARNESS_SUCCESS_INVALID'
Assert-Equal (Get-EkyUpgradeAttemptOutcome -State exited -ExitCode 1603) `
  'blockedCandidate' 'INSTALLER_UPGRADE_HARNESS_BLOCKED_INVALID'
Assert-ThrowsCode { Get-EkyUpgradeAttemptOutcome -State exited -ExitCode 1641 } `
  'INSTALLER_UPGRADE_RESTART_REQUIRED_FORBIDDEN'
Assert-ThrowsCode { Get-EkyUpgradeAttemptOutcome -State exited -ExitCode 3010 } `
  'INSTALLER_UPGRADE_RESTART_REQUIRED_FORBIDDEN'
Assert-ThrowsCode { Get-EkyUpgradeAttemptOutcome -State exited -ExitCode 87 } `
  'INSTALLER_UPGRADE_UNEXPECTED_EXIT_CODE'
Assert-ThrowsCode { Get-EkyUpgradeAttemptOutcome -State running -ExitCode 0 } `
  'INSTALLER_UPGRADE_RUNNING_EXIT_CODE_INVALID'

$immediate = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-Command', 'exit 0'
) -WindowStyle Hidden -PassThru
$immediateResult = Wait-EkyUpgradeAttempt -Process $immediate `
  -TimeoutMilliseconds 5000
Assert-Equal $immediateResult.state 'exited' `
  'INSTALLER_UPGRADE_HARNESS_IMMEDIATE_STATE_INVALID'
Assert-Equal $immediateResult.exitCode 0 `
  'INSTALLER_UPGRADE_HARNESS_IMMEDIATE_EXIT_INVALID'

$delayed = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-Command',
  'Start-Sleep -Milliseconds 500; exit 0'
) -WindowStyle Hidden -PassThru
try {
  $observation = Wait-EkyUpgradeAttempt -Process $delayed `
    -TimeoutMilliseconds 25 -PollMilliseconds 10
  Assert-Equal $observation.state 'running' `
    'INSTALLER_UPGRADE_HARNESS_OBSERVATION_STATE_INVALID'
  $terminal = Wait-EkyUpgradeAttempt -Process $delayed `
    -TimeoutMilliseconds 5000
  Assert-Equal $terminal.state 'exited' `
    'INSTALLER_UPGRADE_HARNESS_TERMINAL_STATE_INVALID'
  Assert-Equal $terminal.exitCode 0 `
    'INSTALLER_UPGRADE_HARNESS_TERMINAL_EXIT_INVALID'
}
finally {
  Stop-EkyUpgradeAttempt -Process $delayed
}

$stuck = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30'
) -WindowStyle Hidden -PassThru
try {
  $deadline = Wait-EkyUpgradeAttempt -Process $stuck `
    -TimeoutMilliseconds 25 -PollMilliseconds 10
  Assert-Equal $deadline.state 'running' `
    'INSTALLER_UPGRADE_HARNESS_DEADLINE_STATE_INVALID'
}
finally {
  Stop-EkyUpgradeAttempt -Process $stuck
}

$progress = Write-EkyUpgradeProgress -Stage runningUpgradeStarted `
  -Status completed -DurationMs 12 -ResultCode started
$progressRecord = $progress | ConvertFrom-Json
Assert-Equal $progressRecord.stage 'runningUpgradeStarted' `
  'INSTALLER_UPGRADE_HARNESS_PROGRESS_STAGE_INVALID'
Assert-Equal $progressRecord.status 'completed' `
  'INSTALLER_UPGRADE_HARNESS_PROGRESS_STATUS_INVALID'
Assert-Equal $progressRecord.durationMs 12 `
  'INSTALLER_UPGRADE_HARNESS_PROGRESS_DURATION_INVALID'
Assert-Equal $progressRecord.resultCode 'started' `
  'INSTALLER_UPGRADE_HARNESS_PROGRESS_RESULT_INVALID'
if ($progress -match '(?i)(stack|\\users\\|\.msi|productcode|sha256|pid)') {
  throw 'INSTALLER_UPGRADE_HARNESS_PROGRESS_LEAK'
}
Assert-ThrowsCode {
  Write-EkyUpgradeProgress -Stage unknown -Status completed `
    -DurationMs 0 -ResultCode completed
} 'INSTALLER_UPGRADE_PROGRESS_STAGE_INVALID'
Assert-ThrowsCode {
  Write-EkyUpgradeProgress -Stage runningUpgradeStarted -Status unknown `
    -DurationMs 0 -ResultCode completed
} 'INSTALLER_UPGRADE_PROGRESS_STATUS_INVALID'
Assert-ThrowsCode {
  Write-EkyUpgradeProgress -Stage runningUpgradeStarted -Status completed `
    -DurationMs 0 -ResultCode unknown
} 'INSTALLER_UPGRADE_PROGRESS_RESULT_INVALID'

[ordered]@{
  boundedWait = $true
  progressContract = $true
  resultClassification = $true
} | ConvertTo-Json -Compress

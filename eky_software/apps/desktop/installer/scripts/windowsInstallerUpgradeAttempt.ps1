Set-StrictMode -Version Latest

$script:EkyUpgradeProgressStages = @(
  'runningApplicationStarted',
  'runningUpgradeStarted',
  'runningUpgradeCompletedWhileRunning',
  'runningUpgradeWaitingForApplicationExit',
  'testApplicationShutdownStarted',
  'testApplicationShutdownCompleted',
  'runningUpgradeExitWaitStarted',
  'runningUpgradeExitWaitCompleted',
  'runningUpgradeOutcomeVerified'
)
$script:EkyUpgradeProgressStatuses = @('started', 'completed', 'failed')
$script:EkyUpgradeResultCodes = @(
  'blockedCandidate',
  'blockedCleanly',
  'completed',
  'failedSafe',
  'started',
  'succeeded',
  'waitingForApplicationExit'
)

function Write-EkyUpgradeProgress {
  param(
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][string]$Status,
    [Parameter(Mandatory = $true)][long]$DurationMs,
    [Parameter(Mandatory = $true)][string]$ResultCode
  )

  if ($Stage -notin $script:EkyUpgradeProgressStages) {
    throw 'INSTALLER_UPGRADE_PROGRESS_STAGE_INVALID'
  }
  if ($Status -notin $script:EkyUpgradeProgressStatuses) {
    throw 'INSTALLER_UPGRADE_PROGRESS_STATUS_INVALID'
  }
  if ($DurationMs -lt 0) {
    throw 'INSTALLER_UPGRADE_PROGRESS_DURATION_INVALID'
  }
  if ($ResultCode -notin $script:EkyUpgradeResultCodes) {
    throw 'INSTALLER_UPGRADE_PROGRESS_RESULT_INVALID'
  }

  [ordered]@{
    stage = $Stage
    status = $Status
    durationMs = $DurationMs
    resultCode = $ResultCode
  } | ConvertTo-Json -Compress
}

function Start-EkyUpgradeAttempt {
  param(
    [Parameter(Mandatory = $true)][string]$MsiPath,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  return Start-Process -FilePath 'msiexec.exe' -ArgumentList @(
    '/i',
    "`"$MsiPath`"",
    '/qn',
    '/norestart',
    '/l*v',
    "`"$LogPath`""
  ) -NoNewWindow -PassThru
}

function Wait-EkyUpgradeAttempt {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds,
    [int]$PollMilliseconds = 100
  )

  if ($TimeoutMilliseconds -lt 1 -or $PollMilliseconds -lt 1) {
    throw 'INSTALLER_UPGRADE_WAIT_CONFIGURATION_INVALID'
  }

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    do {
      $Process.Refresh()
      if ($Process.HasExited) {
        return [pscustomobject]@{
          state = 'exited'
          exitCode = [int]$Process.ExitCode
          durationMs = [long]$stopwatch.ElapsedMilliseconds
        }
      }
      if ($stopwatch.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
        return [pscustomobject]@{
          state = 'running'
          exitCode = $null
          durationMs = [long]$stopwatch.ElapsedMilliseconds
        }
      }
      Start-Sleep -Milliseconds $PollMilliseconds
    } while ($true)
  }
  finally {
    $stopwatch.Stop()
  }
}

function Get-EkyUpgradeAttemptOutcome {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('exited', 'running')]
    [string]$State,
    [AllowNull()][Nullable[int]]$ExitCode
  )

  if ($State -eq 'running') {
    if ($null -ne $ExitCode) {
      throw 'INSTALLER_UPGRADE_RUNNING_EXIT_CODE_INVALID'
    }
    return 'waitingForApplicationExit'
  }
  if ($null -eq $ExitCode) {
    throw 'INSTALLER_UPGRADE_EXIT_CODE_MISSING'
  }
  if ($ExitCode -eq 0) {
    return 'succeeded'
  }
  if ($ExitCode -in @(1641, 3010)) {
    throw 'INSTALLER_UPGRADE_RESTART_REQUIRED_FORBIDDEN'
  }
  if ($ExitCode -eq 1603) {
    return 'blockedCandidate'
  }
  throw 'INSTALLER_UPGRADE_UNEXPECTED_EXIT_CODE'
}

function Stop-EkyUpgradeAttempt {
  param(
    [AllowNull()]$Process,
    [int]$TimeoutMilliseconds = 5000
  )

  if ($null -eq $Process) {
    return
  }
  $Process.Refresh()
  if ($Process.HasExited) {
    return
  }
  Stop-Process -Id $Process.Id -Force -ErrorAction Stop
  $result = Wait-EkyUpgradeAttempt -Process $Process `
    -TimeoutMilliseconds $TimeoutMilliseconds
  if ($result.state -ne 'exited') {
    throw 'INSTALLER_UPGRADE_MSI_PROCESS_REMAINS'
  }
}

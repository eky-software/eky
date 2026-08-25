Set-StrictMode -Version Latest

$script:W6b2SuccessScenario = 'packagedWorkspaceSuccess'
$script:W6b2SuccessStages = @(
  'preflight',
  'sourceInstall',
  'profilePreparation',
  'sourceHandoff',
  'targetInstall',
  'targetFirstStart',
  'switchToB',
  'verifyBRestart',
  'switchToA',
  'rejectC',
  'cleanup'
)
$script:W6b2SuccessProgressStages = @('scenario') + $script:W6b2SuccessStages
$script:W6b2SuccessStatuses = @(
  'started',
  'observed',
  'completed',
  'failed',
  'heartbeat'
)
$script:W6b2SuccessResultCodes = @(
  'scenarioStarted',
  'scenarioCompleted',
  'scenarioFailed',
  'started',
  'preflightCompleted',
  'sourceInstalled',
  'profilePrepared',
  'handoffCompleted',
  'targetInstalled',
  'targetAccepted',
  'workspaceBActive',
  'workspaceAActive',
  'recoveryRejected',
  'cleanupCompleted',
  'alive',
  'preflightFailed',
  'sourceInstallFailed',
  'profilePreparationFailed',
  'sourceHandoffFailed',
  'targetInstallFailed',
  'targetFirstStartFailed',
  'switchToBFailed',
  'verifyBRestartFailed',
  'switchToAFailed',
  'rejectCFailed',
  'cleanupFailed'
)
$script:W6b2SuccessFailureCodes = @{
  preflight = 'preflightFailed'
  sourceInstall = 'sourceInstallFailed'
  profilePreparation = 'profilePreparationFailed'
  sourceHandoff = 'sourceHandoffFailed'
  targetInstall = 'targetInstallFailed'
  targetFirstStart = 'targetFirstStartFailed'
  switchToB = 'switchToBFailed'
  verifyBRestart = 'verifyBRestartFailed'
  switchToA = 'switchToAFailed'
  rejectC = 'rejectCFailed'
  cleanup = 'cleanupFailed'
}
$script:W6b2SuccessStartedAt = [DateTime]::UtcNow
$script:W6b2SuccessStageStartedAt = $script:W6b2SuccessStartedAt
$script:W6b2SuccessCurrentStage = $null
$script:W6b2SuccessCurrentStageTerminal = $true
$script:W6b2SuccessLastHeartbeatAt = $script:W6b2SuccessStartedAt
$script:W6b2SuccessScenarioStarted = $false
$script:W6b2SuccessScenarioTerminal = $false

function Write-W6b2SuccessProgress {
  param(
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][string]$Status,
    [Parameter(Mandatory = $true)][string]$ResultCode
  )

  if (
    $script:W6b2SuccessProgressStages -cnotcontains $Stage -or
    $script:W6b2SuccessStatuses -cnotcontains $Status -or
    $script:W6b2SuccessResultCodes -cnotcontains $ResultCode
  ) {
    throw 'W6B2_SUCCESS_PROGRESS_INVALID'
  }
  $now = [DateTime]::UtcNow
  $line = [ordered]@{
    scenario = $script:W6b2SuccessScenario
    stage = $Stage
    status = $Status
    resultCode = $ResultCode
    durationMs = [long]($now - $script:W6b2SuccessStageStartedAt).TotalMilliseconds
    elapsedMs = [long]($now - $script:W6b2SuccessStartedAt).TotalMilliseconds
  }
  Write-Output (ConvertTo-Json -InputObject $line -Compress)
}

function Start-W6b2SuccessScenario {
  if (
    $script:W6b2SuccessScenarioStarted -or
    $script:W6b2SuccessScenarioTerminal
  ) {
    throw 'W6B2_SUCCESS_PROGRESS_INVALID'
  }
  $script:W6b2SuccessScenarioStarted = $true
  Write-W6b2SuccessProgress -Stage scenario -Status started `
    -ResultCode scenarioStarted
}

function Complete-W6b2SuccessScenario {
  if (
    !$script:W6b2SuccessScenarioStarted -or
    $script:W6b2SuccessScenarioTerminal
  ) {
    throw 'W6B2_SUCCESS_PROGRESS_INVALID'
  }
  Write-W6b2SuccessProgress -Stage scenario -Status completed `
    -ResultCode scenarioCompleted
  $script:W6b2SuccessScenarioTerminal = $true
}

function Fail-W6b2SuccessScenario {
  if (
    !$script:W6b2SuccessScenarioStarted -or
    $script:W6b2SuccessScenarioTerminal
  ) {
    return
  }
  Write-W6b2SuccessProgress -Stage scenario -Status failed `
    -ResultCode scenarioFailed
  $script:W6b2SuccessScenarioTerminal = $true
}

function Start-W6b2SuccessStage {
  param([Parameter(Mandatory = $true)][string]$Stage)

  if (
    $script:W6b2SuccessStages -cnotcontains $Stage -or
    !$script:W6b2SuccessCurrentStageTerminal
  ) {
    throw 'W6B2_SUCCESS_PROGRESS_INVALID'
  }
  $script:W6b2SuccessCurrentStage = $Stage
  $script:W6b2SuccessStageStartedAt = [DateTime]::UtcNow
  $script:W6b2SuccessLastHeartbeatAt = $script:W6b2SuccessStageStartedAt
  $script:W6b2SuccessCurrentStageTerminal = $false
  Write-W6b2SuccessProgress -Stage $Stage -Status started -ResultCode started
}

function Complete-W6b2SuccessStage {
  param([Parameter(Mandatory = $true)][string]$ResultCode)

  if ($script:W6b2SuccessCurrentStageTerminal) {
    throw 'W6B2_SUCCESS_PROGRESS_INVALID'
  }
  Write-W6b2SuccessProgress -Stage $script:W6b2SuccessCurrentStage `
    -Status completed -ResultCode $ResultCode
  $script:W6b2SuccessCurrentStageTerminal = $true
}

function Fail-W6b2SuccessStage {
  if ($script:W6b2SuccessCurrentStageTerminal) {
    return
  }
  $resultCode = $script:W6b2SuccessFailureCodes[
    $script:W6b2SuccessCurrentStage
  ]
  if ([string]::IsNullOrEmpty([string]$resultCode)) {
    throw 'W6B2_SUCCESS_PROGRESS_INVALID'
  }
  Write-W6b2SuccessProgress -Stage $script:W6b2SuccessCurrentStage `
    -Status failed -ResultCode $resultCode
  $script:W6b2SuccessCurrentStageTerminal = $true
}

function Write-W6b2SuccessObservation {
  param([Parameter(Mandatory = $true)][string]$ResultCode)

  Write-W6b2SuccessProgress -Stage $script:W6b2SuccessCurrentStage `
    -Status observed -ResultCode $ResultCode
}

function Write-W6b2SuccessHeartbeat {
  if ($script:W6b2SuccessCurrentStageTerminal) {
    return
  }
  $now = [DateTime]::UtcNow
  if (($now - $script:W6b2SuccessLastHeartbeatAt).TotalSeconds -lt 60) {
    return
  }
  Write-W6b2SuccessProgress -Stage $script:W6b2SuccessCurrentStage `
    -Status heartbeat -ResultCode alive
  $script:W6b2SuccessLastHeartbeatAt = $now
}

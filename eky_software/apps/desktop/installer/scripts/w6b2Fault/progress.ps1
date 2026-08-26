Set-StrictMode -Version Latest

$script:W6b2FaultProgressStages = @(
  'scenario',
  'preflight',
  'sourceInstall',
  'profilePreparation',
  'sourceHandoff',
  'targetInstall',
  'targetFirstStartFailure',
  'businessRollbackPreparation',
  'businessRollbackCompletion',
  'rollbackFirstStart',
  'acceptanceInterruption',
  'acceptanceRecovery',
  'acceptanceRestart',
  'targetFirstStart',
  'switchToB',
  'passiveMigrationFailure',
  'passiveRecovery',
  'binaryRollbackFailure',
  'failedSafeVerification',
  'packageVerification',
  'terminalVerification',
  'cleanup'
)
$script:W6b2FaultProgressStatuses = @(
  'started',
  'observed',
  'completed',
  'failed',
  'heartbeat'
)
$script:W6b2FaultResultCodes = @(
  'scenarioStarted',
  'scenarioCompleted',
  'scenarioFailed',
  'started',
  'completed',
  'stageFailed',
  'alive',
  'preflightValidated',
  'sourceInstalled',
  'profilePrepared',
  'handoffCompleted',
  'targetInstalled',
  'expectedFaultObserved',
  'rollbackPrepared',
  'rollbackCompleted',
  'sourceRestored',
  'interruptionObserved',
  'recoveryPrepared',
  'targetAccepted',
  'workspaceSwitchPrepared',
  'workspaceRecovered',
  'failedSafeObserved',
  'productStateVerified',
  'payloadVerified',
  'registrationVerified',
  'packageHashesVerified',
  'packageVerified',
  'profileVerified',
  'cleanupOwnedProcessesStarted',
  'cleanupOwnedProcessesCompleted',
  'cleanupSourceProcessStarted',
  'cleanupSourceProcessCompleted',
  'cleanupTargetPackageStarted',
  'cleanupTargetPackageCompleted',
  'cleanupSourcePackageStarted',
  'cleanupSourcePackageCompleted',
  'cleanupPostconditionsStarted',
  'cleanupPostconditionsCompleted',
  'cleanupCompleted'
)
$script:W6b2FaultSafeErrorCodes = @(
  'W6B2_FAULT_CONTROL_INVALID',
  'W6B2_FAULT_INSTALLER_FAILED',
  'W6B2_FAULT_PHASE_INVALID',
  'W6B2_FAULT_PROCESS_FAILED',
  'W6B2_FAULT_PROFILE_RESULT_INVALID',
  'W6B2_FAULT_PROFILE_VERIFICATION_FAILED',
  'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED',
  'W6B2_FAULT_PROOF_HANDOFF_FAILED',
  'W6B2_FAULT_PROOF_JOURNAL_STATE_INVALID',
  'W6B2_FAULT_PROOF_PACKAGE_STAGE_FAILED',
  'W6B2_FAULT_PROOF_SHUTDOWN_FAILED',
  'W6B2_FAULT_PROOF_UNEXPECTED',
  'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID',
  'W6B2_FAULT_RESULT_INVALID',
  'W6B2_FAULT_SCENARIO_INVALID',
  'W6B2_FAULT_STATE_INVALID',
  'W6B2_FAULT_UNCLASSIFIED_FAILURE'
)
$script:W6b2FaultScenario = $null
$script:W6b2FaultStartedAt = [DateTime]::UtcNow
$script:W6b2FaultStageStartedAt = $script:W6b2FaultStartedAt
$script:W6b2FaultCurrentStage = $null
$script:W6b2FaultCurrentStageTerminal = $true
$script:W6b2FaultLastHeartbeatAt = $script:W6b2FaultStartedAt
$script:W6b2FaultScenarioTerminal = $false

function Start-W6b2FaultScenario {
  param([Parameter(Mandatory = $true)][string]$FaultScenario)

  if (
    $script:W6b2FaultScenarios -cnotcontains $FaultScenario -or
    $script:W6b2FaultScenarioTerminal
  ) {
    throw 'W6B2_FAULT_SCENARIO_INVALID'
  }
  $script:W6b2FaultScenario = $FaultScenario
  $script:W6b2FaultStartedAt = [DateTime]::UtcNow
  $script:W6b2FaultStageStartedAt = $script:W6b2FaultStartedAt
  Write-W6b2FaultProgress -Stage scenario -Status started `
    -ResultCode scenarioStarted
}

function Complete-W6b2FaultScenario {
  Write-W6b2FaultProgress -Stage scenario -Status completed `
    -ResultCode scenarioCompleted
  $script:W6b2FaultScenarioTerminal = $true
}

function Fail-W6b2FaultScenario {
  if ($script:W6b2FaultScenarioTerminal) { return }
  Write-W6b2FaultProgress -Stage scenario -Status failed `
    -ResultCode scenarioFailed
  $script:W6b2FaultScenarioTerminal = $true
}

function Start-W6b2FaultStage {
  param([Parameter(Mandatory = $true)][string]$Stage)

  if (
    $script:W6b2FaultProgressStages -cnotcontains $Stage -or
    !$script:W6b2FaultCurrentStageTerminal
  ) {
    throw 'W6B2_FAULT_STATE_INVALID'
  }
  $script:W6b2FaultCurrentStage = $Stage
  $script:W6b2FaultStageStartedAt = [DateTime]::UtcNow
  $script:W6b2FaultLastHeartbeatAt = $script:W6b2FaultStageStartedAt
  $script:W6b2FaultCurrentStageTerminal = $false
  Write-W6b2FaultProgress -Stage $Stage -Status started -ResultCode started
}

function Complete-W6b2FaultStage {
  param([string]$ResultCode = 'completed')

  if ($script:W6b2FaultCurrentStageTerminal) {
    throw 'W6B2_FAULT_STATE_INVALID'
  }
  Write-W6b2FaultProgress -Stage $script:W6b2FaultCurrentStage `
    -Status completed -ResultCode $ResultCode
  $script:W6b2FaultCurrentStageTerminal = $true
}

function Fail-W6b2FaultStage {
  param($ErrorRecord = $null)

  if ($script:W6b2FaultCurrentStageTerminal) { return }
  Write-W6b2FaultProgress -Stage $script:W6b2FaultCurrentStage `
    -Status failed -ResultCode stageFailed `
    -ErrorCode (Resolve-W6b2FaultSafeErrorCode -ErrorRecord $ErrorRecord)
  $script:W6b2FaultCurrentStageTerminal = $true
}

function Write-W6b2FaultObservation {
  param([Parameter(Mandatory = $true)][string]$ResultCode)

  Write-W6b2FaultProgress -Stage $script:W6b2FaultCurrentStage `
    -Status observed -ResultCode $ResultCode
}

function Write-W6b2FaultProgress {
  param(
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][string]$Status,
    [Parameter(Mandatory = $true)][string]$ResultCode,
    [string]$ErrorCode = ''
  )

  if (
    $script:W6b2FaultScenarios -cnotcontains $script:W6b2FaultScenario -or
    $script:W6b2FaultProgressStages -cnotcontains $Stage -or
    $script:W6b2FaultProgressStatuses -cnotcontains $Status -or
    $script:W6b2FaultResultCodes -cnotcontains $ResultCode -or
    (![string]::IsNullOrEmpty($ErrorCode) -and (
      $Status -cne 'failed' -or
      $script:W6b2FaultSafeErrorCodes -cnotcontains $ErrorCode
    ))
  ) {
    throw 'W6B2_FAULT_STATE_INVALID'
  }
  $now = [DateTime]::UtcNow
  $line = [ordered]@{
    scenario = $script:W6b2FaultScenario
    stage = $Stage
    status = $Status
    resultCode = $ResultCode
    durationMs = [long]($now - $script:W6b2FaultStageStartedAt).TotalMilliseconds
    elapsedMs = [long]($now - $script:W6b2FaultStartedAt).TotalMilliseconds
  }
  if (![string]::IsNullOrEmpty($ErrorCode)) {
    $line['errorCode'] = $ErrorCode
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $line -Compress))
}

function Resolve-W6b2FaultSafeErrorCode {
  param($ErrorRecord)

  $candidate = if ($null -eq $ErrorRecord) {
    ''
  }
  else {
    [string]$ErrorRecord.Exception.Message
  }
  if ($script:W6b2FaultSafeErrorCodes -ccontains $candidate) {
    return $candidate
  }
  if ($candidate -cmatch '^W6B2_SUCCESS_(PROCESS|OWNED|RESULT)_') {
    return 'W6B2_FAULT_PROCESS_FAILED'
  }
  if ($candidate -cmatch '^W6B2_(SUCCESS|FAULT)_PROFILE_') {
    return 'W6B2_FAULT_PROFILE_VERIFICATION_FAILED'
  }
  if (
    $candidate -cmatch '^W6B2_SUCCESS_(SOURCE|TARGET|UNINSTALL|PRODUCT|PACKAGE|PAYLOAD|SHORTCUT|INSTALL)' -or
    $candidate -cmatch '^INSTALLER_'
  ) {
    return 'W6B2_FAULT_INSTALLER_FAILED'
  }
  return 'W6B2_FAULT_UNCLASSIFIED_FAILURE'
}

function Write-W6b2SuccessHeartbeat {
  if ($script:W6b2FaultCurrentStageTerminal) { return }
  $now = [DateTime]::UtcNow
  if (($now - $script:W6b2FaultLastHeartbeatAt).TotalSeconds -lt 60) {
    return
  }
  Write-W6b2FaultProgress -Stage $script:W6b2FaultCurrentStage `
    -Status heartbeat -ResultCode alive
  $script:W6b2FaultLastHeartbeatAt = $now
}

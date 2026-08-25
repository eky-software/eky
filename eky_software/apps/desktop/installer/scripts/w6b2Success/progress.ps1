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
  'buildRevisionValidated',
  'proofRootResolved',
  'sourcePackageFileResolved',
  'targetPackageFileResolved',
  'payloadRootsResolved',
  'runtimePathsResolved',
  'packageHashesVerified',
  'productCodesValidated',
  'processBoundaryVerified',
  'installationPathsVerified',
  'installerServiceAvailable',
  'productStateVerified',
  'registrationStateVerified',
  'payloadInventoriesVerified',
  'normalProfileInventoried',
  'privateLogsPrepared',
  'preflightCompleted',
  'sourceMsiCompleted',
  'sourceProductStateValidated',
  'targetProductStateValidated',
  'sourcePayloadValidated',
  'sourceRegistrationValidated',
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
$script:W6b2SuccessSafeErrorCodes = @(
  'W6B2_SUCCESS_BUILD_REVISION_INVALID',
  'W6B2_SUCCESS_DIRECTORY_INVALID',
  'W6B2_SUCCESS_EXISTING_INSTALLATION_FORBIDDEN',
  'W6B2_SUCCESS_FILE_INVALID',
  'W6B2_SUCCESS_FOREIGN_PROCESS_PRESENT',
  'W6B2_SUCCESS_INSTALL_ROOT_REMAINS',
  'W6B2_SUCCESS_INVENTORY_CHANGED',
  'W6B2_SUCCESS_INVENTORY_INVALID',
  'W6B2_SUCCESS_NORMAL_PROFILE_INVALID',
  'W6B2_SUCCESS_OWNED_PROCESS_REMAINS',
  'W6B2_SUCCESS_PACKAGE_HASH_MISMATCH',
  'W6B2_SUCCESS_PAYLOAD_INVALID',
  'W6B2_SUCCESS_PHASE_INVALID',
  'W6B2_SUCCESS_PROCESS_ARGUMENT_INVALID',
  'W6B2_SUCCESS_PROCESS_EXITED_BEFORE_RESULT',
  'W6B2_SUCCESS_PROCESS_EXIT_FAILED',
  'W6B2_SUCCESS_PROCESS_IDENTITY_CHANGED',
  'W6B2_SUCCESS_PROCESS_OUTPUT_FAILED',
  'W6B2_SUCCESS_PROCESS_START_FAILED',
  'W6B2_SUCCESS_PROCESS_TIMEOUT',
  'W6B2_SUCCESS_PROCESS_WAIT_INVALID',
  'W6B2_SUCCESS_PRODUCT_CODES_NOT_DISTINCT',
  'W6B2_SUCCESS_PRODUCT_CODE_INVALID',
  'W6B2_SUCCESS_PRODUCT_MISSING',
  'W6B2_SUCCESS_PRODUCT_UNEXPECTED',
  'W6B2_SUCCESS_PROFILE_BUILD_IDENTITY_INVALID',
  'W6B2_SUCCESS_PROFILE_CONFIGURATION_INVALID',
  'W6B2_SUCCESS_PROFILE_ELECTRON_READY_FAILED',
  'W6B2_SUCCESS_PROFILE_INPUT_INVALID',
  'W6B2_SUCCESS_PROFILE_INSTALLATION_INVALID',
  'W6B2_SUCCESS_PROFILE_RUNTIME_PATHS_INVALID',
  'W6B2_SUCCESS_PROFILE_FIXTURE_A_FAILED',
  'W6B2_SUCCESS_PROFILE_FIXTURE_B_FAILED',
  'W6B2_SUCCESS_PROFILE_FIXTURE_C_FAILED',
  'W6B2_SUCCESS_PROFILE_MIGRATION_HISTORY_FAILED',
  'W6B2_SUCCESS_PROFILE_REGISTRY_WRITE_FAILED',
  'W6B2_SUCCESS_PROFILE_ACCEPTED_BUILD_WRITE_FAILED',
  'W6B2_SUCCESS_PROFILE_EVIDENCE_SNAPSHOT_FAILED',
  'W6B2_SUCCESS_PROFILE_STATE_WRITE_FAILED',
  'W6B2_SUCCESS_PROFILE_OPERATION_FAILED',
  'W6B2_SUCCESS_PROFILE_RESULT_INVALID',
  'W6B2_SUCCESS_PROGRESS_INVALID',
  'W6B2_SUCCESS_PROOF_CANDIDATE_STAGE_FAILED',
  'W6B2_SUCCESS_PROOF_CONFIGURATION_INVALID',
  'W6B2_SUCCESS_PROOF_HANDOFF_FAILED',
  'W6B2_SUCCESS_PROOF_INSTALLER_HANDOFF_FAILED',
  'W6B2_SUCCESS_PROOF_PACKAGE_MARKER_INVALID',
  'W6B2_SUCCESS_PROOF_PREPARATION_CONCURRENCY_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_JOURNAL_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_PACKAGE_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_PROFILE_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_PROTECTION_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_ARTIFACTS_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_OPERATION_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_REQUEST_INVALID',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_UNAVAILABLE',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_DATABASE_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_STAGING_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_VALIDATION_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SOURCE_FAILED',
  'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_STORAGE_FAILED',
  'W6B2_SUCCESS_PROOF_QUIT_REQUEST_MISSING',
  'W6B2_SUCCESS_PROOF_REJECTION_FAILED',
  'W6B2_SUCCESS_PROOF_RESULT_INVALID',
  'W6B2_SUCCESS_PROOF_SHUTDOWN_FAILED',
  'W6B2_SUCCESS_PROOF_SOURCE_STAGE_FAILED',
  'W6B2_SUCCESS_PROOF_SWITCH_FAILED',
  'W6B2_SUCCESS_PROOF_TOKEN_INVALID',
  'W6B2_SUCCESS_PROOF_UNEXPECTED',
  'W6B2_SUCCESS_PROOF_WORKSPACE_STATE_INVALID',
  'W6B2_SUCCESS_RESULT_INVALID',
  'W6B2_SUCCESS_RESULT_PENDING',
  'W6B2_SUCCESS_SHORTCUT_REMAINS',
  'W6B2_SUCCESS_SOURCE_INSTALL_CANCELLED',
  'W6B2_SUCCESS_SOURCE_INSTALL_FAILED',
  'W6B2_SUCCESS_SOURCE_INSTALL_INSTALLER_BUSY',
  'W6B2_SUCCESS_SOURCE_INSTALL_INSTALLER_SERVICE_UNAVAILABLE',
  'W6B2_SUCCESS_SOURCE_INSTALL_REBOOT_REQUIRED',
  'W6B2_SUCCESS_SOURCE_INSTALL_RELATED_PRODUCT_PRESENT',
  'W6B2_SUCCESS_SOURCE_PAYLOAD_MISMATCH',
  'W6B2_SUCCESS_SOURCE_REGISTRATION_MISSING',
  'W6B2_SUCCESS_SOURCE_SHORTCUT_MISSING',
  'W6B2_SUCCESS_TARGET_INSTALL_TIMEOUT',
  'W6B2_SUCCESS_TEMP_ROOT_INVALID',
  'W6B2_SUCCESS_UNCLASSIFIED_FAILURE'
)
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
    [Parameter(Mandatory = $true)][string]$ResultCode,
    [string]$ErrorCode = ''
  )

  if (
    $script:W6b2SuccessProgressStages -cnotcontains $Stage -or
    $script:W6b2SuccessStatuses -cnotcontains $Status -or
    $script:W6b2SuccessResultCodes -cnotcontains $ResultCode
  ) {
    throw 'W6B2_SUCCESS_PROGRESS_INVALID'
  }
  if (
    ![string]::IsNullOrEmpty($ErrorCode) -and (
      $Status -cne 'failed' -or
      $script:W6b2SuccessSafeErrorCodes -cnotcontains $ErrorCode
    )
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
  if (![string]::IsNullOrEmpty($ErrorCode)) {
    $line['errorCode'] = $ErrorCode
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
  param($ErrorRecord = $null)

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
    -Status failed -ResultCode $resultCode `
    -ErrorCode (Resolve-W6b2SuccessSafeErrorCode -ErrorRecord $ErrorRecord)
  $script:W6b2SuccessCurrentStageTerminal = $true
}

function Resolve-W6b2SuccessSafeErrorCode {
  param($ErrorRecord)

  if ($null -ne $ErrorRecord) {
    $candidate = [string]$ErrorRecord.Exception.Message
    if ($script:W6b2SuccessSafeErrorCodes -ccontains $candidate) {
      return $candidate
    }
    if (
      $candidate -cmatch '^W6B2_SUCCESS_SOURCE_INSTALL_FAILED:(?<exitCode>[0-9]+)$'
    ) {
      $safeErrorCode = switch -CaseSensitive ($Matches.exitCode) {
        '1601' {
          'W6B2_SUCCESS_SOURCE_INSTALL_INSTALLER_SERVICE_UNAVAILABLE'
        }
        '1602' { 'W6B2_SUCCESS_SOURCE_INSTALL_CANCELLED' }
        '1618' { 'W6B2_SUCCESS_SOURCE_INSTALL_INSTALLER_BUSY' }
        '1638' { 'W6B2_SUCCESS_SOURCE_INSTALL_RELATED_PRODUCT_PRESENT' }
        { $_ -in @('1641', '3010') } {
          'W6B2_SUCCESS_SOURCE_INSTALL_REBOOT_REQUIRED'
        }
        default { 'W6B2_SUCCESS_SOURCE_INSTALL_FAILED' }
      }
      return [string]$safeErrorCode
    }
    if ($script:W6b2SuccessCurrentStage -ceq 'sourceInstall') {
      if ($candidate -cmatch '^INSTALLER_PAYLOAD_MISMATCH:') {
        return 'W6B2_SUCCESS_SOURCE_PAYLOAD_MISMATCH'
      }
      if ($candidate -ceq 'INSTALLER_SHORTCUT_MISSING') {
        return 'W6B2_SUCCESS_SOURCE_SHORTCUT_MISSING'
      }
      if (
        $candidate -in @(
          'INSTALLER_OWNED_REGISTRY_MISSING',
          'INSTALLER_ARP_REGISTRATION_MISSING_OR_AMBIGUOUS',
          'INSTALLER_PRODUCT_REGISTRATION_UNREADABLE'
        )
      ) {
        return 'W6B2_SUCCESS_SOURCE_REGISTRATION_MISSING'
      }
    }
  }
  return 'W6B2_SUCCESS_UNCLASSIFIED_FAILURE'
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

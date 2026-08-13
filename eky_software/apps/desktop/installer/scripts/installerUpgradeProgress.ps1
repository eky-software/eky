Set-StrictMode -Version Latest

$script:EkyInstallerUpgradeProgressPhases = @(
  'fixtureValidated',
  'currentInstallStarted',
  'currentInstallCompleted',
  'runningApplicationStarted',
  'utilityProcessObserved',
  'runningUpgradeStarted',
  'runningUpgradeCompleted',
  'processTreeCleanupStarted',
  'processTreeCleanupCompleted',
  'nextVersionVerified',
  'downgradeVerificationStarted',
  'downgradeVerificationCompleted',
  'coordinatedRollbackStarted',
  'coordinatedRollbackCompleted',
  'unicodePathVerificationCompleted',
  'transactionRollbackStarted',
  'transactionRollbackCompleted',
  'finalCleanupStarted',
  'finalCleanupCompleted'
)

$script:EkyInstallerUpgradeSafeErrorCodes = @(
  'INSTALLER_UPGRADE_BUSINESS_DATA_CHANGED',
  'INSTALLER_UPGRADE_COORDINATED_ROLLBACK_FAILED',
  'INSTALLER_UPGRADE_EKY_PROCESS_EXITED_EARLY',
  'INSTALLER_UPGRADE_EXISTING_INSTALL_ROOT_FORBIDDEN',
  'INSTALLER_UPGRADE_EXPECTED_PRODUCT_MISSING',
  'INSTALLER_UPGRADE_FINAL_ROOT_REMAINS',
  'INSTALLER_UPGRADE_FINAL_SHORTCUT_REMAINS',
  'INSTALLER_UPGRADE_FIXTURE_FORMAT_INVALID',
  'INSTALLER_UPGRADE_FIXTURE_MSI_PATH_INVALID',
  'INSTALLER_UPGRADE_FIXTURE_PAYLOAD_COUNT_INVALID',
  'INSTALLER_UPGRADE_FIXTURE_PAYLOAD_COUNT_MISMATCH',
  'INSTALLER_UPGRADE_FIXTURE_PAYLOAD_ROOT_INVALID',
  'INSTALLER_UPGRADE_FIXTURE_PRODUCT_CODE_INVALID',
  'INSTALLER_UPGRADE_FIXTURE_PRODUCT_CODES_NOT_DISTINCT',
  'INSTALLER_UPGRADE_FIXTURE_SOURCE_INVALID',
  'INSTALLER_UPGRADE_FIXTURE_VERSION_ORDER_INVALID',
  'INSTALLER_UPGRADE_MIXED_VERSION_STATE',
  'INSTALLER_UPGRADE_PROCESS_IDENTITY_INVALID',
  'INSTALLER_UPGRADE_PROCESS_TREE_INVALID',
  'INSTALLER_UPGRADE_PROCESS_TREE_REMAINS',
  'INSTALLER_UPGRADE_PROCESS_TERMINATION_ARGUMENTS_INVALID',
  'INSTALLER_UPGRADE_RELEASE_BYTES_CHANGED',
  'INSTALLER_UPGRADE_RELEASE_IDENTITY_INVALID',
  'INSTALLER_UPGRADE_RESTART_REQUIRED_FORBIDDEN',
  'INSTALLER_UPGRADE_ROLLBACK_PAYLOAD_COUNT_INVALID',
  'INSTALLER_UPGRADE_ROLLBACK_PRODUCT_CODE_INVALID',
  'INSTALLER_UPGRADE_ROLLBACK_REPAIR_RESULT_INVALID',
  'INSTALLER_UPGRADE_ROLLBACK_SCRIPT_MISSING',
  'INSTALLER_UPGRADE_RUNNING_PROCESS_FORBIDDEN',
  'INSTALLER_UPGRADE_RUNNING_PROCESS_OUTCOME_UNKNOWN',
  'INSTALLER_UPGRADE_UNEXPECTED_PRODUCT_PRESENT',
  'INSTALLER_UPGRADE_UNICODE_INSTALL_ROOT_REMAINS',
  'INSTALLER_UPGRADE_UNINSTALL_ROOT_REMAINS',
  'INSTALLER_UPGRADE_BACKEND_UTILITY_PROCESS_MISSING'
)

function New-EkyInstallerUpgradeProgressObserver {
  param(
    [scriptblock]$WriteLine = {
      param([string]$Line)
      [Console]::Out.WriteLine($Line)
    },
    [scriptblock]$GetUtcNow = { [DateTime]::UtcNow }
  )

  $now = & $GetUtcNow
  return [pscustomobject]@{
    ActivePhase = $null
    GetUtcNow = $GetUtcNow
    HarnessStartedAt = $now
    LastHeartbeatAt = $now
    PhaseStartedAt = $null
    WriteLine = $WriteLine
  }
}

function Invoke-EkyInstallerUpgradeProgressPhase {
  param(
    [Parameter(Mandatory = $true)]$Observer,
    [Parameter(Mandatory = $true)][string]$Phase,
    [Parameter(Mandatory = $true)][scriptblock]$Operation
  )

  Assert-EkyInstallerUpgradeProgressPhase -Phase $Phase
  if ($null -ne $Observer.ActivePhase) {
    throw 'INSTALLER_UPGRADE_PROGRESS_NESTED_PHASE_INVALID'
  }
  $startedAt = & $Observer.GetUtcNow
  $Observer.ActivePhase = $Phase
  $Observer.PhaseStartedAt = $startedAt
  $Observer.LastHeartbeatAt = $startedAt
  Write-EkyInstallerUpgradeProgressEvent -Observer $Observer `
    -Event 'phaseStarted' -Phase $Phase -StartedAt $startedAt `
    -CompletedAt $startedAt
  try {
    $result = & $Operation
    $completedAt = & $Observer.GetUtcNow
    Write-EkyInstallerUpgradeProgressEvent -Observer $Observer `
      -Event 'phaseCompleted' -Phase $Phase -StartedAt $startedAt `
      -CompletedAt $completedAt
    return $result
  }
  catch {
    $completedAt = & $Observer.GetUtcNow
    Write-EkyInstallerUpgradeProgressEvent -Observer $Observer `
      -Event 'phaseFailed' -Phase $Phase -StartedAt $startedAt `
      -CompletedAt $completedAt -ErrorCode (
        Get-EkyInstallerUpgradeSafeErrorCode -ErrorRecord $_
      )
    throw
  }
  finally {
    $Observer.ActivePhase = $null
    $Observer.PhaseStartedAt = $null
  }
}

function Write-EkyInstallerUpgradeHeartbeat {
  param([Parameter(Mandatory = $true)]$Observer)

  if ($null -eq $Observer.ActivePhase -or $null -eq $Observer.PhaseStartedAt) {
    return
  }
  $now = & $Observer.GetUtcNow
  if (($now - $Observer.LastHeartbeatAt).TotalSeconds -lt 60) {
    return
  }
  $Observer.LastHeartbeatAt = $now
  Write-EkyInstallerUpgradeProgressEvent -Observer $Observer `
    -Event 'heartbeat' -Phase $Observer.ActivePhase `
    -StartedAt $Observer.PhaseStartedAt -CompletedAt $now
}

function Write-EkyInstallerUpgradeProcessCleanupSummary {
  param(
    [Parameter(Mandatory = $true)]$Observer,
    [Parameter(Mandatory = $true)]$Summary
  )

  if (
    $Summary.TaskkillOutcomeClass -notin @(
      'notRequired', 'zero', 'nonzero', 'timeout', 'startFailed'
    ) -or
    $Summary.Decision -notin @('success', 'processTreeRemains') -or
    $Summary.TrackedProcessCount -lt 0 -or
    $Summary.RemainingProcessCount -lt 0 -or
    $Summary.DurationMs -lt 0
  ) {
    return
  }
  Write-EkyInstallerUpgradeProgressLine -Observer $Observer -Value (
    [ordered]@{
      decision = $Summary.Decision
      durationMs = [int]$Summary.DurationMs
      elapsedMs = Get-EkyInstallerUpgradeElapsedMilliseconds `
        -Observer $Observer -Now (& $Observer.GetUtcNow)
      event = 'processCleanupOutcome'
      remainingProcessCount = [int]$Summary.RemainingProcessCount
      source = 'installerUpgrade'
      stage = 'processTreeCleanup'
      taskkillOutcomeClass = $Summary.TaskkillOutcomeClass
      trackedProcessCount = [int]$Summary.TrackedProcessCount
    }
  )
}

function Write-EkyInstallerUpgradeProgressEvent {
  param(
    [Parameter(Mandatory = $true)]$Observer,
    [Parameter(Mandatory = $true)]
    [ValidateSet('phaseStarted', 'phaseCompleted', 'phaseFailed', 'heartbeat')]
    [string]$Event,
    [Parameter(Mandatory = $true)][string]$Phase,
    [Parameter(Mandatory = $true)][DateTime]$StartedAt,
    [Parameter(Mandatory = $true)][DateTime]$CompletedAt,
    [string]$ErrorCode
  )

  Assert-EkyInstallerUpgradeProgressPhase -Phase $Phase
  $value = [ordered]@{
    durationMs = [int][Math]::Max(0, ($CompletedAt - $StartedAt).TotalMilliseconds)
    elapsedMs = Get-EkyInstallerUpgradeElapsedMilliseconds `
      -Observer $Observer -Now $CompletedAt
    event = $Event
    phase = $Phase
    source = 'installerUpgrade'
  }
  if (![string]::IsNullOrWhiteSpace($ErrorCode)) {
    $value['errorCode'] = $ErrorCode
  }
  Write-EkyInstallerUpgradeProgressLine -Observer $Observer -Value $value
}

function Write-EkyInstallerUpgradeProgressLine {
  param(
    [Parameter(Mandatory = $true)]$Observer,
    [Parameter(Mandatory = $true)]$Value
  )

  try {
    $line = $Value | ConvertTo-Json -Compress -Depth 4
    & $Observer.WriteLine $line
  }
  catch {
    # Progress reporting must never change the harness result.
  }
}

function Assert-EkyInstallerUpgradeProgressPhase {
  param([Parameter(Mandatory = $true)][string]$Phase)

  if ($Phase -notin $script:EkyInstallerUpgradeProgressPhases) {
    throw 'INSTALLER_UPGRADE_PROGRESS_PHASE_INVALID'
  }
}

function Get-EkyInstallerUpgradeSafeErrorCode {
  param([Parameter(Mandatory = $true)]$ErrorRecord)

  $message = [string]$ErrorRecord.Exception.Message
  $candidate = $message.Split(':')[0]
  if ($candidate -in $script:EkyInstallerUpgradeSafeErrorCodes) {
    return $candidate
  }
  return 'INSTALLER_UPGRADE_PROGRESS_FAILURE'
}

function Get-EkyInstallerUpgradeElapsedMilliseconds {
  param(
    [Parameter(Mandatory = $true)]$Observer,
    [Parameter(Mandatory = $true)][DateTime]$Now
  )

  return [int][Math]::Max(0, ($Now - $Observer.HarnessStartedAt).TotalMilliseconds)
}

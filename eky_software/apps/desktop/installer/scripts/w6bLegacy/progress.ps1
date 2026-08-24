function Write-W6bLegacyProgress {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('started', 'completed', 'failed')]
    [string]$Status,
    [Parameter(Mandatory = $true)][string]$ResultCode
  )

  if ($script:CurrentStage -notin $script:AllowedStages) {
    throw 'W6B_LEGACY_PROGRESS_STAGE_INVALID'
  }
  [ordered]@{
    scenario = 'legacyUpgrade'
    stage = $script:CurrentStage
    status = $Status
    resultCode = $ResultCode
    durationMs = [long]([DateTime]::UtcNow - $script:StageStartedAt).TotalMilliseconds
    elapsedMs = [long]([DateTime]::UtcNow - $script:ScenarioStartedAt).TotalMilliseconds
  } | ConvertTo-Json -Compress
}

function Start-W6bLegacyStage {
  param([Parameter(Mandatory = $true)][string]$Stage)

  if ($Stage -notin $script:AllowedStages) {
    throw 'W6B_LEGACY_PROGRESS_STAGE_INVALID'
  }
  $script:CurrentStage = $Stage
  $script:StageStartedAt = [DateTime]::UtcNow
  Write-W6bLegacyProgress -Status started -ResultCode started
}

function Complete-W6bLegacyStage {
  Write-W6bLegacyProgress -Status completed -ResultCode completed
}

function Write-W6bLegacyReadinessObservation {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
      'databaseReady',
      'backendUtilityReady',
      'acceptedBuildReady',
      'backendHealthReady',
      'sourceUserDataReady',
      'legacyBusinessFixtureReady',
      'runtimeSessionValidated'
    )]
    [string]$Signal
  )

  if (
    $script:CurrentStage -notin @(
      'sourceStartup',
      'legacyFixtureVerification',
      'targetFirstStartup',
      'targetSecondStartup'
    )
  ) {
    throw 'W6B_LEGACY_PROGRESS_STAGE_INVALID'
  }
  [ordered]@{
    scenario = 'legacyUpgrade'
    stage = $script:CurrentStage
    status = 'observed'
    resultCode = $Signal
    durationMs = [long]([DateTime]::UtcNow - $script:StageStartedAt).TotalMilliseconds
    elapsedMs = [long]([DateTime]::UtcNow - $script:ScenarioStartedAt).TotalMilliseconds
  } | ConvertTo-Json -Compress
}

function Write-W6bLegacyInstallerObservation {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
      'msiStarted',
      'msiExited',
      'productStateValidated',
      'payloadValidated'
    )]
    [string]$Signal
  )

  if ($script:CurrentStage -ne 'targetInstall') {
    throw 'W6B_LEGACY_PROGRESS_STAGE_INVALID'
  }
  [ordered]@{
    scenario = 'legacyUpgrade'
    stage = $script:CurrentStage
    status = 'observed'
    resultCode = $Signal
    durationMs = [long]([DateTime]::UtcNow - $script:StageStartedAt).TotalMilliseconds
    elapsedMs = [long]([DateTime]::UtcNow - $script:ScenarioStartedAt).TotalMilliseconds
  } | ConvertTo-Json -Compress
}

function Get-W6bSafeErrorCode {
  param([Parameter(Mandatory = $true)]$ErrorRecord)

  $candidate = ([string]$ErrorRecord.Exception.Message -split ':')[0]
  if ($candidate -match '^(W6B_LEGACY_[A-Z0-9_]+|INSTALLER_W6B_[A-Z0-9_]+)$') {
    return $candidate
  }
  return 'W6B_LEGACY_ACCEPTANCE_FAILED'
}

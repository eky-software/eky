Set-StrictMode -Version Latest

$script:W6b2FaultScenarios = @(
  'preUpdateRecoveryPointFailure',
  'activeWorkspaceFirstStartFailure',
  'acceptanceInterruption',
  'passiveWorkspaceMigrationFailure',
  'binaryRollbackFailure'
)
$script:W6b2FaultPhases = @(
  'sourceHandoff',
  'targetFirstStartFailure',
  'businessRollback',
  'rollbackFirstStart',
  'targetAcceptanceInterruption',
  'targetAcceptanceRecovery',
  'targetAcceptanceRestart',
  'targetFirstStart',
  'switchToB',
  'passiveWorkspaceMigrationFailure',
  'passiveWorkspaceRecovery',
  'binaryRollbackFailure',
  'failedSafeVerification'
)
$script:W6b2FaultProfileOperations = @(
  'verifyPreUpdateFailure',
  'verifyActiveRollback',
  'verifyAcceptanceRecovery',
  'verifyPassiveRecovery',
  'verifyBinaryFailedSafe'
)

function Set-W6b2FaultPhase {
  param(
    [Parameter(Mandatory = $true)][string]$ProofRoot,
    [Parameter(Mandatory = $true)][string]$FaultScenario,
    [Parameter(Mandatory = $true)][string]$Phase
  )

  Assert-W6b2FaultScenarioPhase -FaultScenario $FaultScenario -Phase $Phase
  $controlRoot = Assert-W6b2SuccessCanonicalDirectory `
    -Path (Join-Path $ProofRoot 'control')
  $phasePath = Join-Path $controlRoot 'phase.json'
  $nextPath = Join-Path $controlRoot 'phase.next.json'
  $previousPath = Join-Path $controlRoot 'phase.previous.json'
  Remove-Item -LiteralPath $nextPath,$previousPath `
    -Force -ErrorAction SilentlyContinue
  try {
    [IO.File]::WriteAllText(
      $nextPath,
      ((ConvertTo-Json -InputObject ([ordered]@{
        faultScenario = $FaultScenario
        formatVersion = 2
        phase = $Phase
      }) -Compress) + "`n"),
      [Text.UTF8Encoding]::new($false)
    )
    if (Test-Path -LiteralPath $phasePath -PathType Leaf) {
      [IO.File]::Replace($nextPath, $phasePath, $previousPath)
    }
    else {
      [IO.File]::Move($nextPath, $phasePath)
    }
  }
  finally {
    Remove-Item -LiteralPath $nextPath,$previousPath `
      -Force -ErrorAction SilentlyContinue
  }
}

function Read-W6b2FaultProofResult {
  param(
    [Parameter(Mandatory = $true)][string]$ProofRoot,
    [Parameter(Mandatory = $true)][string]$FaultScenario,
    [Parameter(Mandatory = $true)][string]$ExpectedPhase,
    [Parameter(Mandatory = $true)][string]$ExpectedStatus
  )

  Assert-W6b2FaultScenarioPhase `
    -FaultScenario $FaultScenario -Phase $ExpectedPhase
  if ($ExpectedStatus -cnotin @('completed', 'interrupted', 'relaunching')) {
    throw 'W6B2_FAULT_RESULT_INVALID'
  }
  $value = Read-W6b2SuccessBoundedJson `
    -Path (Join-Path $ProofRoot 'result\w6b2-proof-result.json')
  $keys = @($value.PSObject.Properties.Name | Sort-Object)
  $successKeys = @('faultScenario', 'formatVersion', 'phase', 'status')
  if (
    @(Compare-Object $keys $successKeys).Count -eq 0 -and
    $value.formatVersion -eq 2 -and
    [string]$value.faultScenario -ceq $FaultScenario -and
    [string]$value.phase -ceq $ExpectedPhase -and
    [string]$value.status -ceq $ExpectedStatus
  ) {
    return $value
  }
  $failureKeys = @(
    'errorCode',
    'faultScenario',
    'formatVersion',
    'phase',
    'status'
  )
  $safeErrors = @(
    'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED',
    'W6B2_FAULT_PROOF_HANDOFF_FAILED',
    'W6B2_FAULT_PROOF_JOURNAL_STATE_INVALID',
    'W6B2_FAULT_PROOF_PACKAGE_STAGE_FAILED',
    'W6B2_FAULT_PROOF_SHUTDOWN_FAILED',
    'W6B2_FAULT_PROOF_UNEXPECTED',
    'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID'
  )
  if (
    @(Compare-Object $keys $failureKeys).Count -eq 0 -and
    $value.formatVersion -eq 2 -and
    [string]$value.faultScenario -ceq $FaultScenario -and
    [string]$value.phase -ceq $ExpectedPhase -and
    [string]$value.status -ceq 'failed' -and
    $safeErrors -ccontains [string]$value.errorCode
  ) {
    throw [string]$value.errorCode
  }
  throw 'W6B2_FAULT_RESULT_INVALID'
}

function Read-W6b2FaultProfileResult {
  param(
    [Parameter(Mandatory = $true)][string]$ProofRoot,
    [Parameter(Mandatory = $true)][string]$ExpectedOperation
  )

  if ($script:W6b2FaultProfileOperations -cnotcontains $ExpectedOperation) {
    throw 'W6B2_FAULT_PROFILE_RESULT_INVALID'
  }
  $value = Read-W6b2SuccessBoundedJson `
    -Path (Join-Path $ProofRoot 'result\w6b2-profile-result.json')
  $keys = @($value.PSObject.Properties.Name | Sort-Object)
  $completedKeys = @('formatVersion', 'operation', 'status')
  if (
    @(Compare-Object $keys $completedKeys).Count -eq 0 -and
    $value.formatVersion -eq 1 -and
    [string]$value.operation -ceq $ExpectedOperation -and
    [string]$value.status -ceq 'completed'
  ) {
    return $value
  }
  $failedKeys = @(
    'errorCode',
    'failureStage',
    'formatVersion',
    'operation',
    'status'
  )
  $failureStages = @(
    'electronReady',
    'installedApplication',
    'proofConfiguration',
    'buildIdentity',
    'profileInput',
    'runtimePaths',
    'fixtureA',
    'fixtureB',
    'fixtureC',
    'migrationHistory',
    'registry',
    'acceptedBuild',
    'evidence',
    'profileState',
    'profileOperation'
  )
  if (
    @(Compare-Object $keys $failedKeys).Count -eq 0 -and
    $value.formatVersion -eq 1 -and
    [string]$value.operation -ceq $ExpectedOperation -and
    [string]$value.status -ceq 'failed' -and
    [string]$value.errorCode -ceq 'W6B2_PROFILE_VERIFICATION_FAILED' -and
    $failureStages -ccontains [string]$value.failureStage
  ) {
    throw 'W6B2_FAULT_PROFILE_VERIFICATION_FAILED'
  }
  throw 'W6B2_FAULT_PROFILE_RESULT_INVALID'
}

function Assert-W6b2FaultScenarioPhase {
  param(
    [Parameter(Mandatory = $true)][string]$FaultScenario,
    [Parameter(Mandatory = $true)][string]$Phase
  )

  $allowed = @{
    preUpdateRecoveryPointFailure = @('sourceHandoff')
    activeWorkspaceFirstStartFailure = @(
      'sourceHandoff',
      'targetFirstStartFailure',
      'businessRollback',
      'rollbackFirstStart'
    )
    acceptanceInterruption = @(
      'sourceHandoff',
      'targetAcceptanceInterruption',
      'targetAcceptanceRecovery',
      'targetAcceptanceRestart'
    )
    passiveWorkspaceMigrationFailure = @(
      'sourceHandoff',
      'targetFirstStart',
      'switchToB',
      'passiveWorkspaceMigrationFailure',
      'passiveWorkspaceRecovery'
    )
    binaryRollbackFailure = @(
      'sourceHandoff',
      'targetFirstStartFailure',
      'businessRollback',
      'binaryRollbackFailure',
      'failedSafeVerification'
    )
  }
  if (
    $script:W6b2FaultScenarios -cnotcontains $FaultScenario -or
    $script:W6b2FaultPhases -cnotcontains $Phase -or
    $allowed[$FaultScenario] -cnotcontains $Phase
  ) {
    throw 'W6B2_FAULT_PHASE_INVALID'
  }
}

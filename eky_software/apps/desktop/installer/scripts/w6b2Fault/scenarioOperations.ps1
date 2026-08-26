Set-StrictMode -Version Latest

function Invoke-W6b2FaultScenarioFlow {
  param([Parameter(Mandatory = $true)]$Context)

  switch -CaseSensitive ($Context.FaultScenario) {
    'preUpdateRecoveryPointFailure' {
      Invoke-W6b2FaultPreUpdateRecoveryPointFailure -Context $Context
    }
    'activeWorkspaceFirstStartFailure' {
      Invoke-W6b2FaultActiveWorkspaceFirstStartFailure -Context $Context
    }
    'acceptanceInterruption' {
      Invoke-W6b2FaultAcceptanceInterruption -Context $Context
    }
    'passiveWorkspaceMigrationFailure' {
      Invoke-W6b2FaultPassiveWorkspaceMigrationFailure -Context $Context
    }
    'binaryRollbackFailure' {
      Invoke-W6b2FaultBinaryRollbackFailure -Context $Context
    }
    default { throw 'W6B2_FAULT_SCENARIO_INVALID' }
  }
}

function Invoke-W6b2FaultPreUpdateRecoveryPointFailure {
  param([Parameter(Mandatory = $true)]$Context)

  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage sourceHandoff -Phase sourceHandoff -ExpectedStatus completed `
    -ResultCode expectedFaultObserved
  Invoke-W6b2FaultPackageVerification -Context $Context -Expected source
  Invoke-W6b2FaultTerminalVerification -Context $Context `
    -Operation verifyPreUpdateFailure
}

function Invoke-W6b2FaultActiveWorkspaceFirstStartFailure {
  param([Parameter(Mandatory = $true)]$Context)

  Invoke-W6b2FaultTargetUpdate -Context $Context
  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage targetFirstStartFailure -Phase targetFirstStartFailure `
    -ExpectedStatus relaunching -ResultCode expectedFaultObserved

  Start-W6b2FaultStage -Stage businessRollbackCompletion
  $Context.RollbackProgressReportedCount = 0
  Set-W6b2FaultPhase -ProofRoot $Context.ProofRoot `
    -FaultScenario $Context.FaultScenario -Phase businessRollback
  $rollbackRun = Invoke-W6b2FaultApplicationHandoffPhase `
    -ExecutablePath $Context.ApplicationPath `
    -ProofToken $Context.ProofToken -ProofRoot $Context.ProofRoot `
    -FaultScenario $Context.FaultScenario -Phase businessRollback `
    -ExpectedStatus relaunching
  Add-W6b2FaultOwnedRun -Context $Context -Run $rollbackRun
  Wait-W6b2FaultSourceInstallation -Context $Context
  Close-W6b2FaultHandoffRun -Context $Context
  Complete-W6b2FaultStage -ResultCode sourceRestored
  Invoke-W6b2FaultPackageVerification -Context $Context -Expected source

  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage rollbackFirstStart -Phase rollbackFirstStart `
    -ExpectedStatus completed -ResultCode rollbackCompleted
  Invoke-W6b2FaultTerminalVerification -Context $Context `
    -Operation verifyActiveRollback
}

function Invoke-W6b2FaultAcceptanceInterruption {
  param([Parameter(Mandatory = $true)]$Context)

  Invoke-W6b2FaultTargetUpdate -Context $Context
  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage acceptanceInterruption -Phase targetAcceptanceInterruption `
    -ExpectedStatus interrupted -ResultCode interruptionObserved
  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage acceptanceRecovery -Phase targetAcceptanceRecovery `
    -ExpectedStatus relaunching -ResultCode recoveryPrepared
  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage acceptanceRestart -Phase targetAcceptanceRestart `
    -ExpectedStatus completed -ResultCode targetAccepted
  Invoke-W6b2FaultPackageVerification -Context $Context -Expected target
  Invoke-W6b2FaultTerminalVerification -Context $Context `
    -Operation verifyAcceptanceRecovery
}

function Invoke-W6b2FaultPassiveWorkspaceMigrationFailure {
  param([Parameter(Mandatory = $true)]$Context)

  Invoke-W6b2FaultTargetUpdate -Context $Context
  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage targetFirstStart -Phase targetFirstStart `
    -ExpectedStatus completed -ResultCode targetAccepted
  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage switchToB -Phase switchToB `
    -ExpectedStatus relaunching -ResultCode workspaceSwitchPrepared
  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage passiveMigrationFailure `
    -Phase passiveWorkspaceMigrationFailure `
    -ExpectedStatus relaunching -ResultCode expectedFaultObserved
  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage passiveRecovery -Phase passiveWorkspaceRecovery `
    -ExpectedStatus completed -ResultCode workspaceRecovered
  Invoke-W6b2FaultPackageVerification -Context $Context -Expected target
  Invoke-W6b2FaultTerminalVerification -Context $Context `
    -Operation verifyPassiveRecovery
}

function Invoke-W6b2FaultBinaryRollbackFailure {
  param([Parameter(Mandatory = $true)]$Context)

  Invoke-W6b2FaultTargetUpdate -Context $Context
  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage targetFirstStartFailure -Phase targetFirstStartFailure `
    -ExpectedStatus relaunching -ResultCode expectedFaultObserved
  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage binaryRollbackFailure -Phase binaryRollbackFailure `
    -ExpectedStatus completed -ResultCode failedSafeObserved
  Invoke-W6b2FaultApplicationStep -Context $Context `
    -Stage failedSafeVerification -Phase failedSafeVerification `
    -ExpectedStatus completed -ResultCode failedSafeObserved
  Invoke-W6b2FaultPackageVerification -Context $Context -Expected target
  Invoke-W6b2FaultTerminalVerification -Context $Context `
    -Operation verifyBinaryFailedSafe
}

function Invoke-W6b2FaultTargetUpdate {
  param([Parameter(Mandatory = $true)]$Context)

  Start-W6b2FaultStage -Stage sourceHandoff
  $Context.TargetCleanupAuthorized = $true
  Set-W6b2FaultPhase -ProofRoot $Context.ProofRoot `
    -FaultScenario $Context.FaultScenario -Phase sourceHandoff
  $sourceRun = Invoke-W6b2FaultApplicationHandoffPhase `
    -ExecutablePath $Context.ApplicationPath `
    -ProofToken $Context.ProofToken -ProofRoot $Context.ProofRoot `
    -FaultScenario $Context.FaultScenario -Phase sourceHandoff `
    -ExpectedStatus completed
  Add-W6b2FaultOwnedRun -Context $Context -Run $sourceRun
  Complete-W6b2FaultStage -ResultCode handoffCompleted

  Start-W6b2FaultStage -Stage targetInstall
  Wait-W6b2SuccessTargetInstallation -Installer $Context.Installer `
    -SourceProductCode $Context.SourceCode `
    -TargetProductCode $Context.TargetCode
  Close-W6b2FaultHandoffRun -Context $Context
  Assert-W6b2FaultTerminalPackageState -Context $Context -Expected target
  Complete-W6b2FaultStage -ResultCode targetInstalled
}

function Invoke-W6b2FaultApplicationStep {
  param(
    [Parameter(Mandatory = $true)]$Context,
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][string]$Phase,
    [Parameter(Mandatory = $true)][string]$ExpectedStatus,
    [Parameter(Mandatory = $true)][string]$ResultCode
  )

  Start-W6b2FaultStage -Stage $Stage
  Set-W6b2FaultPhase -ProofRoot $Context.ProofRoot `
    -FaultScenario $Context.FaultScenario -Phase $Phase
  $run = Invoke-W6b2FaultApplicationPhase `
    -ExecutablePath $Context.ApplicationPath `
    -ProofToken $Context.ProofToken -ProofRoot $Context.ProofRoot `
    -FaultScenario $Context.FaultScenario -Phase $Phase `
    -ExpectedStatus $ExpectedStatus
  Add-W6b2FaultOwnedRun -Context $Context -Run $run
  Complete-W6b2FaultStage -ResultCode $ResultCode
}

function Invoke-W6b2FaultTerminalVerification {
  param(
    [Parameter(Mandatory = $true)]$Context,
    [Parameter(Mandatory = $true)][string]$Operation
  )

  Start-W6b2FaultStage -Stage terminalVerification
  Invoke-W6b2FaultProfileOperation -ElectronPath $Context.ElectronPath `
    -ProfileApplicationPath $Context.ProfileApplicationPath `
    -ProofToken $Context.ProofToken -ProofRoot $Context.ProofRoot `
    -Operation $Operation
  Complete-W6b2FaultStage -ResultCode profileVerified
}

function Invoke-W6b2FaultPackageVerification {
  param(
    [Parameter(Mandatory = $true)]$Context,
    [Parameter(Mandatory = $true)]
    [ValidateSet('source', 'target')][string]$Expected
  )

  Start-W6b2FaultStage -Stage packageVerification
  Assert-W6b2FaultTerminalPackageState -Context $Context -Expected $Expected
  Complete-W6b2FaultStage -ResultCode packageVerified
}

function Add-W6b2FaultOwnedRun {
  param(
    [Parameter(Mandatory = $true)]$Context,
    [Parameter(Mandatory = $true)]$Run
  )

  $Context.OwnedObservations.Add($Run.observation)
  if ($null -ne $Run.PSObject.Properties['process']) {
    if ($null -ne $Context.HandoffProcess) {
      throw 'W6B2_FAULT_STATE_INVALID'
    }
    $Context.HandoffObservation = $Run.observation
    $Context.HandoffProcess = $Run.process
  }
}

function Close-W6b2FaultHandoffRun {
  param([Parameter(Mandatory = $true)]$Context)

  if (
    $null -eq $Context.HandoffObservation -or
    $null -eq $Context.HandoffProcess
  ) {
    throw 'W6B2_FAULT_STATE_INVALID'
  }
  Wait-W6b2SuccessOwnedProcessesAbsent `
    -Observation $Context.HandoffObservation -TimeoutMilliseconds 30000
  Close-W6b2SuccessProcess -Process $Context.HandoffProcess
  $Context.HandoffObservation = $null
  $Context.HandoffProcess = $null
}

function Wait-W6b2FaultSourceInstallation {
  param(
    [Parameter(Mandatory = $true)]$Context,
    [int]$TimeoutMilliseconds = 300000
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    Publish-W6b2FaultRollbackProgress -Context $Context
    $sourceState = Get-EkyProductState -Installer $Context.Installer `
      -Code $Context.SourceCode
    $targetState = Get-EkyProductState -Installer $Context.Installer `
      -Code $Context.TargetCode
    $msiProcesses = @(Get-W6b2SuccessCurrentSessionMsiProcesses)
    if ($sourceState -ge 1 -and $targetState -lt 1 -and $msiProcesses.Count -eq 0) {
      Publish-W6b2FaultRollbackProgress -Context $Context
      return
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      Publish-W6b2FaultRollbackProgress -Context $Context
      throw 'W6B2_FAULT_INSTALLER_FAILED'
    }
    Write-W6b2SuccessHeartbeat
    Start-Sleep -Milliseconds 250
  } while ($true)
}

function Assert-W6b2FaultTerminalPackageState {
  param(
    [Parameter(Mandatory = $true)]$Context,
    [Parameter(Mandatory = $true)]
    [ValidateSet('source', 'target')][string]$Expected
  )

  $presentCode = if ($Expected -ceq 'source') {
    $Context.SourceCode
  }
  else {
    $Context.TargetCode
  }
  $absentCode = if ($Expected -ceq 'source') {
    $Context.TargetCode
  }
  else {
    $Context.SourceCode
  }
  $payload = if ($Expected -ceq 'source') {
    $Context.SourcePayloadInventory
  }
  else {
    $Context.TargetPayloadInventory
  }
  Assert-W6b2SuccessProductInstalled -Installer $Context.Installer `
    -ProductCode $presentCode
  Assert-W6b2SuccessProductAbsent -Installer $Context.Installer `
    -ProductCode $absentCode
  Write-W6b2FaultObservation -ResultCode productStateVerified
  Assert-EkyInstalledPayload -InstallRoot $Context.InstallRoot `
    -PayloadInventory $payload -ShortcutPath $Context.ShortcutPath
  Write-W6b2FaultObservation -ResultCode payloadVerified
  Assert-EkyInstallerRegistrationPresent -ProductCode $presentCode
  Assert-W6b2FaultProductRegistrationAbsent -ProductCode $absentCode
  Write-W6b2FaultObservation -ResultCode registrationVerified
  Assert-W6b2SuccessPackageHash -Path $Context.SourceMsi `
    -ExpectedSha256 $Context.SourcePackageSha256
  Assert-W6b2SuccessPackageHash -Path $Context.TargetMsi `
    -ExpectedSha256 $Context.TargetPackageSha256
  Write-W6b2FaultObservation -ResultCode packageHashesVerified
}

function Assert-W6b2FaultProductRegistrationAbsent {
  param([Parameter(Mandatory = $true)][string]$ProductCode)

  if (@(Get-EkyProductRegistrations -ProductCodes @($ProductCode)).Count -ne 0) {
    throw 'W6B2_FAULT_INSTALLER_FAILED'
  }
}

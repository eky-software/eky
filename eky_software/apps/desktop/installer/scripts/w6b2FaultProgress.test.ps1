Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'w6b2Fault\evidence.ps1')
. (Join-Path $PSScriptRoot 'w6b2Fault\progress.ps1')

Start-W6b2FaultScenario -FaultScenario binaryRollbackFailure
Start-W6b2FaultStage -Stage targetInstall
$primaryFailure = Resolve-W6b2FaultSafeErrorCode -ErrorRecord `
  ([Management.Automation.ErrorRecord]::new(
    [Exception]::new('W6B2_SUCCESS_OWNED_PROCESS_UNCLASSIFIED_REMAINS'),
    'fixture-primary',
    [Management.Automation.ErrorCategory]::OperationStopped,
    $null
  ))
Fail-W6b2FaultStage -ErrorRecord ([Management.Automation.ErrorRecord]::new(
  [Exception]::new('W6B2_SUCCESS_OWNED_PROCESS_UNCLASSIFIED_REMAINS'),
  'fixture-primary',
  [Management.Automation.ErrorCategory]::OperationStopped,
  $null
))

Start-W6b2FaultStage -Stage cleanup
$secondaryFailure = Resolve-W6b2FaultSafeErrorCode -ErrorRecord `
  ([Management.Automation.ErrorRecord]::new(
    [Exception]::new('W6B2_SUCCESS_PROCESS_CLEANUP_FAILED'),
    'fixture-secondary',
    [Management.Automation.ErrorCategory]::OperationStopped,
    $null
  ))
Fail-W6b2FaultStage -ErrorRecord ([Management.Automation.ErrorRecord]::new(
  [Exception]::new('W6B2_SUCCESS_PROCESS_CLEANUP_FAILED'),
  'fixture-secondary',
  [Management.Automation.ErrorCategory]::OperationStopped,
  $null
))

Fail-W6b2FaultScenario -PrimaryFailure $primaryFailure `
  -SecondaryFailure $secondaryFailure

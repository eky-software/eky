Set-StrictMode -Version Latest

function Invoke-W6b2FaultApplicationPhase {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$ProofToken,
    [Parameter(Mandatory = $true)][string]$ProofRoot,
    [Parameter(Mandatory = $true)][string]$FaultScenario,
    [Parameter(Mandatory = $true)][string]$Phase,
    [Parameter(Mandatory = $true)][string]$ExpectedStatus
  )

  Clear-W6b2SuccessResultFiles -ProofRoot $ProofRoot
  $process = Start-W6b2SuccessProcess -ExecutablePath $ExecutablePath `
    -Arguments @('--w6b2-packaged-proof') -EnvironmentOverrides @{
      EKY_W6B2_PROOF_TOKEN = $ProofToken
    }
  $observation = New-W6b2SuccessProcessObservation -Process $process
  $completed = $false
  try {
    $resultPath = Join-Path $ProofRoot 'result\w6b2-proof-result.json'
    $result = Wait-W6b2SuccessResultProcess -Process $process `
      -Observation $observation -ReadResult {
        if (!(Test-Path -LiteralPath $resultPath -PathType Leaf)) {
          throw 'W6B2_SUCCESS_RESULT_PENDING'
        }
        Read-W6b2FaultProofResult -ProofRoot $ProofRoot `
          -FaultScenario $FaultScenario -ExpectedPhase $Phase `
          -ExpectedStatus $ExpectedStatus
      }
    $completed = $true
    return [pscustomobject]@{
      observation = $observation
      result = $result
    }
  }
  finally {
    if (!$completed) {
      Stop-W6b2SuccessOwnedProcesses -Observation $observation
      Wait-W6b2SuccessOwnedProcessesAbsent -Observation $observation `
        -TimeoutMilliseconds 30000
    }
    Close-W6b2SuccessProcess -Process $process
  }
}

function Invoke-W6b2FaultApplicationHandoffPhase {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$ProofToken,
    [Parameter(Mandatory = $true)][string]$ProofRoot,
    [Parameter(Mandatory = $true)][string]$FaultScenario,
    [Parameter(Mandatory = $true)][string]$Phase,
    [Parameter(Mandatory = $true)][string]$ExpectedStatus
  )

  Clear-W6b2SuccessResultFiles -ProofRoot $ProofRoot
  $process = Start-W6b2SuccessProcess -ExecutablePath $ExecutablePath `
    -Arguments @('--w6b2-packaged-proof') -EnvironmentOverrides @{
      EKY_W6B2_PROOF_TOKEN = $ProofToken
    }
  $observation = New-W6b2SuccessProcessObservation -Process $process
  try {
    $resultPath = Join-Path $ProofRoot 'result\w6b2-proof-result.json'
    $result = Wait-W6b2SuccessHandoffResult -Process $process `
      -Observation $observation -ReadResult {
        if (!(Test-Path -LiteralPath $resultPath -PathType Leaf)) {
          throw 'W6B2_SUCCESS_RESULT_PENDING'
        }
        Read-W6b2FaultProofResult -ProofRoot $ProofRoot `
          -FaultScenario $FaultScenario -ExpectedPhase $Phase `
          -ExpectedStatus $ExpectedStatus
      }
    Release-W6b2SuccessInstallerHandoffOwnership `
      -Observation $observation
    return [pscustomobject]@{
      observation = $observation
      process = $process
      result = $result
    }
  }
  catch {
    $failure = $_
    Stop-W6b2SuccessOwnedProcesses -Observation $observation
    Wait-W6b2SuccessOwnedProcessesAbsent -Observation $observation `
      -TimeoutMilliseconds 30000
    Close-W6b2SuccessProcess -Process $process
    throw $failure
  }
}

function Invoke-W6b2FaultProfileOperation {
  param(
    [Parameter(Mandatory = $true)][string]$ElectronPath,
    [Parameter(Mandatory = $true)][string]$ProfileApplicationPath,
    [Parameter(Mandatory = $true)][string]$ProofToken,
    [Parameter(Mandatory = $true)][string]$ProofRoot,
    [Parameter(Mandatory = $true)][string]$Operation
  )

  Clear-W6b2SuccessResultFiles -ProofRoot $ProofRoot
  $process = Start-W6b2SuccessProcess -ExecutablePath $ElectronPath `
    -Arguments @($ProfileApplicationPath) -EnvironmentOverrides @{
      EKY_W6B2_PROFILE_OPERATION = $Operation
      EKY_W6B2_PROOF_TOKEN = $ProofToken
    }
  $observation = New-W6b2SuccessProcessObservation -Process $process
  $completed = $false
  try {
    $resultPath = Join-Path $ProofRoot 'result\w6b2-profile-result.json'
    [void](Wait-W6b2SuccessResultProcess -Process $process `
      -Observation $observation -ReadResult {
        if (!(Test-Path -LiteralPath $resultPath -PathType Leaf)) {
          throw 'W6B2_SUCCESS_RESULT_PENDING'
        }
        Read-W6b2FaultProfileResult -ProofRoot $ProofRoot `
          -ExpectedOperation $Operation
      })
    $completed = $true
  }
  finally {
    if (!$completed) {
      Stop-W6b2SuccessOwnedProcesses -Observation $observation
      Wait-W6b2SuccessOwnedProcessesAbsent -Observation $observation `
        -TimeoutMilliseconds 30000
    }
    Close-W6b2SuccessProcess -Process $process
  }
}

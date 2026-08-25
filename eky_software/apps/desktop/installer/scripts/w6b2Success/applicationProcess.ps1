Set-StrictMode -Version Latest

function Start-W6b2SuccessProcess {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments,
    [Parameter(Mandatory = $true)][hashtable]$EnvironmentOverrides
  )

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $ExecutablePath
  $startInfo.Arguments = ($Arguments | ForEach-Object {
    if ($_ -match '["\r\n]' -or $_.EndsWith('\')) {
      throw 'W6B2_SUCCESS_PROCESS_ARGUMENT_INVALID'
    }
    if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
  }) -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($key in @($startInfo.EnvironmentVariables.Keys)) {
    $name = [string]$key
    if (
      $name -cmatch '^EKY_' -or
      $name -cin @('ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH')
    ) {
      $startInfo.EnvironmentVariables.Remove($name)
    }
  }
  foreach ($key in $EnvironmentOverrides.Keys) {
    $startInfo.EnvironmentVariables[[string]$key] = `
      [string]$EnvironmentOverrides[$key]
  }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  $process.add_OutputDataReceived({ param($sender, $eventArgs) })
  $process.add_ErrorDataReceived({ param($sender, $eventArgs) })
  try {
    if (!$process.Start()) {
      throw 'W6B2_SUCCESS_PROCESS_START_FAILED'
    }
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    return $process
  }
  catch {
    $process.Dispose()
    throw 'W6B2_SUCCESS_PROCESS_START_FAILED'
  }
}

function New-W6b2SuccessProcessObservation {
  param([Parameter(Mandatory = $true)]$Process)

  $root = New-EkyProcessIdentity -ProcessId ([int]$Process.Id) `
    -CreationToken (ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$Process.StartTime))
  $owned = @{}
  $owned["$($root.processId):$($root.creationToken)"] = $root
  return [pscustomobject]@{
    root = $root
    owned = $owned
  }
}

function Update-W6b2SuccessProcessObservation {
  param([Parameter(Mandatory = $true)]$Observation)

  $snapshot = @(Get-EkyProcessSnapshot)
  foreach ($identity in @(Get-EkyOwnedProcessIdentitiesFromSnapshot `
    -RootIdentity $Observation.root -ProcessSnapshot $snapshot)) {
    $Observation.owned["$($identity.processId):$($identity.creationToken)"] = `
      $identity
  }
  return ,$snapshot
}

function Wait-W6b2SuccessResultProcess {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)]$Observation,
    [Parameter(Mandatory = $true)][scriptblock]$ReadResult,
    [int]$TimeoutMilliseconds = 180000,
    [switch]$AllowOwnedDescendantsAfterExit
  )

  if ($TimeoutMilliseconds -lt 1) {
    throw 'W6B2_SUCCESS_PROCESS_WAIT_INVALID'
  }
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  $result = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    [void](Update-W6b2SuccessProcessObservation -Observation $Observation)
    if ($null -eq $result) {
      try {
        $result = & $ReadResult
      }
      catch {
        if ($_.Exception.Message -ne 'W6B2_SUCCESS_RESULT_PENDING') {
          throw
        }
      }
    }
    $Process.Refresh()
    if ($Process.HasExited) {
      [void](Update-W6b2SuccessProcessObservation -Observation $Observation)
      if ($null -eq $result) {
        try {
          $result = & $ReadResult
        }
        catch {
          if ($_.Exception.Message -eq 'W6B2_SUCCESS_RESULT_PENDING') {
            throw 'W6B2_SUCCESS_PROCESS_EXITED_BEFORE_RESULT'
          }
          throw
        }
      }
      if ([int]$Process.ExitCode -ne 0) {
        throw 'W6B2_SUCCESS_PROCESS_EXIT_FAILED'
      }
      if (!$AllowOwnedDescendantsAfterExit) {
        Wait-W6b2SuccessOwnedProcessesAbsent -Observation $Observation `
          -TimeoutMilliseconds 30000
      }
      return $result
    }
    Write-W6b2SuccessHeartbeat
    Start-Sleep -Milliseconds 100
  }
  Stop-W6b2SuccessOwnedProcesses -Observation $Observation
  throw 'W6B2_SUCCESS_PROCESS_TIMEOUT'
}

function Wait-W6b2SuccessOwnedProcessesAbsent {
  param(
    [Parameter(Mandatory = $true)]$Observation,
    [int]$TimeoutMilliseconds = 30000
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    $snapshot = @(Get-EkyProcessSnapshot)
    $remaining = @(Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot `
      -OwnedProcessIdentities @($Observation.owned.Values) `
      -ProcessSnapshot $snapshot)
    if ($remaining.Count -eq 0) {
      return
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      Stop-W6b2SuccessOwnedProcesses -Observation $Observation
      throw 'W6B2_SUCCESS_OWNED_PROCESS_REMAINS'
    }
    Write-W6b2SuccessHeartbeat
    Start-Sleep -Milliseconds 100
  } while ($true)
}

function Stop-W6b2SuccessOwnedProcesses {
  param([Parameter(Mandatory = $true)]$Observation)

  $snapshot = @(Get-EkyProcessSnapshot)
  $remaining = @(Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot `
    -OwnedProcessIdentities @($Observation.owned.Values) `
    -ProcessSnapshot $snapshot)
  foreach ($identity in $remaining) {
    try {
      $process = Get-Process -Id ([int]$identity.processId) -ErrorAction Stop
      try {
        $token = ConvertTo-EkyProcessCreationToken `
          -CreationTime ([DateTime]$process.StartTime)
        if ($token -cne [string]$identity.creationToken) {
          throw 'W6B2_SUCCESS_PROCESS_IDENTITY_CHANGED'
        }
        $process.Kill()
        [void]$process.WaitForExit(10000)
      }
      finally {
        $process.Dispose()
      }
    }
    catch {
      if ($_.Exception.Message -eq 'W6B2_SUCCESS_PROCESS_IDENTITY_CHANGED') {
        throw
      }
    }
  }
}

function Invoke-W6b2SuccessApplicationPhase {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$ProofToken,
    [Parameter(Mandatory = $true)][string]$ProofRoot,
    [Parameter(Mandatory = $true)][string]$Phase,
    [Parameter(Mandatory = $true)][string]$ExpectedStatus,
    [switch]$AllowOwnedDescendantsAfterExit
  )

  Clear-W6b2SuccessResultFiles -ProofRoot $ProofRoot
  $process = Start-W6b2SuccessProcess -ExecutablePath $ExecutablePath `
    -Arguments @('--w6b2-packaged-proof') -EnvironmentOverrides @{
      EKY_W6B2_PROOF_TOKEN = $ProofToken
    }
  $observation = New-W6b2SuccessProcessObservation -Process $process
  try {
    $resultPath = Join-Path $ProofRoot 'result\w6b2-proof-result.json'
    $result = Wait-W6b2SuccessResultProcess -Process $process `
      -Observation $observation -ReadResult {
        if (!(Test-Path -LiteralPath $resultPath -PathType Leaf)) {
          throw 'W6B2_SUCCESS_RESULT_PENDING'
        }
        Read-W6b2SuccessProofResult -ProofRoot $ProofRoot `
          -ExpectedPhase $Phase -ExpectedStatus $ExpectedStatus
      } -AllowOwnedDescendantsAfterExit:$AllowOwnedDescendantsAfterExit
    return [pscustomobject]@{
      result = $result
      observation = $observation
    }
  }
  finally {
    $process.Dispose()
  }
}

function Invoke-W6b2SuccessProfileOperation {
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
  try {
    $resultPath = Join-Path $ProofRoot 'result\w6b2-profile-result.json'
    [void](Wait-W6b2SuccessResultProcess -Process $process `
      -Observation $observation -ReadResult {
        if (!(Test-Path -LiteralPath $resultPath -PathType Leaf)) {
          throw 'W6B2_SUCCESS_RESULT_PENDING'
        }
        Read-W6b2SuccessProfileResult -ProofRoot $ProofRoot `
          -ExpectedOperation $Operation
      })
  }
  finally {
    $process.Dispose()
  }
}

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerTestSupport.ps1')

function Assert-Equal {
  param($Actual, $Expected, [string]$Code)
  if ($Actual -ne $Expected) {
    throw $Code
  }
}

function Assert-ThrowsCode {
  param([scriptblock]$Action, [string]$ExpectedCode)
  try {
    & $Action
  }
  catch {
    if ($_.Exception.Message -ne $ExpectedCode) {
      throw 'INSTALLER_MSI_RUNNER_UNEXPECTED_ERROR'
    }
    return
  }
  throw 'INSTALLER_MSI_RUNNER_EXPECTED_ERROR_MISSING'
}

function ConvertTo-EncodedPowerShellCommand {
  param([Parameter(Mandatory = $true)][string]$Command)

  return [Convert]::ToBase64String(
    [Text.Encoding]::Unicode.GetBytes($Command)
  )
}

function Start-MsiRunnerFixtureProcess {
  param([Parameter(Mandatory = $true)][string]$Command)

  return Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    (ConvertTo-EncodedPowerShellCommand -Command $Command)
  ) -WindowStyle Hidden -PassThru
}

$ownedProcess = $null
$sentinelProcess = $null
$fastProcess = $null
$observedExitProcess = $null
$treeProcess = $null
$cleanupExitedProcess = $null
$cleanupTimeoutProcess = $null
$treeIdentities = @()
$unobservedHostExitCode = $null
$hostArgumentRoundTripExitCode = $null
$longPathCleanupRoot = $null
$failureCode = $null
$successResult = $null
$hostObservationLines = [System.Collections.Generic.List[string]]::new()
$observedExitLines = [System.Collections.Generic.List[string]]::new()
$timeoutObservationLines = [System.Collections.Generic.List[string]]::new()
$cleanupObservationLines = [System.Collections.Generic.List[string]]::new()
try {
  $installPolicy = Get-EkyMsiExecPolicy -Operation w6b_target_install
  $uninstallPolicy = Get-EkyMsiExecPolicy -Operation w6b_uninstall
  Assert-Equal $installPolicy.timeoutMilliseconds 300000 `
    'INSTALLER_MSI_RUNNER_INSTALL_POLICY_INVALID'
  Assert-Equal ($uninstallPolicy.timeoutMilliseconds -gt 0) $true `
    'INSTALLER_MSI_RUNNER_UNINSTALL_POLICY_INVALID'
  Assert-Equal $installPolicy.errorPrefix 'W6B_LEGACY_TARGET_INSTALL' `
    'INSTALLER_MSI_RUNNER_ERROR_PREFIX_INVALID'
  Assert-ThrowsCode {
    Get-EkyMsiExecPolicy -Operation unknown_operation
  } 'INSTALLER_MSI_OPERATION_INVALID'
  Assert-ThrowsCode {
    ConvertTo-EkyMsiExecArgumentsToken -Arguments @()
  } 'INSTALLER_MSI_ARGUMENTS_INVALID'

  $hostArguments = @(
    '/x',
    '{00000000-0000-0000-0000-000000000000}',
    '/qn',
    '/norestart'
  )
  $unobservedHostExitCode = Invoke-EkyMsiExecProcess `
    -Arguments $hostArguments -Operation downgrade
  $hostArgumentRoundTripExitCode = Invoke-EkyMsiExecProcess `
    -Arguments $hostArguments -Operation downgrade -EmitSafeProgress $true `
    -ProgressWriter {
      param([string]$Line)
      $hostObservationLines.Add($Line)
    }
  Assert-Equal $hostArgumentRoundTripExitCode 1605 `
    'INSTALLER_MSI_RUNNER_HOST_ARGUMENT_ROUND_TRIP_INVALID'
  Assert-Equal $hostArgumentRoundTripExitCode $unobservedHostExitCode `
    'INSTALLER_MSI_RUNNER_OBSERVATION_CHANGED_EXIT_CODE'
  $hostObservations = @($hostObservationLines | ForEach-Object {
    ConvertFrom-Json -InputObject $_
  })
  foreach ($observation in $hostObservations) {
    $keys = @($observation.PSObject.Properties.Name | Sort-Object)
    Assert-Equal (
      @(Compare-Object $keys @(
        'durationMs', 'elapsedMs', 'operation', 'phase', 'status'
      )).Count
    ) 0 'INSTALLER_MSI_RUNNER_OBSERVATION_KEYS_INVALID'
    Assert-Equal $observation.operation downgrade `
      'INSTALLER_MSI_RUNNER_OBSERVATION_OPERATION_INVALID'
  }
  $hostPhases = @($hostObservations | ForEach-Object { $_.phase })
  foreach ($requiredPhase in @(
    'hostStarted',
    'hostIdentityCaptured',
    'waitStarted',
    'hostExited',
    'processTreeAbsent'
  )) {
    Assert-Equal ($hostPhases -contains $requiredPhase) $true `
      'INSTALLER_MSI_RUNNER_OBSERVATION_PHASE_MISSING'
  }
  Assert-ThrowsCode {
    New-EkyMsiProcessObservationContext -Operation unknown_operation `
      -Enabled $true
  } 'INSTALLER_MSI_OPERATION_INVALID'
  $invalidObservationContext = New-EkyMsiProcessObservationContext `
    -Operation downgrade -Enabled $true -Writer { param([string]$Line) }
  Assert-ThrowsCode {
    Write-EkyMsiProcessObservation -Context $invalidObservationContext `
      -Phase unknownPhase -Status started
  } 'INSTALLER_MSI_PROCESS_OBSERVATION_INVALID'

  Assert-ThrowsCode {
    Remove-EkyInstallerTestDirectory -Path (Join-Path `
      ([IO.Path]::GetTempPath()) `
      ('invalid-installer-test-' + [Guid]::NewGuid().ToString('N')))
  } 'INSTALLER_TEST_DIRECTORY_PATH_INVALID'
  $longPathCleanupRoot = Join-Path ([IO.Path]::GetTempPath()) `
    ('eky-installer-upgrade-' + [Guid]::NewGuid().ToString('N'))
  $longPathCleanupLeaf = $longPathCleanupRoot
  for ($index = 0; $index -lt 12; $index += 1) {
    $longPathCleanupLeaf += '\segment' + $index.ToString('00') + ('x' * 20)
  }
  $extendedLongPathCleanupLeaf = '\\?\' + $longPathCleanupLeaf
  [IO.Directory]::CreateDirectory($extendedLongPathCleanupLeaf) | Out-Null
  [IO.File]::WriteAllText(
    ($extendedLongPathCleanupLeaf + '\proof.txt'),
    'proof'
  )
  if (($longPathCleanupLeaf + '\proof.txt').Length -le 260) {
    throw 'INSTALLER_TEST_DIRECTORY_LONG_PATH_FIXTURE_INVALID'
  }
  Remove-EkyInstallerTestDirectory -Path $longPathCleanupRoot
  Assert-Equal (Test-Path -LiteralPath $longPathCleanupRoot) $false `
    'INSTALLER_TEST_DIRECTORY_CLEANUP_REMAINS'
  $longPathCleanupRoot = $null

  Assert-EkyMsiExecExitCode -ExitCode 0 -Operation lifecycle_install
  Assert-EkyMsiExecExitCode -ExitCode 3010 -Operation lifecycle_install `
    -AllowedExitCodes @(0, 3010)
  Assert-ThrowsCode {
    Assert-EkyMsiExecExitCode -ExitCode 7 -Operation lifecycle_install
  } 'INSTALLER_LIFECYCLE_INSTALL_FAILED:7'
  Assert-EkyMsiExecExpectedFailureExitCode -ExitCode 7 `
    -Operation downgrade
  Assert-ThrowsCode {
    Assert-EkyMsiExecExpectedFailureExitCode -ExitCode 0 `
      -Operation downgrade
  } 'INSTALLER_DOWNGRADE_EXPECTED_FAILURE_MISSING'
  Assert-EkyMsiExecExitCode -ExitCode 0 -Operation w6b_target_install
  Assert-EkyMsiExecExitCode -ExitCode 0 -Operation w6b_uninstall

  $fastProcess = Start-MsiRunnerFixtureProcess -Command 'exit 0'
  $fastResult = Wait-EkyOwnedMsiProcess -Process $fastProcess `
    -TimeoutMilliseconds 5000
  Assert-Equal $fastResult.state exited `
    'INSTALLER_MSI_RUNNER_FAST_PROCESS_STATE_INVALID'
  Assert-Equal $fastResult.exitCode 0 `
    'INSTALLER_MSI_RUNNER_FAST_PROCESS_EXIT_INVALID'

  $observedExitProcess = Start-MsiRunnerFixtureProcess `
    -Command 'Start-Sleep -Milliseconds 500; exit 7'
  $observedExitContext = New-EkyMsiProcessObservationContext `
    -Operation w6b_target_install -Enabled $true -Writer {
      param([string]$Line)
      $observedExitLines.Add($Line)
    }
  $observedExitCode = Invoke-EkyOwnedMsiProcessLifecycle `
    -Process $observedExitProcess `
    -ErrorPrefix INSTALLER_MSI_RUNNER_SIMULATED `
    -TimeoutMilliseconds 5000 -HeartbeatMilliseconds 20 `
    -PollMilliseconds 10 -ObservationContext $observedExitContext
  Assert-Equal $observedExitCode 7 `
    'INSTALLER_MSI_RUNNER_OBSERVED_EXIT_CODE_CHANGED'
  $observedExitPhases = @($observedExitLines | ForEach-Object {
    (ConvertFrom-Json -InputObject $_).phase
  })
  foreach ($requiredPhase in @(
    'waitHeartbeat',
    'hostExited',
    'processTreeAbsent'
  )) {
    Assert-Equal ($observedExitPhases -contains $requiredPhase) $true `
      'INSTALLER_MSI_RUNNER_OBSERVED_EXIT_PHASE_MISSING'
  }

  $treeProcess = Start-MsiRunnerFixtureProcess -Command @'
$child = Start-Process powershell.exe -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-Command',
  'Start-Sleep -Milliseconds 350; exit 0'
) -WindowStyle Hidden -PassThru
try {
  [void]$child.WaitForExit()
  exit 7
}
finally {
  $child.Dispose()
}
'@
  $treeStopwatch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $treeResult = Wait-EkyOwnedMsiProcess -Process $treeProcess `
      -TimeoutMilliseconds 5000
  }
  finally {
    $treeStopwatch.Stop()
  }
  Assert-Equal $treeResult.state exited `
    'INSTALLER_MSI_RUNNER_TREE_STATE_INVALID'
  Assert-Equal $treeResult.exitCode 7 `
    'INSTALLER_MSI_RUNNER_TREE_EXIT_INVALID'
  Assert-Equal ($treeStopwatch.ElapsedMilliseconds -ge 250) $true `
    'INSTALLER_MSI_RUNNER_TREE_WAIT_INVALID'

  $sentinelProcess = Start-MsiRunnerFixtureProcess `
    -Command 'Start-Sleep -Seconds 30; exit 0'
  $ownedProcess = Start-MsiRunnerFixtureProcess -Command @'
$child = Start-Process powershell.exe -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30'
) -WindowStyle Hidden -PassThru
[void]$child.WaitForExit()
'@
  $ownedTreeIdentity = New-EkyProcessIdentity `
    -ProcessId ([int]$ownedProcess.Id) `
    -CreationToken (ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$ownedProcess.StartTime))
  $treeReadyDeadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $treeIdentities = @(
      Get-EkyOwnedProcessIdentitiesFromSnapshot `
        -RootIdentity $ownedTreeIdentity `
        -ProcessSnapshot (Get-EkyProcessSnapshot)
    )
    if ($treeIdentities.Count -ge 2) {
      break
    }
    if ([DateTime]::UtcNow -ge $treeReadyDeadline) {
      throw 'INSTALLER_MSI_RUNNER_OWNED_CHILD_MISSING'
    }
    [void]$ownedProcess.WaitForExit(25)
  } while ($true)
  $timeoutContext = New-EkyMsiProcessObservationContext `
    -Operation w6b_target_install -Enabled $true -Writer {
      param([string]$Line)
      $timeoutObservationLines.Add($Line)
    }
  Assert-ThrowsCode {
    Invoke-EkyOwnedMsiProcessLifecycle -Process $ownedProcess `
      -ErrorPrefix INSTALLER_MSI_RUNNER_SIMULATED `
      -TimeoutMilliseconds 50 -HeartbeatMilliseconds 20 `
      -PollMilliseconds 10 -ObservationContext $timeoutContext
  } 'INSTALLER_MSI_RUNNER_SIMULATED_TIMEOUT'
  $ownedProcess.Refresh()
  Assert-Equal $ownedProcess.HasExited $true `
    'INSTALLER_MSI_RUNNER_OWNED_PROCESS_REMAINS'
  $remainingTree = @(
    Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot `
      -OwnedProcessIdentities $treeIdentities `
      -ProcessSnapshot (Get-EkyProcessSnapshot)
  )
  Assert-Equal $remainingTree.Count 0 `
    'INSTALLER_MSI_RUNNER_OWNED_CHILD_REMAINS'
  $sentinelProcess.Refresh()
  Assert-Equal $sentinelProcess.HasExited $false `
    'INSTALLER_MSI_RUNNER_FOREIGN_SENTINEL_STOPPED'

  $timeoutObservations = @($timeoutObservationLines | ForEach-Object {
    ConvertFrom-Json -InputObject $_
  })
  $timeoutPhases = @($timeoutObservations | ForEach-Object { $_.phase })
  foreach ($requiredPhase in @(
    'waitHeartbeat',
    'waitTimedOut',
    'cleanupStarted',
    'cleanupCompleted',
    'processTreeAbsent'
  )) {
    Assert-Equal ($timeoutPhases -contains $requiredPhase) $true `
      'INSTALLER_MSI_RUNNER_TIMEOUT_OBSERVATION_MISSING'
  }

  $cleanupExitedProcess = Start-MsiRunnerFixtureProcess -Command 'exit 0'
  $cleanupExitedIdentity = New-EkyOwnedMsiProcessIdentity `
    -Process $cleanupExitedProcess
  [void]$cleanupExitedProcess.WaitForExit(5000)
  $cleanupExitedContext = New-EkyMsiProcessObservationContext `
    -Operation w6b_target_install -Enabled $true -Writer {
      param([string]$Line)
      $cleanupObservationLines.Add($Line)
    }
  Invoke-EkyOwnedMsiProcessCleanup -Process $cleanupExitedProcess `
    -Identity $cleanupExitedIdentity `
    -ErrorPrefix INSTALLER_MSI_RUNNER_SIMULATED `
    -ObservationContext $cleanupExitedContext

  $cleanupTimeoutProcess = Start-MsiRunnerFixtureProcess `
    -Command 'Start-Sleep -Seconds 30; exit 0'
  $cleanupTimeoutIdentity = New-EkyOwnedMsiProcessIdentity `
    -Process $cleanupTimeoutProcess
  Assert-ThrowsCode {
    Invoke-EkyOwnedMsiProcessCleanup -Process $cleanupTimeoutProcess `
      -Identity $cleanupTimeoutIdentity `
      -ErrorPrefix INSTALLER_MSI_RUNNER_SIMULATED `
      -ObservationContext $cleanupExitedContext -CleanupAction {
        param($Process, $Identity)
        throw 'INSTALLER_MSI_PROCESS_CLEANUP_TIMEOUT'
      }
  } 'INSTALLER_MSI_RUNNER_SIMULATED_CLEANUP_FAILED'
  Stop-EkyOwnedMsiProcess -Process $cleanupTimeoutProcess `
    -Identity $cleanupTimeoutIdentity -TimeoutMilliseconds 5000

  $safeObservationPattern = `
    '^\{"operation":"[a-z0-9_]+","phase":"[A-Za-z]+","status":"[a-z]+","durationMs":\d+,"elapsedMs":\d+\}$'
  foreach ($line in @(
    $hostObservationLines + $observedExitLines + $timeoutObservationLines +
      $cleanupObservationLines
  )) {
    Assert-Equal ($line -cmatch $safeObservationPattern) $true `
      'INSTALLER_MSI_RUNNER_OBSERVATION_PAYLOAD_UNSAFE'
    Assert-Equal (
      $line -match '(?i)(path|pid|command|stack|stdout|stderr|\.msi)'
    ) $false 'INSTALLER_MSI_RUNNER_OBSERVATION_PAYLOAD_UNSAFE'
  }

  Assert-ThrowsCode {
    Wait-EkyOwnedMsiProcess -Process $sentinelProcess `
      -TimeoutMilliseconds 0
  } 'INSTALLER_MSI_PROCESS_WAIT_INVALID'

  $successResult = [ordered]@{
    status = 'succeeded'
    boundedInstallPolicy = $true
    boundedUninstallPolicy = $true
    fastExitValidated = $true
    observedExitValidated = $true
    hostArgumentRoundTripValidated = $true
    hostExitBeforeCleanupValidated = $true
    longPathCleanupValidated = $true
    nonzeroExitPreserved = $true
    safeProcessObservability = $true
    timeoutValidated = $true
    timeoutCleanupFailurePreserved = $true
    ownedTreeWaitValidated = $true
    exactOwnedCleanup = $true
    foreignSentinelUntouched = $true
    orphanProcessCount = 0
  }
}
catch {
  $candidate = ([string]$_.Exception.Message -split ':')[0]
  $failureCode = if ($candidate -match '^INSTALLER_[A-Z0-9_]+$') {
    $candidate
  }
  else {
    'INSTALLER_MSI_RUNNER_UNEXPECTED_ERROR'
  }
}
finally {
  foreach ($process in @(
    $ownedProcess,
    $sentinelProcess,
    $fastProcess,
    $observedExitProcess,
    $treeProcess,
    $cleanupExitedProcess,
    $cleanupTimeoutProcess
  )) {
    if ($null -eq $process) {
      continue
    }
    try {
      $process.Refresh()
      if (!$process.HasExited) {
        Stop-EkyProcessTree -Process $process -TimeoutMilliseconds 5000
      }
    }
    catch {
      $failureCode = 'INSTALLER_MSI_RUNNER_CLEANUP_FAILED'
    }
    finally {
      $process.Dispose()
    }
  }
  if ($null -ne $longPathCleanupRoot) {
    try {
      Remove-EkyInstallerTestDirectory -Path $longPathCleanupRoot
    }
    catch {
      $failureCode = 'INSTALLER_MSI_RUNNER_CLEANUP_FAILED'
    }
  }
}

if ($null -ne $failureCode) {
  [ordered]@{
    status = 'failed'
    errorCode = $failureCode
  } | ConvertTo-Json -Compress
  exit 1
}

$successResult | ConvertTo-Json -Compress

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
$treeProcess = $null
$treeIdentities = @()
$hostArgumentRoundTripExitCode = $null
$longPathCleanupRoot = $null
$failureCode = $null
$successResult = $null
try {
  $installPolicy = Get-EkyMsiExecPolicy -Operation w6b_target_install
  $uninstallPolicy = Get-EkyMsiExecPolicy -Operation w6b_uninstall
  Assert-Equal ($installPolicy.timeoutMilliseconds -gt 0) $true `
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

  $hostArgumentRoundTripExitCode = Invoke-EkyMsiExecProcess -Arguments @(
    '/x',
    '{00000000-0000-0000-0000-000000000000}',
    '/qn',
    '/norestart'
  ) -Operation downgrade
  Assert-Equal $hostArgumentRoundTripExitCode 1605 `
    'INSTALLER_MSI_RUNNER_HOST_ARGUMENT_ROUND_TRIP_INVALID'

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
  $ownedIdentity = New-EkyOwnedMsiProcessIdentity -Process $ownedProcess
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
  $timedResult = Wait-EkyOwnedMsiProcess -Process $ownedProcess `
    -TimeoutMilliseconds 50
  Assert-Equal $timedResult.state timedOut `
    'INSTALLER_MSI_RUNNER_TIMEOUT_STATE_INVALID'
  Stop-EkyOwnedMsiProcess -Process $ownedProcess -Identity $ownedIdentity `
    -TimeoutMilliseconds 5000
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

  Assert-ThrowsCode {
    Wait-EkyOwnedMsiProcess -Process $sentinelProcess `
      -TimeoutMilliseconds 0
  } 'INSTALLER_MSI_PROCESS_WAIT_INVALID'

  $successResult = [ordered]@{
    status = 'succeeded'
    boundedInstallPolicy = $true
    boundedUninstallPolicy = $true
    fastExitValidated = $true
    hostArgumentRoundTripValidated = $true
    longPathCleanupValidated = $true
    timeoutValidated = $true
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
    $treeProcess
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

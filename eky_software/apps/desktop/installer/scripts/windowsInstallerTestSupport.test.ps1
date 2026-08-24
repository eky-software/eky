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

  $sentinelProcess = Start-MsiRunnerFixtureProcess `
    -Command 'Start-Sleep -Seconds 30; exit 0'
  $ownedProcess = Start-MsiRunnerFixtureProcess `
    -Command 'Start-Sleep -Seconds 30; exit 0'
  $ownedIdentity = New-EkyOwnedMsiProcessIdentity -Process $ownedProcess
  $timedResult = Wait-EkyOwnedMsiProcess -Process $ownedProcess `
    -TimeoutMilliseconds 50
  Assert-Equal $timedResult.state timedOut `
    'INSTALLER_MSI_RUNNER_TIMEOUT_STATE_INVALID'
  Stop-EkyOwnedMsiProcess -Process $ownedProcess -Identity $ownedIdentity `
    -TimeoutMilliseconds 5000
  $ownedProcess.Refresh()
  Assert-Equal $ownedProcess.HasExited $true `
    'INSTALLER_MSI_RUNNER_OWNED_PROCESS_REMAINS'
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
    timeoutValidated = $true
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
  foreach ($process in @($ownedProcess, $sentinelProcess, $fastProcess)) {
    if ($null -eq $process) {
      continue
    }
    try {
      $process.Refresh()
      if (!$process.HasExited) {
        $process.Kill()
        [void]$process.WaitForExit(5000)
      }
    }
    catch {
      $failureCode = 'INSTALLER_MSI_RUNNER_CLEANUP_FAILED'
    }
    finally {
      $process.Dispose()
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

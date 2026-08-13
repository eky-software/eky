Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'installerUpgradeProcessTreeTestSupport.ps1')
. (Join-Path $PSScriptRoot 'installerUpgradeOutcomeTestSupport.ps1')
. (Join-Path $PSScriptRoot 'installerUpgradeProgress.ps1')
. (Join-Path $PSScriptRoot 'windowsInstallerTestSupport.ps1')

$assertionCount = 0

function Assert-Equal {
  param($Actual, $Expected, [string]$Code)

  $script:assertionCount += 1
  if ($Actual -ne $Expected) {
    throw $Code
  }
}

function Assert-ThrowsCode {
  param([scriptblock]$Operation, [string]$ExpectedCode, [string]$Code)

  $script:assertionCount += 1
  try {
    & $Operation
  }
  catch {
    if ($_.Exception.Message -eq $ExpectedCode) {
      return
    }
    throw $Code
  }
  throw $Code
}

function New-TestProcessIdentity {
  param([int]$ProcessId, [long]$CreationTimeUtcTicks)

  return [pscustomobject]@{
    CreationTimeUtcTicks = $CreationTimeUtcTicks
    ProcessId = $ProcessId
  }
}

function New-TestProcessRecord {
  param([int]$ProcessId, [int]$ParentProcessId, [long]$CreationTimeUtcTicks)

  return [pscustomobject]@{
    CreationDate = [DateTime]::new(
      $CreationTimeUtcTicks,
      [DateTimeKind]::Utc
    )
    ParentProcessId = $ParentProcessId
    ProcessId = $ProcessId
  }
}

foreach ($taskkillOutcome in @(
  'notRequired',
  'zero',
  'nonzero',
  'timeout',
  'startFailed'
)) {
  Assert-Equal (
    Resolve-EkyInstallerProcessTreeCleanupDecision `
      -TaskkillOutcomeClass $taskkillOutcome -RemainingProcessCount 0
  ) 'success' 'INSTALLER_TEST_PROCESS_ABSENCE_NOT_AUTHORITATIVE'
}
Assert-Equal (
  Resolve-EkyInstallerProcessTreeCleanupDecision `
    -TaskkillOutcomeClass 'nonzero' -RemainingProcessCount 1
) 'processTreeRemains' 'INSTALLER_TEST_REMAINING_PROCESS_ACCEPTED'

$root = New-TestProcessIdentity -ProcessId 100 -CreationTimeUtcTicks 1000
$child = New-TestProcessIdentity -ProcessId 101 -CreationTimeUtcTicks 1100
$records = @(
  New-TestProcessRecord -ProcessId 100 -ParentProcessId 1 `
    -CreationTimeUtcTicks 1000
  New-TestProcessRecord -ProcessId 101 -ParentProcessId 100 `
    -CreationTimeUtcTicks 1100
  New-TestProcessRecord -ProcessId 102 -ParentProcessId 101 `
    -CreationTimeUtcTicks 1200
  New-TestProcessRecord -ProcessId 900 -ParentProcessId 1 `
    -CreationTimeUtcTicks 900
)
$owned = @(Select-EkyInstallerOwnedProcessTree -RootIdentity $root `
  -SeedIdentities @($child) -ProcessRecords $records)
Assert-Equal $owned.Count 3 'INSTALLER_TEST_PROCESS_TREE_SCOPE_INVALID'
Assert-Equal (@($owned | Where-Object { $_.ProcessId -eq 900 }).Count) 0 `
  'INSTALLER_TEST_UNRELATED_PROCESS_TRACKED'

$reusedRootRecords = @(
  New-TestProcessRecord -ProcessId 100 -ParentProcessId 1 `
    -CreationTimeUtcTicks 5000
  New-TestProcessRecord -ProcessId 103 -ParentProcessId 100 `
    -CreationTimeUtcTicks 5100
)
$reusedSelection = @(Select-EkyInstallerOwnedProcessTree -RootIdentity $root `
  -SeedIdentities @($child) -ProcessRecords $reusedRootRecords)
Assert-Equal $reusedSelection.Count 2 'INSTALLER_TEST_PID_REUSE_ACCEPTED'
Assert-Equal (@($reusedSelection | Where-Object { $_.ProcessId -eq 103 }).Count) 0 `
  'INSTALLER_TEST_REUSED_ROOT_DESCENDANT_TRACKED'

$expiredChild = New-TestProcessIdentity -ProcessId 104 `
  -CreationTimeUtcTicks 1300
$selectionAfterChildExit = @(Select-EkyInstallerOwnedProcessTree `
  -RootIdentity $root -SeedIdentities @($child, $expiredChild) `
  -ProcessRecords @($records | Where-Object { $_.ProcessId -ne 104 }))
Assert-Equal (
  @($selectionAfterChildExit | Where-Object { $_.ProcessId -eq 104 }).Count
) 1 'INSTALLER_TEST_EXITED_TRACKED_CHILD_FORGOTTEN'
Assert-Equal (
  Resolve-EkyInstallerProcessTreeCleanupDecision `
    -TaskkillOutcomeClass 'nonzero' -RemainingProcessCount 0
) 'success' 'INSTALLER_TEST_FAST_CHILD_EXIT_REJECTED'

$cleanCurrent = [pscustomobject]@{
  BusinessDataUnchanged = $true
  CandidatePayloadMatches = $false
  CandidateProductInstalled = $false
  CandidateRegistrationMatches = $false
  CandidateRegistrationPresent = $false
  CurrentPayloadMatches = $true
  CurrentProductInstalled = $true
  CurrentRegistrationMatches = $true
  CurrentRegistrationPresent = $true
  ShortcutPresent = $true
}
$cleanCandidate = [pscustomobject]@{
  BusinessDataUnchanged = $true
  CandidatePayloadMatches = $true
  CandidateProductInstalled = $true
  CandidateRegistrationMatches = $true
  CandidateRegistrationPresent = $true
  CurrentPayloadMatches = $false
  CurrentProductInstalled = $false
  CurrentRegistrationMatches = $false
  CurrentRegistrationPresent = $false
  ShortcutPresent = $true
}
Assert-Equal (
  Resolve-EkyRunningUpgradeOutcome -ExitCode 1603 -State $cleanCurrent
) 'blocked-cleanly' 'INSTALLER_TEST_EXPECTED_BLOCK_REJECTED'
Assert-Equal (
  Resolve-EkyRunningUpgradeOutcome -ExitCode 0 -State $cleanCandidate
) 'succeeded' 'INSTALLER_TEST_SUCCESS_REJECTED'
Assert-ThrowsCode {
  Resolve-EkyRunningUpgradeOutcome -ExitCode 1620 -State $cleanCurrent
} 'INSTALLER_UPGRADE_RUNNING_PROCESS_OUTCOME_UNKNOWN' `
  'INSTALLER_TEST_UNKNOWN_FAILURE_ACCEPTED'
Assert-ThrowsCode {
  Resolve-EkyRunningUpgradeOutcome -ExitCode 3010 -State $cleanCandidate
} 'INSTALLER_UPGRADE_RESTART_REQUIRED_FORBIDDEN' `
  'INSTALLER_TEST_REBOOT_ACCEPTED'

foreach ($property in @(
  'BusinessDataUnchanged',
  'CurrentPayloadMatches',
  'CurrentProductInstalled',
  'CurrentRegistrationMatches',
  'ShortcutPresent'
)) {
  $mixed = $cleanCurrent.psobject.Copy()
  $mixed.$property = $false
  Assert-ThrowsCode {
    Resolve-EkyRunningUpgradeOutcome -ExitCode 1603 -State $mixed
  } 'INSTALLER_UPGRADE_MIXED_VERSION_STATE' `
    'INSTALLER_TEST_MIXED_CURRENT_STATE_ACCEPTED'
}
$mixedCandidateRegistration = $cleanCurrent.psobject.Copy()
$mixedCandidateRegistration.CandidateRegistrationPresent = $true
Assert-ThrowsCode {
  Resolve-EkyRunningUpgradeOutcome -ExitCode 1603 `
    -State $mixedCandidateRegistration
} 'INSTALLER_UPGRADE_MIXED_VERSION_STATE' `
  'INSTALLER_TEST_MIXED_REGISTRATION_ACCEPTED'

$mixedCandidatePayload = $cleanCurrent.psobject.Copy()
$mixedCandidatePayload.CandidatePayloadMatches = $true
Assert-ThrowsCode {
  Resolve-EkyRunningUpgradeOutcome -ExitCode 1603 `
    -State $mixedCandidatePayload
} 'INSTALLER_UPGRADE_MIXED_VERSION_STATE' `
  'INSTALLER_TEST_MIXED_CANDIDATE_PAYLOAD_ACCEPTED'

$mixedCurrentRegistration = $cleanCandidate.psobject.Copy()
$mixedCurrentRegistration.CurrentRegistrationPresent = $true
Assert-ThrowsCode {
  Resolve-EkyRunningUpgradeOutcome -ExitCode 0 `
    -State $mixedCurrentRegistration
} 'INSTALLER_UPGRADE_MIXED_VERSION_STATE' `
  'INSTALLER_TEST_MIXED_CURRENT_REGISTRATION_ACCEPTED'

$events = [System.Collections.Generic.List[object]]::new()
$clockValues = [System.Collections.Generic.Queue[DateTime]]::new()
$clockValues.Enqueue([DateTime]'2026-01-01T00:00:00Z')
foreach ($index in 1..80) {
  $clockValues.Enqueue(
    ([DateTime]'2026-01-01T00:00:00Z').AddSeconds($index)
  )
}
$observer = New-EkyInstallerUpgradeProgressObserver `
  -GetUtcNow { $clockValues.Dequeue() } `
  -WriteLine { param($Line) $events.Add(($Line | ConvertFrom-Json)) }
foreach ($phase in $script:EkyInstallerUpgradeProgressPhases) {
  $result = Invoke-EkyInstallerUpgradeProgressPhase -Observer $observer `
    -Phase $phase -Operation { 'ok' }
  Assert-Equal $result 'ok' 'INSTALLER_TEST_PROGRESS_CHANGED_RESULT'
}
foreach ($phase in $script:EkyInstallerUpgradeProgressPhases) {
  $phaseEvents = @($events | Where-Object { $_.phase -eq $phase })
  Assert-Equal $phaseEvents.Count 2 'INSTALLER_TEST_PROGRESS_TERMINAL_MISSING'
  Assert-Equal $phaseEvents[0].event 'phaseStarted' `
    'INSTALLER_TEST_PROGRESS_START_MISSING'
  Assert-Equal $phaseEvents[1].event 'phaseCompleted' `
    'INSTALLER_TEST_PROGRESS_COMPLETION_MISSING'
}

$privateLines = [System.Collections.Generic.List[string]]::new()
$privateClock = [System.Collections.Generic.Queue[DateTime]]::new()
$privateClock.Enqueue([DateTime]'2026-01-01T00:00:00Z')
$privateClock.Enqueue([DateTime]'2026-01-01T00:00:01Z')
$privateClock.Enqueue([DateTime]'2026-01-01T00:00:02Z')
$privateObserver = New-EkyInstallerUpgradeProgressObserver `
  -GetUtcNow { $privateClock.Dequeue() } `
  -WriteLine { param($Line) $privateLines.Add($Line) }
Assert-ThrowsCode {
  Invoke-EkyInstallerUpgradeProgressPhase -Observer $privateObserver `
    -Phase 'fixtureValidated' -Operation {
      throw 'C:\private\Eky.msi --runtime-session=secret STACK'
    }
} 'C:\private\Eky.msi --runtime-session=secret STACK' `
  'INSTALLER_TEST_PROGRESS_CHANGED_ERROR'
$privateOutput = $privateLines -join "`n"
if ($privateOutput -match 'private|Eky\.msi|runtime-session|secret|STACK') {
  throw 'INSTALLER_TEST_PROGRESS_LEAKED_PRIVATE_DATA'
}
if ($privateOutput -notmatch 'INSTALLER_UPGRADE_PROGRESS_FAILURE') {
  throw 'INSTALLER_TEST_PROGRESS_SAFE_ERROR_MISSING'
}

$writerFailureObserver = New-EkyInstallerUpgradeProgressObserver `
  -WriteLine { throw 'C:\private\writer-error' }
Assert-Equal (
  Invoke-EkyInstallerUpgradeProgressPhase -Observer $writerFailureObserver `
    -Phase 'fixtureValidated' -Operation { 'unchanged' }
) 'unchanged' 'INSTALLER_TEST_PROGRESS_WRITER_CHANGED_RESULT'
Assert-ThrowsCode {
  Invoke-EkyInstallerUpgradeProgressPhase -Observer $writerFailureObserver `
    -Phase 'unknownPhase' -Operation { 'not-run' }
} 'INSTALLER_UPGRADE_PROGRESS_PHASE_INVALID' `
  'INSTALLER_TEST_UNKNOWN_PROGRESS_PHASE_ACCEPTED'

$heartbeatEvents = [System.Collections.Generic.List[object]]::new()
$heartbeatClock = [System.Collections.Generic.Queue[DateTime]]::new()
foreach ($timestamp in @(
  '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:01Z',
  '2026-01-01T00:01:02Z',
  '2026-01-01T00:01:03Z'
)) {
  $heartbeatClock.Enqueue([DateTime]$timestamp)
}
$heartbeatObserver = New-EkyInstallerUpgradeProgressObserver `
  -GetUtcNow { $heartbeatClock.Dequeue() } `
  -WriteLine {
    param($Line)
    $heartbeatEvents.Add(($Line | ConvertFrom-Json))
  }
Assert-Equal (
  Invoke-EkyInstallerUpgradeProgressPhase -Observer $heartbeatObserver `
    -Phase 'runningUpgradeStarted' -Operation {
      Write-EkyInstallerUpgradeHeartbeat -Observer $heartbeatObserver
      'heartbeat-ok'
    }
) 'heartbeat-ok' 'INSTALLER_TEST_HEARTBEAT_CHANGED_RESULT'
$heartbeat = @(
  $heartbeatEvents | Where-Object { $_.event -eq 'heartbeat' }
)
Assert-Equal $heartbeat.Count 1 'INSTALLER_TEST_HEARTBEAT_MISSING'
Assert-Equal $heartbeat[0].phase 'runningUpgradeStarted' `
  'INSTALLER_TEST_HEARTBEAT_PHASE_INVALID'

$cleanupEvents = [System.Collections.Generic.List[object]]::new()
$cleanupObserver = New-EkyInstallerUpgradeProgressObserver `
  -WriteLine {
    param($Line)
    $cleanupEvents.Add(($Line | ConvertFrom-Json))
  }
Write-EkyInstallerUpgradeProcessCleanupSummary -Observer $cleanupObserver `
  -Summary ([pscustomobject]@{
    Decision = 'success'
    DurationMs = 25
    RemainingProcessCount = 0
    TaskkillOutcomeClass = 'nonzero'
    TrackedProcessCount = 3
  })
Assert-Equal $cleanupEvents.Count 1 `
  'INSTALLER_TEST_CLEANUP_SUMMARY_MISSING'
Assert-Equal $cleanupEvents[0].event 'processCleanupOutcome' `
  'INSTALLER_TEST_CLEANUP_SUMMARY_EVENT_INVALID'
Assert-Equal $cleanupEvents[0].taskkillOutcomeClass 'nonzero' `
  'INSTALLER_TEST_CLEANUP_SUMMARY_OUTCOME_INVALID'

foreach ($iteration in 0..31) {
  $expectedExitCode = if ($iteration % 2 -eq 0) { 0 } else { 7 }
  $process = Start-EkyTrackedInstallerProcess -FilePath 'cmd.exe' `
    -ArgumentList @('/d', '/c', "exit $expectedExitCode")
  $waitOutput = @(
    Wait-EkyInstallerProcessExitCode -Process $process
  )
  Assert-Equal $waitOutput.Count 1 `
    'INSTALLER_TEST_WAIT_EXIT_CODE_OUTPUT_INVALID'
  Assert-Equal $waitOutput[0] $expectedExitCode `
    'INSTALLER_TEST_WAIT_EXIT_CODE_MISSING'
}

$script:installerWaitCallbackCount = 0
$waitCommand = 'Start-Sleep -Milliseconds 1200; exit 21'
$encodedWaitCommand = [Convert]::ToBase64String(
  [Text.Encoding]::Unicode.GetBytes($waitCommand)
)
$waitProcess = Start-EkyTrackedInstallerProcess -FilePath 'powershell.exe' `
  -ArgumentList @('-NoProfile', '-EncodedCommand', $encodedWaitCommand)
$waitOutput = @(
  Wait-EkyInstallerProcessExitCode -Process $waitProcess -OnWait {
    $script:installerWaitCallbackCount += 1
    'OBSERVABILITY_OUTPUT_MUST_NOT_ESCAPE'
    throw 'OBSERVABILITY_FAILURE_MUST_NOT_ESCAPE'
  }
)
Assert-Equal $waitOutput.Count 1 `
  'INSTALLER_TEST_WAIT_CALLBACK_OUTPUT_ESCAPED'
Assert-Equal ($script:installerWaitCallbackCount -gt 0) $true `
  'INSTALLER_TEST_WAIT_CALLBACK_MISSING'
Assert-Equal $waitOutput[0] 21 `
  'INSTALLER_TEST_WAIT_CALLBACK_CHANGED_EXIT_CODE'

$rollbackBarrierRoot = Join-Path $env:TEMP `
  "eky-rollback-launcher-barrier-$([guid]::NewGuid().ToString('N'))"
$rollbackLauncher = $null
$rollbackProcess = $null
try {
  New-Item -ItemType Directory -Path $rollbackBarrierRoot | Out-Null
  $failedPackagePath = Join-Path $rollbackBarrierRoot 'failed.msi'
  $rollbackPackagePath = Join-Path $rollbackBarrierRoot 'rollback.msi'
  $launcherProbePath = Join-Path $env:SystemRoot 'System32\ping.exe'
  $syntheticMsiExecPath = Join-Path $env:SystemRoot 'System32\whoami.exe'
  [System.IO.File]::WriteAllText($failedPackagePath, 'failed-fixture')
  [System.IO.File]::WriteAllText($rollbackPackagePath, 'rollback-fixture')
  $rollbackLauncher = Start-EkyTrackedInstallerProcess `
    -FilePath $launcherProbePath -ArgumentList @(
      '127.0.0.1',
      '-n',
      '60',
      '-w',
      '1000'
    )
  if ($rollbackLauncher.HasExited) {
    throw 'INSTALLER_TEST_ROLLBACK_LAUNCHER_EXITED_EARLY'
  }
  $rollbackScriptPath = (Resolve-Path -LiteralPath (
      Join-Path $PSScriptRoot '..\..\resources\update\rollbackWindowsInstaller.ps1'
    )).Path
  $rollbackProcess = Start-EkyTrackedInstallerProcess `
    -FilePath 'powershell.exe' -ArgumentList @(
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      "`"$rollbackScriptPath`"",
      '-MsiExecPath',
      "`"$syntheticMsiExecPath`"",
      '-FailedProductCode',
      '{FFFFFFFF-FFFF-4FFF-8FFF-FFFFFFFFFFFF}',
      '-LauncherProcessId',
      $rollbackLauncher.Id,
      '-FailedPackagePath',
      "`"$failedPackagePath`"",
      '-RollbackPackagePath',
      "`"$rollbackPackagePath`""
    )
  Assert-Equal $rollbackProcess.WaitForExit(15000) $false `
    'INSTALLER_TEST_ROLLBACK_BARRIER_RELEASED_EARLY'
  $rollbackLauncher.Kill()
  $rollbackLauncher.WaitForExit(5000) | Out-Null
  try {
    $rollbackExitCode = Wait-EkyInstallerProcessExitCode `
      -Process $rollbackProcess
  }
  finally {
    $rollbackProcess = $null
  }
  Assert-Equal (@(0, 20, 21, 22, 23) -contains $rollbackExitCode) $true `
    'INSTALLER_TEST_ROLLBACK_BARRIER_NOT_CROSSED'
}
finally {
  if ($null -ne $rollbackProcess) {
    if (!$rollbackProcess.HasExited) {
      $rollbackProcess.Kill()
      $rollbackProcess.WaitForExit(5000) | Out-Null
    }
    $rollbackProcess.Dispose()
  }
  if ($null -ne $rollbackLauncher) {
    if (!$rollbackLauncher.HasExited) {
      $rollbackLauncher.Kill()
      $rollbackLauncher.WaitForExit(5000) | Out-Null
    }
    $rollbackLauncher.Dispose()
  }
  if (Test-Path -LiteralPath $rollbackBarrierRoot) {
    Remove-Item -LiteralPath $rollbackBarrierRoot -Recurse -Force
  }
}

[ordered]@{
  assertionCount = $assertionCount
  status = 'ok'
} | ConvertTo-Json -Compress

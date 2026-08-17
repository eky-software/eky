Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerProcessTree.ps1')

$allowedStages = @(
  'initialization',
  'ownershipRules',
  'outcomeRules',
  'pidReuseRules',
  'alreadyExitedProcess',
  'fixtureStartup',
  'fixtureReadiness',
  'ownedTreeSnapshot',
  'ownedTreeStop',
  'postcondition',
  'cleanup',
  'completed'
)
$allowedErrorCodes = @(
  'none',
  'INSTALLER_PROCESS_TREE_OWNERSHIP_INVALID',
  'INSTALLER_PROCESS_TREE_UNRELATED_INCLUDED',
  'INSTALLER_PROCESS_TREE_EXIT_ZERO_INVALID',
  'INSTALLER_PROCESS_TREE_NONZERO_GONE_INVALID',
  'INSTALLER_PROCESS_TREE_ROOT_WAIT_INVALID',
  'INSTALLER_PROCESS_TREE_CHILD_EXIT_WAIT_INVALID',
  'INSTALLER_PROCESS_TREE_CHILD_EXIT_STOP_INVALID',
  'INSTALLER_PROCESS_TREE_EXPECTED_ERROR_MISSING',
  'INSTALLER_PROCESS_TREE_REUSED_ROOT_INCLUDED',
  'INSTALLER_PROCESS_TREE_REUSED_PID_REMAINS',
  'INSTALLER_PROCESS_TREE_FIXTURE_ROOT_EXITED',
  'INSTALLER_PROCESS_TREE_READINESS_TIMEOUT',
  'INSTALLER_PROCESS_TREE_CHILD_MISSING',
  'INSTALLER_PROCESS_TREE_ROOT_REMAINS',
  'INSTALLER_PROCESS_TREE_UNRELATED_STOPPED',
  'INSTALLER_PROCESS_TREE_CLEANUP_FAILED',
  'INSTALLER_PROCESS_TREE_UNEXPECTED_ERROR',
  'INSTALLER_UPGRADE_PROCESS_IDENTITY_INVALID',
  'INSTALLER_UPGRADE_PROCESS_TREE_WAIT_INVALID',
  'INSTALLER_UPGRADE_PROCESS_TREE_REMAINS'
)

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
      throw 'INSTALLER_PROCESS_TREE_UNEXPECTED_ERROR'
    }
    return
  }
  throw 'INSTALLER_PROCESS_TREE_EXPECTED_ERROR_MISSING'
}

function New-SnapshotRecord {
  param([int]$ProcessId, [int]$ParentProcessId, [string]$CreationToken)
  return [pscustomobject]@{
    processId = $ProcessId
    parentProcessId = $ParentProcessId
    creationToken = $CreationToken
  }
}

function ConvertTo-EncodedPowerShellCommand {
  param([Parameter(Mandatory = $true)][string]$Command)

  return [Convert]::ToBase64String(
    [Text.Encoding]::Unicode.GetBytes($Command)
  )
}

function Wait-EkyFixtureReady {
  param(
    [Parameter(Mandatory = $true)][string]$MarkerPath,
    [Parameter(Mandatory = $true)]$RootProcess,
    [int]$TimeoutMilliseconds = 5000,
    [int]$PollMilliseconds = 25
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    while (!(Test-Path -LiteralPath $MarkerPath -PathType Leaf)) {
      $RootProcess.Refresh()
      if ($RootProcess.HasExited) {
        throw 'INSTALLER_PROCESS_TREE_FIXTURE_ROOT_EXITED'
      }
      if ($stopwatch.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
        throw 'INSTALLER_PROCESS_TREE_READINESS_TIMEOUT'
      }
      Start-Sleep -Milliseconds $PollMilliseconds
    }
  }
  finally {
    $stopwatch.Stop()
  }
}

function Wait-EkyOwnedTreeReady {
  param(
    [Parameter(Mandatory = $true)]$RootIdentity,
    [int]$TimeoutMilliseconds = 5000,
    [int]$PollMilliseconds = 25
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    do {
      $identities = @(
        Get-EkyOwnedProcessIdentitiesFromSnapshot `
          -RootIdentity $RootIdentity `
          -ProcessSnapshot (Get-EkyProcessSnapshot)
      )
      if ($identities.Count -ge 2) {
        return [pscustomobject]@{ identities = $identities }
      }
      if ($stopwatch.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
        throw 'INSTALLER_PROCESS_TREE_CHILD_MISSING'
      }
      Start-Sleep -Milliseconds $PollMilliseconds
    } while ($true)
  }
  finally {
    $stopwatch.Stop()
  }
}

function Wait-EkyOwnedProcessesReleased {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][array]
    $OwnedProcessIdentities,
    [int]$TimeoutMilliseconds = 5000,
    [int]$PollMilliseconds = 25
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    do {
      $remaining = @(
        Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot `
          -OwnedProcessIdentities $OwnedProcessIdentities `
          -ProcessSnapshot (Get-EkyProcessSnapshot)
      )
      if ($remaining.Count -eq 0) {
        return [pscustomobject]@{ identities = @() }
      }
      if ($stopwatch.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
        return [pscustomobject]@{ identities = $remaining }
      }
      Start-Sleep -Milliseconds $PollMilliseconds
    } while ($true)
  }
  finally {
    $stopwatch.Stop()
  }
}

$stage = 'initialization'
$errorCode = 'none'
$status = 'failed'
$trackedCount = 0
$remainingCount = 0
$deadlineReached = $false
$taskkillExitClass = 'notStarted'
$orphanProcessCount = 0
$exactIdentity = $false
$postcondition = $false
$unrelatedProcessUntouched = $false
$privateTempRoot = $null
$unrelated = $null
$ownedRoot = $null
$ownedRootIdentity = $null
$ownedIdentitiesForCleanup = @()
$stopObservation = @{
  trackedCount = 0
  remainingCount = 0
  deadlineReached = $false
  taskkillExitClass = 'notStarted'
}

try {
  $stage = 'ownershipRules'
  $rootIdentity = New-EkyProcessIdentity -ProcessId 100 -CreationToken '1000'
  $snapshot = @(
    New-SnapshotRecord -ProcessId 100 -ParentProcessId 1 -CreationToken '1000'
    New-SnapshotRecord -ProcessId 101 -ParentProcessId 100 -CreationToken '1001'
    New-SnapshotRecord -ProcessId 102 -ParentProcessId 101 -CreationToken '1002'
    New-SnapshotRecord -ProcessId 200 -ParentProcessId 1 -CreationToken '2000'
  )
  $owned = Get-EkyOwnedProcessIdentitiesFromSnapshot `
    -RootIdentity $rootIdentity -ProcessSnapshot $snapshot
  Assert-Equal $owned.Count 3 'INSTALLER_PROCESS_TREE_OWNERSHIP_INVALID'
  if (@($owned | Where-Object { $_.processId -eq 200 }).Count -ne 0) {
    throw 'INSTALLER_PROCESS_TREE_UNRELATED_INCLUDED'
  }

  $stage = 'outcomeRules'
  Assert-Equal (Get-EkyProcessTreeStopOutcome -TaskkillExitCode 0 `
    -RemainingOwnedProcessIdentities @() -DeadlineReached $false) `
    'stopped' 'INSTALLER_PROCESS_TREE_EXIT_ZERO_INVALID'
  Assert-Equal (Get-EkyProcessTreeStopOutcome -TaskkillExitCode 128 `
    -RemainingOwnedProcessIdentities @() -DeadlineReached $false) `
    'stopped' 'INSTALLER_PROCESS_TREE_NONZERO_GONE_INVALID'
  Assert-Equal (Get-EkyProcessTreeStopOutcome -TaskkillExitCode 128 `
    -RemainingOwnedProcessIdentities @($rootIdentity) `
    -DeadlineReached $false) `
    'waiting' 'INSTALLER_PROCESS_TREE_ROOT_WAIT_INVALID'
  Assert-ThrowsCode {
    Get-EkyProcessTreeStopOutcome -TaskkillExitCode 128 `
      -RemainingOwnedProcessIdentities @($rootIdentity) `
      -DeadlineReached $true
  } 'INSTALLER_UPGRADE_PROCESS_TREE_REMAINS'
  $childIdentity = New-EkyProcessIdentity -ProcessId 101 -CreationToken '1001'
  Assert-ThrowsCode {
    Get-EkyProcessTreeStopOutcome -TaskkillExitCode 128 `
      -RemainingOwnedProcessIdentities @($childIdentity) `
      -DeadlineReached $true
  } 'INSTALLER_UPGRADE_PROCESS_TREE_REMAINS'
  Assert-Equal (Get-EkyProcessTreeStopOutcome -TaskkillExitCode 128 `
    -RemainingOwnedProcessIdentities @($childIdentity) `
    -DeadlineReached $false) `
    'waiting' 'INSTALLER_PROCESS_TREE_CHILD_EXIT_WAIT_INVALID'
  Assert-Equal (Get-EkyProcessTreeStopOutcome -TaskkillExitCode 128 `
    -RemainingOwnedProcessIdentities @() -DeadlineReached $false) `
    'stopped' 'INSTALLER_PROCESS_TREE_CHILD_EXIT_STOP_INVALID'

  $stage = 'pidReuseRules'
  $reusedSnapshot = @(
    New-SnapshotRecord -ProcessId 100 -ParentProcessId 1 -CreationToken '9999'
    New-SnapshotRecord -ProcessId 101 -ParentProcessId 100 -CreationToken '1001'
  )
  Assert-Equal (@(Get-EkyOwnedProcessIdentitiesFromSnapshot `
    -RootIdentity $rootIdentity -ProcessSnapshot $reusedSnapshot).Count) 0 `
    'INSTALLER_PROCESS_TREE_REUSED_ROOT_INCLUDED'
  Assert-Equal (@(Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot `
    -OwnedProcessIdentities @($rootIdentity) `
    -ProcessSnapshot $reusedSnapshot).Count) 0 `
    'INSTALLER_PROCESS_TREE_REUSED_PID_REMAINS'

  $stage = 'alreadyExitedProcess'
  $alreadyExited = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-Command', 'exit 0'
  ) -WindowStyle Hidden -PassThru
  try {
    $alreadyExited.WaitForExit()
    Stop-EkyProcessTree -Process $alreadyExited -TimeoutMilliseconds 1000
  }
  finally {
    $alreadyExited.Dispose()
  }

  $stage = 'fixtureStartup'
  $privateTempRoot = Join-Path ([IO.Path]::GetTempPath()) `
    ('eky-process-tree-' + [Guid]::NewGuid().ToString('N'))
  [IO.Directory]::CreateDirectory($privateTempRoot) | Out-Null
  $readyMarkerPath = Join-Path $privateTempRoot 'ready'
  $escapedReadyMarkerPath = $readyMarkerPath.Replace("'", "''")
  $childCommand = @"
`$markerPath = '$escapedReadyMarkerPath'
[IO.File]::WriteAllText(`$markerPath, 'ready')
Start-Sleep -Seconds 30
"@
  $encodedChildCommand = ConvertTo-EncodedPowerShellCommand `
    -Command $childCommand
  $rootCommand = @"
`$markerPath = '$escapedReadyMarkerPath'
`$child = Start-Process powershell.exe -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-EncodedCommand', '$encodedChildCommand'
) -WindowStyle Hidden -PassThru
`$stopwatch = [Diagnostics.Stopwatch]::StartNew()
while (!(Test-Path -LiteralPath `$markerPath -PathType Leaf)) {
  `$child.Refresh()
  if (`$child.HasExited -or `$stopwatch.ElapsedMilliseconds -ge 5000) {
    exit 21
  }
  Start-Sleep -Milliseconds 25
}
Start-Sleep -Seconds 30
"@
  $encodedRootCommand = ConvertTo-EncodedPowerShellCommand `
    -Command $rootCommand
  $unrelated = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30'
  ) -WindowStyle Hidden -PassThru
  $ownedRoot = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-EncodedCommand', $encodedRootCommand
  ) -WindowStyle Hidden -PassThru
  $ownedRootIdentity = New-EkyProcessIdentity `
    -ProcessId ([int]$ownedRoot.Id) `
    -CreationToken (ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$ownedRoot.StartTime))

  $stage = 'fixtureReadiness'
  Wait-EkyFixtureReady -MarkerPath $readyMarkerPath `
    -RootProcess $ownedRoot -TimeoutMilliseconds 5000

  $stage = 'ownedTreeSnapshot'
  $readyTree = Wait-EkyOwnedTreeReady -RootIdentity $ownedRootIdentity `
    -TimeoutMilliseconds 5000
  $ownedIdentitiesForCleanup = @($readyTree.identities)
  $trackedCount = $ownedIdentitiesForCleanup.Count

  $stage = 'ownedTreeStop'
  Stop-EkyProcessTree -Process $ownedRoot -TimeoutMilliseconds 5000 `
    -Observation $stopObservation
  $trackedCount = [int]$stopObservation.trackedCount
  $remainingCount = [int]$stopObservation.remainingCount
  $deadlineReached = [bool]$stopObservation.deadlineReached
  $taskkillExitClass = [string]$stopObservation.taskkillExitClass

  $stage = 'postcondition'
  $ownedRoot.Refresh()
  Assert-Equal $ownedRoot.HasExited $true `
    'INSTALLER_PROCESS_TREE_ROOT_REMAINS'
  $unrelated.Refresh()
  Assert-Equal $unrelated.HasExited $false `
    'INSTALLER_PROCESS_TREE_UNRELATED_STOPPED'
  $exactIdentity = $true
  $postcondition = $true
  $unrelatedProcessUntouched = $true
  $status = 'succeeded'
  $stage = 'completed'
}
catch {
  $candidateErrorCode = [string]$_.Exception.Message
  if ($allowedErrorCodes -contains $candidateErrorCode) {
    $errorCode = $candidateErrorCode
  }
  else {
    $errorCode = 'INSTALLER_PROCESS_TREE_UNEXPECTED_ERROR'
  }
  $trackedCount = [int]$stopObservation.trackedCount
  $remainingCount = [int]$stopObservation.remainingCount
  $deadlineReached = [bool]$stopObservation.deadlineReached
  $taskkillExitClass = [string]$stopObservation.taskkillExitClass
}
finally {
  $stageBeforeCleanup = $stage
  try {
    if ($null -ne $ownedRoot) {
      $ownedRoot.Refresh()
      if (!$ownedRoot.HasExited) {
        Stop-EkyProcessTree -Process $ownedRoot -TimeoutMilliseconds 5000
      }
    }
    $cleanupResult = Wait-EkyOwnedProcessesReleased `
      -OwnedProcessIdentities $ownedIdentitiesForCleanup `
      -TimeoutMilliseconds 5000
    $orphanProcessCount = @($cleanupResult.identities).Count
    if ($orphanProcessCount -ne 0) {
      throw 'INSTALLER_PROCESS_TREE_CLEANUP_FAILED'
    }
    if ($null -ne $unrelated) {
      $unrelated.Refresh()
      if (!$unrelated.HasExited) {
        Stop-Process -Id $unrelated.Id -Force -ErrorAction Stop
        if (!$unrelated.WaitForExit(5000)) {
          throw 'INSTALLER_PROCESS_TREE_CLEANUP_FAILED'
        }
      }
    }
    if ($null -ne $privateTempRoot -and (Test-Path -LiteralPath $privateTempRoot)) {
      Remove-Item -LiteralPath $privateTempRoot -Recurse -Force -ErrorAction Stop
    }
  }
  catch {
    $status = 'failed'
    $stageBeforeCleanup = 'cleanup'
    $candidateCleanupErrorCode = [string]$_.Exception.Message
    $errorCode = if ($allowedErrorCodes -contains $candidateCleanupErrorCode) {
      $candidateCleanupErrorCode
    }
    else {
      'INSTALLER_PROCESS_TREE_CLEANUP_FAILED'
    }
  }
  finally {
    if ($null -ne $ownedRoot) {
      $ownedRoot.Dispose()
    }
    if ($null -ne $unrelated) {
      $unrelated.Dispose()
    }
  }
  $stage = $stageBeforeCleanup
}

if ($allowedStages -notcontains $stage) {
  $stage = 'initialization'
  $status = 'failed'
  $errorCode = 'INSTALLER_PROCESS_TREE_UNEXPECTED_ERROR'
}
if ($allowedErrorCodes -notcontains $errorCode) {
  $status = 'failed'
  $errorCode = 'INSTALLER_PROCESS_TREE_UNEXPECTED_ERROR'
}
if ($taskkillExitClass -notin @('notStarted', 'zero', 'nonzero')) {
  $status = 'failed'
  $errorCode = 'INSTALLER_PROCESS_TREE_UNEXPECTED_ERROR'
  $taskkillExitClass = 'notStarted'
}

[ordered]@{
  status = $status
  stage = $stage
  errorCode = $errorCode
  trackedCount = $trackedCount
  remainingCount = $remainingCount
  deadlineReached = $deadlineReached
  taskkillExitClass = $taskkillExitClass
  exactIdentity = $exactIdentity
  postcondition = $postcondition
  unrelatedProcessUntouched = $unrelatedProcessUntouched
  orphanProcessCount = $orphanProcessCount
} | ConvertTo-Json -Compress

if ($status -ne 'succeeded') {
  exit 1
}

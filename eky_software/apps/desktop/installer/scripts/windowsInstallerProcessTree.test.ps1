Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerProcessTree.ps1')

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

Assert-Equal (Get-EkyProcessTreeStopOutcome -TaskkillExitCode 0 `
  -RemainingOwnedProcessIdentities @() -DeadlineReached $false) `
  'stopped' 'INSTALLER_PROCESS_TREE_EXIT_ZERO_INVALID'
Assert-Equal (Get-EkyProcessTreeStopOutcome -TaskkillExitCode 128 `
  -RemainingOwnedProcessIdentities @() -DeadlineReached $false) `
  'stopped' 'INSTALLER_PROCESS_TREE_NONZERO_GONE_INVALID'
Assert-Equal (Get-EkyProcessTreeStopOutcome -TaskkillExitCode 128 `
  -RemainingOwnedProcessIdentities @($rootIdentity) -DeadlineReached $false) `
  'waiting' 'INSTALLER_PROCESS_TREE_ROOT_WAIT_INVALID'
Assert-ThrowsCode {
  Get-EkyProcessTreeStopOutcome -TaskkillExitCode 128 `
    -RemainingOwnedProcessIdentities @($rootIdentity) -DeadlineReached $true
} 'INSTALLER_UPGRADE_PROCESS_TREE_REMAINS'
$childIdentity = New-EkyProcessIdentity -ProcessId 101 -CreationToken '1001'
Assert-ThrowsCode {
  Get-EkyProcessTreeStopOutcome -TaskkillExitCode 128 `
    -RemainingOwnedProcessIdentities @($childIdentity) -DeadlineReached $true
} 'INSTALLER_UPGRADE_PROCESS_TREE_REMAINS'

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

$alreadyExited = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-Command', 'exit 0'
) -WindowStyle Hidden -PassThru
$alreadyExited.WaitForExit()
Stop-EkyProcessTree -Process $alreadyExited -TimeoutMilliseconds 1000

$unrelated = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30'
) -WindowStyle Hidden -PassThru
$ownedRoot = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-Command',
  '$child = Start-Process powershell.exe -ArgumentList ''-NoProfile'', ''-NonInteractive'', ''-Command'', ''Start-Sleep -Seconds 30'' -WindowStyle Hidden -PassThru; Start-Sleep -Seconds 30'
) -WindowStyle Hidden -PassThru
$ownedIdentitiesForCleanup = @()
$remainingOwnedAfterCleanup = @()
try {
  Start-Sleep -Milliseconds 500
  $ownedRootIdentity = New-EkyProcessIdentity -ProcessId ([int]$ownedRoot.Id) `
    -CreationToken (ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$ownedRoot.StartTime))
  $ownedIdentitiesForCleanup = @(
    Get-EkyOwnedProcessIdentitiesFromSnapshot `
      -RootIdentity $ownedRootIdentity `
      -ProcessSnapshot (Get-EkyProcessSnapshot)
  )
  if ($ownedIdentitiesForCleanup.Count -lt 2) {
    throw 'INSTALLER_PROCESS_TREE_CHILD_MISSING'
  }
  Stop-EkyProcessTree -Process $ownedRoot -TimeoutMilliseconds 5000
  $ownedRoot.Refresh()
  Assert-Equal $ownedRoot.HasExited $true `
    'INSTALLER_PROCESS_TREE_ROOT_REMAINS'
  $unrelated.Refresh()
  Assert-Equal $unrelated.HasExited $false `
    'INSTALLER_PROCESS_TREE_UNRELATED_STOPPED'
}
finally {
  foreach ($ownedIdentity in $ownedIdentitiesForCleanup) {
    $identityStillExists = @(
      Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot `
        -OwnedProcessIdentities @($ownedIdentity) `
        -ProcessSnapshot (Get-EkyProcessSnapshot)
    ).Count -eq 1
    if ($identityStillExists) {
      Stop-Process -Id $ownedIdentity.processId -Force `
        -ErrorAction SilentlyContinue
    }
  }
  if (!$unrelated.HasExited) {
    Stop-Process -Id $unrelated.Id -Force -ErrorAction SilentlyContinue
  }
  $remainingOwnedAfterCleanup = @(
    Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot `
      -OwnedProcessIdentities $ownedIdentitiesForCleanup `
      -ProcessSnapshot (Get-EkyProcessSnapshot)
  )
}

[ordered]@{
  exactIdentity = $true
  postcondition = $true
  unrelatedProcessUntouched = $true
  orphanProcessCount = $remainingOwnedAfterCleanup.Count
} | ConvertTo-Json -Compress

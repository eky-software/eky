Set-StrictMode -Version Latest

function ConvertTo-EkyProcessCreationToken {
  param([Parameter(Mandatory = $true)][DateTime]$CreationTime)

  return [DateTimeOffset]::new(
    $CreationTime.ToUniversalTime()
  ).ToUnixTimeMilliseconds().ToString(
    [System.Globalization.CultureInfo]::InvariantCulture
  )
}

function New-EkyProcessIdentity {
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$CreationToken
  )

  if ($ProcessId -lt 1 -or $CreationToken -notmatch '^\d+$') {
    throw 'INSTALLER_UPGRADE_PROCESS_IDENTITY_INVALID'
  }
  return [pscustomobject]@{
    processId = $ProcessId
    creationToken = $CreationToken
  }
}

function ConvertTo-EkyProcessSnapshotRecord {
  param([Parameter(Mandatory = $true)]$Process)

  return [pscustomobject]@{
    processId = [int]$Process.ProcessId
    parentProcessId = [int]$Process.ParentProcessId
    creationToken = ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$Process.CreationDate)
  }
}

function Get-EkyProcessSnapshot {
  return @(
    Get-CimInstance Win32_Process -ErrorAction Stop |
      ForEach-Object { ConvertTo-EkyProcessSnapshotRecord -Process $_ }
  )
}

function Get-EkyOwnedProcessIdentitiesFromSnapshot {
  param(
    [Parameter(Mandatory = $true)]$RootIdentity,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][array]
    $ProcessSnapshot
  )

  $root = @(
    $ProcessSnapshot | Where-Object {
      $_.processId -eq $RootIdentity.processId -and
      $_.creationToken -eq $RootIdentity.creationToken
    }
  )
  if ($root.Count -eq 0) {
    return @()
  }

  $ownedProcessIds = @([int]$RootIdentity.processId)
  do {
    $previousCount = $ownedProcessIds.Count
    foreach ($candidate in $ProcessSnapshot) {
      if (
        $ownedProcessIds -contains [int]$candidate.parentProcessId -and
        $ownedProcessIds -notcontains [int]$candidate.processId
      ) {
        $ownedProcessIds += [int]$candidate.processId
      }
    }
  } while ($ownedProcessIds.Count -ne $previousCount)

  return @(
    $ProcessSnapshot | Where-Object {
      $ownedProcessIds -contains [int]$_.processId
    } | ForEach-Object {
      New-EkyProcessIdentity -ProcessId $_.processId `
        -CreationToken $_.creationToken
    }
  )
}

function Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][array]
    $OwnedProcessIdentities,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][array]
    $ProcessSnapshot
  )

  return @(
    $OwnedProcessIdentities | Where-Object {
      $ownedIdentity = $_
      @(
        $ProcessSnapshot | Where-Object {
          $_.processId -eq $ownedIdentity.processId -and
          $_.creationToken -eq $ownedIdentity.creationToken
        }
      ).Count -ne 0
    }
  )
}

function Get-EkyProcessTreeStopOutcome {
  param(
    [Parameter(Mandatory = $true)][int]$TaskkillExitCode,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][array]
    $RemainingOwnedProcessIdentities,
    [Parameter(Mandatory = $true)][bool]$DeadlineReached
  )

  if ($RemainingOwnedProcessIdentities.Count -eq 0) {
    return 'stopped'
  }
  if ($DeadlineReached) {
    throw 'INSTALLER_UPGRADE_PROCESS_TREE_REMAINS'
  }
  return 'waiting'
}

function Stop-EkyProcessTree {
  param(
    [AllowNull()]$Process,
    [int]$TimeoutMilliseconds = 10000,
    [int]$PollMilliseconds = 100,
    [AllowNull()][hashtable]$Observation = $null
  )

  if ($null -ne $Observation) {
    $Observation.trackedCount = 0
    $Observation.remainingCount = 0
    $Observation.deadlineReached = $false
    $Observation.taskkillExitClass = 'notStarted'
  }

  if ($null -eq $Process) {
    return
  }
  if ($TimeoutMilliseconds -lt 1 -or $PollMilliseconds -lt 1) {
    throw 'INSTALLER_UPGRADE_PROCESS_TREE_WAIT_INVALID'
  }

  try {
    $rootIdentity = New-EkyProcessIdentity -ProcessId ([int]$Process.Id) `
      -CreationToken (ConvertTo-EkyProcessCreationToken `
        -CreationTime ([DateTime]$Process.StartTime))
  }
  catch {
    return
  }

  $ownedIdentities = @(
    Get-EkyOwnedProcessIdentitiesFromSnapshot `
      -RootIdentity $rootIdentity -ProcessSnapshot (Get-EkyProcessSnapshot)
  )
  if ($null -ne $Observation) {
    $Observation.trackedCount = $ownedIdentities.Count
  }
  if ($ownedIdentities.Count -eq 0) {
    return
  }

  $rootStillOwned = @(
    Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot `
      -OwnedProcessIdentities @($rootIdentity) `
      -ProcessSnapshot (Get-EkyProcessSnapshot)
  ).Count -eq 1
  if (!$rootStillOwned) {
    return
  }

  $taskkillProcess = Start-Process `
    -FilePath (Join-Path $env:SystemRoot 'System32\taskkill.exe') `
    -ArgumentList @(
      '/PID',
      $rootIdentity.processId.ToString(
        [System.Globalization.CultureInfo]::InvariantCulture
      ),
      '/T',
      '/F'
    ) `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
  try {
    $taskkillExitCode = [int]$taskkillProcess.ExitCode
    if ($null -ne $Observation) {
      $Observation.taskkillExitClass = if ($taskkillExitCode -eq 0) {
        'zero'
      }
      else {
        'nonzero'
      }
    }
  }
  finally {
    $taskkillProcess.Dispose()
  }
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    do {
      $remaining = @(
        Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot `
          -OwnedProcessIdentities $ownedIdentities `
          -ProcessSnapshot (Get-EkyProcessSnapshot)
      )
      $deadlineReached = (
        $remaining.Count -ne 0 -and
        $stopwatch.ElapsedMilliseconds -ge $TimeoutMilliseconds
      )
      if ($null -ne $Observation) {
        $Observation.remainingCount = $remaining.Count
        $Observation.deadlineReached = $deadlineReached
      }
      $outcome = Get-EkyProcessTreeStopOutcome `
        -TaskkillExitCode $taskkillExitCode `
        -RemainingOwnedProcessIdentities $remaining `
        -DeadlineReached $deadlineReached
      if ($outcome -eq 'stopped') {
        return
      }
      Start-Sleep -Milliseconds $PollMilliseconds
    } while ($true)
  }
  finally {
    $stopwatch.Stop()
  }
}

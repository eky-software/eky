Set-StrictMode -Version Latest

function Get-EkyHistoricalProcessIdentityKey {
  param([Parameter(Mandatory = $true)]$Identity)

  return "$($Identity.processId):$($Identity.creationToken)"
}
function Resolve-EkyHistoricalExecutablePath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Code = 'W6B_LEGACY_SOURCE_PROCESS_EXECUTABLE_INVALID'
  )

  try {
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    $metadata = Get-Item -LiteralPath $resolved.Path -Force -ErrorAction Stop
  }
  catch {
    throw $Code
  }
  if (
    $metadata.PSIsContainer -or
    ($metadata.Attributes -band [IO.FileAttributes]::ReparsePoint)
  ) {
    throw $Code
  }
  return [IO.Path]::GetFullPath($resolved.Path)
}

function ConvertTo-EkyHistoricalProcessSnapshotRecord {
  param([Parameter(Mandatory = $true)]$Process)

  $executablePath = [string]$Process.ExecutablePath
  return [pscustomobject]@{
    processId = [int]$Process.ProcessId
    parentProcessId = [int]$Process.ParentProcessId
    creationToken = ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$Process.CreationDate)
    executablePath = if ([string]::IsNullOrWhiteSpace($executablePath)) {
      $null
    }
    else {
      [IO.Path]::GetFullPath($executablePath)
    }
  }
}

function Get-EkyHistoricalProcessSnapshot {
  return @(
    Get-CimInstance Win32_Process -ErrorAction Stop |
      ForEach-Object {
        ConvertTo-EkyHistoricalProcessSnapshotRecord -Process $_
      }
  )
}

function New-EkyHistoricalOwnedProcessIdentity {
  param(
    [Parameter(Mandatory = $true)]$SnapshotRecord,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutablePath
  )

  if (
    [string]::IsNullOrWhiteSpace([string]$SnapshotRecord.executablePath) -or
    !([string]$SnapshotRecord.executablePath).Equals(
      $ExpectedExecutablePath,
      [StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw 'W6B_LEGACY_SOURCE_PROCESS_EXECUTABLE_INVALID'
  }
  return [pscustomobject]@{
    processId = [int]$SnapshotRecord.processId
    creationToken = [string]$SnapshotRecord.creationToken
    executablePath = $ExpectedExecutablePath
  }
}

function Test-EkyHistoricalSnapshotProcessStillMatches {
  param([Parameter(Mandatory = $true)]$SnapshotRecord)

  try {
    $process = [Diagnostics.Process]::GetProcessById(
      [int]$SnapshotRecord.processId
    )
  }
  catch {
    return $false
  }
  try {
    $creationToken = ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$process.StartTime)
    return $creationToken -ceq [string]$SnapshotRecord.creationToken
  }
  catch {
    return $false
  }
  finally {
    $process.Dispose()
  }
}

function Add-EkyHistoricalOwnedProcessIdentities {
  param(
    [Parameter(Mandatory = $true)][hashtable]$OwnedIdentities,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][array]
    $ProcessSnapshot
  )

  do {
    $countBefore = $OwnedIdentities.Count
    $ownedByProcessId = @{}
    foreach ($identity in @($OwnedIdentities.Values)) {
      $ownedByProcessId[[string]$identity.processId] = $identity
    }
    foreach ($candidate in $ProcessSnapshot) {
      $parent = $ownedByProcessId[[string]$candidate.parentProcessId]
      if ($null -eq $parent) {
        continue
      }
      if (
        [Int64]$candidate.creationToken -lt [Int64]$parent.creationToken
      ) {
        throw 'W6B_LEGACY_SOURCE_PROCESS_IDENTITY_INVALID'
      }
      if (
        [string]::IsNullOrWhiteSpace([string]$candidate.executablePath)
      ) {
        if (Test-EkyHistoricalSnapshotProcessStillMatches $candidate) {
          throw 'W6B_LEGACY_SOURCE_PROCESS_EXECUTABLE_INVALID'
        }
        continue
      }
      $candidateExecutablePath = Resolve-EkyHistoricalExecutablePath `
        -Path ([string]$candidate.executablePath)
      $identity = New-EkyHistoricalOwnedProcessIdentity `
        -SnapshotRecord $candidate `
        -ExpectedExecutablePath $candidateExecutablePath
      $key = Get-EkyHistoricalProcessIdentityKey -Identity $identity
      if (!$OwnedIdentities.ContainsKey($key)) {
        $OwnedIdentities[$key] = $identity
      }
    }
  } while ($OwnedIdentities.Count -ne $countBefore)
}

function New-EkyHistoricalProcessGeneration {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutablePath
  )

  try {
    $rootIdentity = New-EkyProcessIdentity -ProcessId ([int]$Process.Id) `
      -CreationToken (ConvertTo-EkyProcessCreationToken `
        -CreationTime ([DateTime]$Process.StartTime))
  }
  catch {
    throw 'W6B_LEGACY_SOURCE_PROCESS_IDENTITY_INVALID'
  }
  $snapshot = @(Get-EkyHistoricalProcessSnapshot)
  $rootMatches = @(
    $snapshot | Where-Object {
      $_.processId -eq $rootIdentity.processId -and
      $_.creationToken -eq $rootIdentity.creationToken
    }
  )
  if ($rootMatches.Count -ne 1) {
    throw 'W6B_LEGACY_SOURCE_PROCESS_IDENTITY_INVALID'
  }
  $root = New-EkyHistoricalOwnedProcessIdentity `
    -SnapshotRecord $rootMatches[0] `
    -ExpectedExecutablePath $ExpectedExecutablePath
  $ownedIdentities = @{}
  $ownedIdentities[
    (Get-EkyHistoricalProcessIdentityKey -Identity $root)
  ] = $root
  Add-EkyHistoricalOwnedProcessIdentities `
    -OwnedIdentities $ownedIdentities `
    -ProcessSnapshot $snapshot
  return [pscustomobject]@{
    rootIdentity = $root
    ownedIdentities = $ownedIdentities
  }
}

function Get-EkyHistoricalRemainingOwnedProcesses {
  param(
    [Parameter(Mandatory = $true)][hashtable]$OwnedIdentities,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][array]
    $ProcessSnapshot
  )

  return @(
    $ProcessSnapshot | Where-Object {
      $record = $_
      $key = "$($record.processId):$($record.creationToken)"
      $identity = $OwnedIdentities[$key]
      $null -ne $identity -and
      ([string]$record.executablePath).Equals(
        [string]$identity.executablePath,
        [StringComparison]::OrdinalIgnoreCase
      )
    }
  )
}

function Stop-EkyHistoricalOwnedProcessIdentity {
  param([Parameter(Mandatory = $true)]$Identity)

  try {
    $process = [Diagnostics.Process]::GetProcessById(
      [int]$Identity.processId
    )
  }
  catch {
    return
  }
  try {
    $creationToken = ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$process.StartTime)
    $executablePath = Resolve-EkyHistoricalExecutablePath `
      -Path ([string]$process.MainModule.FileName)
    if (
      $creationToken -cne [string]$Identity.creationToken -or
      !$executablePath.Equals(
        [string]$Identity.executablePath,
        [StringComparison]::OrdinalIgnoreCase
      )
    ) {
      throw 'W6B_LEGACY_SOURCE_PROCESS_IDENTITY_INVALID'
    }
    $process.Kill()
  }
  finally {
    $process.Dispose()
  }
}

function Stop-EkyHistoricalOwnedProcesses {
  param(
    [Parameter(Mandatory = $true)][hashtable]$OwnedIdentities,
    [int]$TimeoutMilliseconds = 10000,
    [int]$PollMilliseconds = 100
  )

  if ($TimeoutMilliseconds -lt 1 -or $PollMilliseconds -lt 1) {
    throw 'W6B_LEGACY_SOURCE_PROCESS_WAIT_INVALID'
  }
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    $snapshot = @(Get-EkyHistoricalProcessSnapshot)
    $remaining = @(
      Get-EkyHistoricalRemainingOwnedProcesses `
        -OwnedIdentities $OwnedIdentities `
        -ProcessSnapshot $snapshot
    )
    if ($remaining.Count -eq 0) {
      return
    }
    foreach ($record in @($remaining | Sort-Object processId -Descending)) {
      try {
        $key = "$($record.processId):$($record.creationToken)"
        Stop-EkyHistoricalOwnedProcessIdentity `
          -Identity $OwnedIdentities[$key]
      }
      catch {
        $latest = @(Get-EkyHistoricalProcessSnapshot)
        $stillOwned = @(
          Get-EkyHistoricalRemainingOwnedProcesses `
            -OwnedIdentities $OwnedIdentities `
            -ProcessSnapshot $latest
        ) | Where-Object {
          $_.processId -eq $record.processId -and
          $_.creationToken -eq $record.creationToken
        }
        if ($stillOwned.Count -ne 0) {
          throw 'W6B_LEGACY_SOURCE_PROCESS_CLEANUP_FAILED'
        }
      }
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw 'W6B_LEGACY_SOURCE_PROCESS_CLEANUP_TIMEOUT'
    }
    Start-Sleep -Milliseconds $PollMilliseconds
  } while ($true)
}

function Start-EkyHistoricalPackagedSmokePhase {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$StartPhase,
    [Parameter(Mandatory = $true)][ValidateSet('initial', 'restored')]
    [string]$Phase
  )

  $started = @(& $StartPhase $Phase)
  if (
    $started.Count -ne 1 -or
    $started[0] -isnot [System.Diagnostics.Process]
  ) {
    foreach ($candidate in $started) {
      if ($candidate -is [System.Diagnostics.Process]) {
        try {
          Stop-EkyProcessTree -Process $candidate
        }
        finally {
          $candidate.Dispose()
        }
      }
    }
    throw 'W6B_LEGACY_SOURCE_PROCESS_START_FAILED'
  }
  return $started[0]
}

function Write-EkyHistoricalObserverProgress {
  param([Parameter(Mandatory = $true)]$OutputItem)

  if ($OutputItem -isnot [string]) {
    throw 'W6B_LEGACY_OBSERVER_OUTPUT_INVALID'
  }
  try {
    $progress = $OutputItem | ConvertFrom-Json -ErrorAction Stop
  }
  catch {
    throw 'W6B_LEGACY_OBSERVER_OUTPUT_INVALID'
  }
  $expectedProperties = @(
    'scenario',
    'stage',
    'status',
    'resultCode',
    'durationMs',
    'elapsedMs'
  )
  $actualProperties = @($progress.PSObject.Properties.Name)
  $allowedStages = @(
    'sourceStartup',
    'legacyFixtureVerification',
    'targetFirstStartup',
    'targetSecondStartup'
  )
  $allowedResultCodes = @(
    'databaseReady',
    'backendUtilityReady',
    'acceptedBuildReady',
    'backendHealthReady',
    'sourceUserDataReady',
    'legacyBusinessFixtureReady',
    'runtimeSessionValidated'
  )
  if (
    $actualProperties.Count -ne $expectedProperties.Count -or
    @($actualProperties | Where-Object {
      $_ -notin $expectedProperties
    }).Count -ne 0 -or
    @($expectedProperties | Where-Object {
      $_ -notin $actualProperties
    }).Count -ne 0 -or
    $progress.scenario -cne 'legacyUpgrade' -or
    $progress.stage -notin $allowedStages -or
    $progress.status -cne 'observed' -or
    $progress.resultCode -notin $allowedResultCodes -or
    (
      $progress.durationMs -isnot [int] -and
      $progress.durationMs -isnot [long]
    ) -or
    $progress.durationMs -lt 0 -or
    (
      $progress.elapsedMs -isnot [int] -and
      $progress.elapsedMs -isnot [long]
    ) -or
    $progress.elapsedMs -lt 0
  ) {
    throw 'W6B_LEGACY_OBSERVER_OUTPUT_INVALID'
  }
  Write-Information -MessageData $OutputItem -InformationAction Continue
}

function Invoke-EkyHistoricalObserver {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Observer,
    [Parameter(Mandatory = $true)]$Argument
  )

  $observerOutput = @(& $Observer $Argument)
  foreach ($outputItem in $observerOutput) {
    Write-EkyHistoricalObserverProgress -OutputItem $outputItem
  }
}

function Wait-EkyHistoricalPackagedSmokeGeneration {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutablePath,
    [Parameter(Mandatory = $true)][string]$ExpectedStage,
    [Parameter(Mandatory = $true)][string]$ExpectedStatus,
    [Parameter(Mandatory = $true)][scriptblock]$ReadResult,
    [scriptblock]$ReadFinalResult = $null,
    [Parameter(Mandatory = $true)][scriptblock]$ObserveResult,
    [Parameter(Mandatory = $true)][scriptblock]$ObserveProcess,
    [Parameter(Mandatory = $true)][scriptblock]$ValidateResult,
    [int]$TimeoutMilliseconds = 60000,
    [int]$PollMilliseconds = 250
  )

  if ($TimeoutMilliseconds -lt 1 -or $PollMilliseconds -lt 1) {
    throw 'W6B_LEGACY_SOURCE_PROCESS_WAIT_INVALID'
  }
  $generation = $null
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  try {
    $generation = New-EkyHistoricalProcessGeneration `
      -Process $Process `
      -ExpectedExecutablePath $ExpectedExecutablePath
    do {
      $Process.Refresh()
      $snapshot = @(Get-EkyHistoricalProcessSnapshot)
      Add-EkyHistoricalOwnedProcessIdentities `
        -OwnedIdentities $generation.ownedIdentities `
        -ProcessSnapshot $snapshot
      Invoke-EkyHistoricalObserver -Observer $ObserveProcess `
        -Argument $Process
      $observation = & $ReadResult
      if ($null -ne $observation) {
        Invoke-EkyHistoricalObserver -Observer $ObserveResult `
          -Argument $observation
      }
      $remaining = @(
        Get-EkyHistoricalRemainingOwnedProcesses `
          -OwnedIdentities $generation.ownedIdentities `
          -ProcessSnapshot $snapshot
      )
      if ($Process.HasExited -and $remaining.Count -eq 0) {
        break
      }
      if ([DateTime]::UtcNow -ge $deadline) {
        if ($Process.HasExited) {
          throw 'W6B_LEGACY_SOURCE_OWNED_PROCESS_REMAINS'
        }
        throw 'W6B_LEGACY_SOURCE_SMOKE_TIMEOUT'
      }
      Start-Sleep -Milliseconds $PollMilliseconds
    } while ($true)

    $finalReader = if ($null -eq $ReadFinalResult) {
      $ReadResult
    }
    else {
      $ReadFinalResult
    }
    $result = & $finalReader
    if ($null -eq $result) {
      throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_MISSING'
    }
    Invoke-EkyHistoricalObserver -Observer $ObserveResult -Argument $result
    & $ValidateResult $Process $result $ExpectedStage $ExpectedStatus
    return [pscustomobject]@{
      ownedProcessCount = $generation.ownedIdentities.Count
      remainingOwnedProcessCount = 0
    }
  }
  finally {
    if ($null -ne $generation) {
      Stop-EkyHistoricalOwnedProcesses `
        -OwnedIdentities $generation.ownedIdentities
    }
    else {
      $Process.Refresh()
      if (!$Process.HasExited) {
        Stop-EkyProcessTree -Process $Process
      }
    }
    $Process.Dispose()
  }
}

function Invoke-HistoricalPackagedSmokeProcessChain {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$StartPhase,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutablePath,
    [Parameter(Mandatory = $true)][scriptblock]$ReadResult,
    [scriptblock]$ReadFinalResult = $null,
    [Parameter(Mandatory = $true)][scriptblock]$ObserveResult,
    [Parameter(Mandatory = $true)][scriptblock]$ObserveProcess,
    [Parameter(Mandatory = $true)][scriptblock]$ValidateResult,
    [int]$TimeoutMilliseconds = 60000,
    [int]$PollMilliseconds = 250
  )

  $canonicalExecutablePath = Resolve-EkyHistoricalExecutablePath `
    -Path $ExpectedExecutablePath
  $initialProcess = Start-EkyHistoricalPackagedSmokePhase `
    -StartPhase $StartPhase -Phase 'initial'
  $initial = Wait-EkyHistoricalPackagedSmokeGeneration `
    -Process $initialProcess `
    -ExpectedExecutablePath $canonicalExecutablePath `
    -ExpectedStage 'restoreRestart' `
    -ExpectedStatus 'started' `
    -ReadResult $ReadResult `
    -ReadFinalResult $ReadFinalResult `
    -ObserveResult $ObserveResult `
    -ObserveProcess $ObserveProcess `
    -ValidateResult $ValidateResult `
    -TimeoutMilliseconds $TimeoutMilliseconds `
    -PollMilliseconds $PollMilliseconds

  # Historical 0.2.6 exits at restoreRestart in smoke mode. The harness owns
  # one explicit restored generation; production relaunch behavior is unchanged.
  $restoredProcess = Start-EkyHistoricalPackagedSmokePhase `
    -StartPhase $StartPhase -Phase 'restored'
  $restored = Wait-EkyHistoricalPackagedSmokeGeneration `
    -Process $restoredProcess `
    -ExpectedExecutablePath $canonicalExecutablePath `
    -ExpectedStage 'shutdown' `
    -ExpectedStatus 'ok' `
    -ReadResult $ReadResult `
    -ReadFinalResult $ReadFinalResult `
    -ObserveResult $ObserveResult `
    -ObserveProcess $ObserveProcess `
    -ValidateResult $ValidateResult `
    -TimeoutMilliseconds $TimeoutMilliseconds `
    -PollMilliseconds $PollMilliseconds

  return [pscustomobject]@{
    contract = 'explicitTwoPhase'
    initialGenerationCount = 1
    restoredGenerationCount = 1
    initialOwnedProcessCount = $initial.ownedProcessCount
    restoredOwnedProcessCount = $restored.ownedProcessCount
    remainingOwnedProcessCount = 0
  }
}

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
  try {
    if (!$process.Start()) {
      throw 'W6B2_SUCCESS_PROCESS_START_FAILED'
    }
    $standardOutputTask = $process.StandardOutput.ReadToEndAsync()
    $standardErrorTask = $process.StandardError.ReadToEndAsync()
    $process | Add-Member -MemberType NoteProperty `
      -Name W6b2StandardOutputTask -Value $standardOutputTask
    $process | Add-Member -MemberType NoteProperty `
      -Name W6b2StandardErrorTask -Value $standardErrorTask
    return $process
  }
  catch {
    try {
      $process.Refresh()
      if (!$process.HasExited) {
        $process.Kill()
        [void]$process.WaitForExit(10000)
      }
    }
    catch {}
    $process.Dispose()
    throw 'W6B2_SUCCESS_PROCESS_START_FAILED'
  }
}

function Close-W6b2SuccessProcess {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [int]$TimeoutMilliseconds = 10000,
    [ValidateSet('none', 'migration', 'validation')]
    [string]$ObservationMode = 'none',
    [scriptblock]$Observe = { param([string]$ResultCode) }
  )

  if ($TimeoutMilliseconds -lt 1) {
    throw 'W6B2_SUCCESS_PROCESS_WAIT_INVALID'
  }
  try {
    $Process.Refresh()
    if (!$Process.HasExited) {
      throw 'W6B2_SUCCESS_PROCESS_REMAINS'
    }
    Invoke-W6b2SuccessProcessMilestone -ObservationMode $ObservationMode `
      -Milestone outputDrainStarted -Observe $Observe
    $tasks = [Collections.Generic.List[Threading.Tasks.Task]]::new()
    foreach ($taskName in @(
      'W6b2StandardOutputTask',
      'W6b2StandardErrorTask'
    )) {
      $property = $Process.PSObject.Properties[$taskName]
      if ($null -eq $property -or $null -eq $property.Value) {
        throw 'W6B2_SUCCESS_PROCESS_OUTPUT_FAILED'
      }
      $tasks.Add([Threading.Tasks.Task]$property.Value)
    }
    if (
      ![Threading.Tasks.Task]::WaitAll(
        $tasks.ToArray(),
        $TimeoutMilliseconds
      )
    ) {
      throw 'W6B2_SUCCESS_PROCESS_OUTPUT_TIMEOUT'
    }
    foreach ($task in $tasks) {
      [void]$task.GetAwaiter().GetResult()
    }
    Invoke-W6b2SuccessProcessMilestone -ObservationMode $ObservationMode `
      -Milestone outputDrainCompleted -Observe $Observe
  }
  catch {
    if (
      $_.Exception.Message -cin @(
        'W6B2_SUCCESS_PROCESS_OUTPUT_FAILED',
        'W6B2_SUCCESS_PROCESS_OUTPUT_TIMEOUT',
        'W6B2_SUCCESS_PROCESS_REMAINS'
      )
    ) {
      throw
    }
    throw 'W6B2_SUCCESS_PROCESS_OUTPUT_FAILED'
  }
  finally {
    $Process.Dispose()
  }
}

function Invoke-W6b2SuccessProcessMilestone {
  param(
    [ValidateSet('none', 'migration', 'validation')]
    [string]$ObservationMode = 'none',
    [Parameter(Mandatory = $true)]
    [ValidateSet(
      'launchStarted',
      'processStarted',
      'resultObserved',
      'rootExited',
      'ownedTreeAbsent',
      'outputDrainStarted',
      'outputDrainCompleted'
    )]
    [string]$Milestone,
    [scriptblock]$Observe = { param([string]$ResultCode) }
  )

  if ($ObservationMode -ceq 'none') {
    return
  }
  $resultCode = switch -CaseSensitive ("$ObservationMode`:$Milestone") {
    'migration:launchStarted' { 'migrationLaunchStarted' }
    'migration:processStarted' { 'migrationProcessStarted' }
    'migration:resultObserved' { 'migrationResultObserved' }
    'migration:rootExited' { 'migrationRootExited' }
    'migration:ownedTreeAbsent' { 'migrationOwnedTreeAbsent' }
    'migration:outputDrainStarted' { 'migrationOutputDrainStarted' }
    'migration:outputDrainCompleted' { 'migrationOutputDrainCompleted' }
    'validation:launchStarted' { 'validationLaunchStarted' }
    'validation:processStarted' { 'validationProcessStarted' }
    'validation:resultObserved' { 'validationResultObserved' }
    'validation:rootExited' { 'validationRootExited' }
    'validation:ownedTreeAbsent' { 'validationOwnedTreeAbsent' }
    'validation:outputDrainStarted' { 'validationOutputDrainStarted' }
    'validation:outputDrainCompleted' { 'validationOutputDrainCompleted' }
    default { throw 'W6B2_SUCCESS_PROGRESS_INVALID' }
  }
  try {
    [void](& $Observe $resultCode)
  }
  catch {
    # Progress output must never change the process result.
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
    excludedInstallerRoots = @{}
  }
}

function Update-W6b2SuccessProcessObservation {
  param(
    [Parameter(Mandatory = $true)]$Observation,
    [AllowEmptyCollection()][array]$ProcessSnapshot = @()
  )

  $snapshot = if ($ProcessSnapshot.Count -eq 0) {
    @(Get-EkyProcessSnapshot)
  }
  else {
    @($ProcessSnapshot)
  }
  $excluded = @{}
  foreach ($root in @($Observation.excludedInstallerRoots.Values)) {
    foreach ($identity in @(Get-EkyOwnedProcessIdentitiesFromSnapshot `
      -RootIdentity $root -ProcessSnapshot $snapshot)) {
      $excluded["$($identity.processId):$($identity.creationToken)"] = $true
    }
  }
  foreach ($identity in @(Get-EkyOwnedProcessIdentitiesFromSnapshot `
    -RootIdentity $Observation.root -ProcessSnapshot $snapshot)) {
    $key = "$($identity.processId):$($identity.creationToken)"
    if (!$excluded.ContainsKey($key)) {
      $Observation.owned[$key] = $identity
    }
  }
  return ,$snapshot
}

function Release-W6b2SuccessInstallerHandoffOwnership {
  param(
    [Parameter(Mandatory = $true)]$Observation,
    [AllowEmptyCollection()][array]$ProcessSnapshot = @()
  )

  $snapshot = if ($ProcessSnapshot.Count -eq 0) {
    @(Get-EkyProcessSnapshot)
  }
  else {
    @($ProcessSnapshot)
  }
  [void](Update-W6b2SuccessProcessObservation `
    -Observation $Observation -ProcessSnapshot $snapshot)
  $ownedKeys = @($Observation.owned.Keys)
  $installerRoots = @(
    $snapshot | Where-Object {
      $key = "$($_.processId):$($_.creationToken)"
      $ownedKeys -contains $key -and
      [string]$_.processName -ieq 'msiexec.exe'
    } | ForEach-Object {
      New-EkyProcessIdentity -ProcessId ([int]$_.processId) `
        -CreationToken ([string]$_.creationToken)
    }
  )
  foreach ($root in $installerRoots) {
    $rootKey = "$($root.processId):$($root.creationToken)"
    $Observation.excludedInstallerRoots[$rootKey] = $root
    foreach ($identity in @(Get-EkyOwnedProcessIdentitiesFromSnapshot `
      -RootIdentity $root -ProcessSnapshot $snapshot)) {
      $key = "$($identity.processId):$($identity.creationToken)"
      [void]$Observation.owned.Remove($key)
    }
  }
}

function Update-W6b2SuccessProcessObservationWhenDue {
  param(
    [Parameter(Mandatory = $true)]$Observation,
    [Parameter(Mandatory = $true)][ref]$NextSnapshotAt,
    [int]$IntervalMilliseconds = 1000
  )

  if ($IntervalMilliseconds -lt 1) {
    throw 'W6B2_SUCCESS_PROCESS_WAIT_INVALID'
  }
  $now = [DateTime]::UtcNow
  if ($now -lt $NextSnapshotAt.Value) {
    return
  }
  [void](Update-W6b2SuccessProcessObservation -Observation $Observation)
  $NextSnapshotAt.Value = $now.AddMilliseconds($IntervalMilliseconds)
}

function Wait-W6b2SuccessResultProcess {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)]$Observation,
    [Parameter(Mandatory = $true)][scriptblock]$ReadResult,
    [int]$TimeoutMilliseconds = 180000,
    [ValidateSet('none', 'migration', 'validation')]
    [string]$ObservationMode = 'none',
    [scriptblock]$Observe = { param([string]$ResultCode) }
  )

  if ($TimeoutMilliseconds -lt 1) {
    throw 'W6B2_SUCCESS_PROCESS_WAIT_INVALID'
  }
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  $nextSnapshotAt = [DateTime]::MinValue
  $result = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    Update-W6b2SuccessProcessObservationWhenDue -Observation $Observation `
      -NextSnapshotAt ([ref]$nextSnapshotAt)
    if ($null -eq $result) {
      try {
        $result = & $ReadResult
        Invoke-W6b2SuccessProcessMilestone -ObservationMode $ObservationMode `
          -Milestone resultObserved -Observe $Observe
      }
      catch {
        if ($_.Exception.Message -ne 'W6B2_SUCCESS_RESULT_PENDING') {
          throw
        }
      }
    }
    $Process.Refresh()
    if ($Process.HasExited) {
      Invoke-W6b2SuccessProcessMilestone -ObservationMode $ObservationMode `
        -Milestone rootExited -Observe $Observe
      [void](Update-W6b2SuccessProcessObservation -Observation $Observation)
      if ($null -eq $result) {
        try {
          $result = & $ReadResult
          Invoke-W6b2SuccessProcessMilestone -ObservationMode $ObservationMode `
            -Milestone resultObserved -Observe $Observe
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
      Wait-W6b2SuccessOwnedProcessesAbsent -Observation $Observation `
        -TimeoutMilliseconds 30000
      Invoke-W6b2SuccessProcessMilestone -ObservationMode $ObservationMode `
        -Milestone ownedTreeAbsent -Observe $Observe
      return $result
    }
    Write-W6b2SuccessHeartbeat
    Start-Sleep -Milliseconds 100
  }
  Stop-W6b2SuccessOwnedProcesses -Observation $Observation
  throw 'W6B2_SUCCESS_PROCESS_TIMEOUT'
}

function Wait-W6b2SuccessHandoffResult {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)]$Observation,
    [Parameter(Mandatory = $true)][scriptblock]$ReadResult,
    [int]$TimeoutMilliseconds = 180000
  )

  if ($TimeoutMilliseconds -lt 1) {
    throw 'W6B2_SUCCESS_PROCESS_WAIT_INVALID'
  }
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  $nextSnapshotAt = [DateTime]::MinValue
  while ([DateTime]::UtcNow -lt $deadline) {
    Update-W6b2SuccessProcessObservationWhenDue -Observation $Observation `
      -NextSnapshotAt ([ref]$nextSnapshotAt)
    try {
      $result = & $ReadResult
      [void](Update-W6b2SuccessProcessObservation -Observation $Observation)
      $Process.Refresh()
      if ($Process.HasExited -and [int]$Process.ExitCode -ne 0) {
        throw 'W6B2_SUCCESS_PROCESS_EXIT_FAILED'
      }
      return $result
    }
    catch {
      if ($_.Exception.Message -ne 'W6B2_SUCCESS_RESULT_PENDING') {
        throw
      }
    }
    $Process.Refresh()
    if ($Process.HasExited) {
      [void](Update-W6b2SuccessProcessObservation -Observation $Observation)
      try {
        $result = & $ReadResult
      }
      catch {
        if ($_.Exception.Message -eq 'W6B2_SUCCESS_RESULT_PENDING') {
          throw 'W6B2_SUCCESS_PROCESS_EXITED_BEFORE_RESULT'
        }
        throw
      }
      if ([int]$Process.ExitCode -ne 0) {
        throw 'W6B2_SUCCESS_PROCESS_EXIT_FAILED'
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
  $nextSnapshotAt = [DateTime]::MinValue
  do {
    Update-W6b2SuccessProcessObservationWhenDue -Observation $Observation `
      -NextSnapshotAt ([ref]$nextSnapshotAt)
    $remaining = @(Get-EkyRemainingExactProcessIdentities `
      -OwnedProcessIdentities @($Observation.owned.Values))
    if ($remaining.Count -eq 0) {
      return
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      $failureCode = Get-W6b2SuccessOwnedProcessFailureCode `
        -Observation $Observation -Remaining $remaining
      Stop-W6b2SuccessOwnedProcesses -Observation $Observation
      throw $failureCode
    }
    Write-W6b2SuccessHeartbeat
    Start-Sleep -Milliseconds 100
  } while ($true)
}

function Get-W6b2SuccessOwnedProcessFailureCode {
  param(
    [Parameter(Mandatory = $true)]$Observation,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][array]$Remaining,
    [scriptblock]$ReadProcess = {
      param([int]$ProcessId)
      return Get-CimInstance Win32_Process `
        -Filter "ProcessId = $ProcessId" -OperationTimeoutSec 5 `
        -ErrorAction Stop
    }
  )

  $roles = @(
    foreach ($identity in $Remaining) {
      if (
        $identity.processId -eq $Observation.root.processId -and
        $identity.creationToken -eq $Observation.root.creationToken
      ) {
        'applicationMain'
        continue
      }
      try {
        $record = & $ReadProcess ([int]$identity.processId)
        Get-W6b2SuccessOwnedProcessRole -Process $record
      }
      catch {
        'unclassified'
      }
    }
  )
  $distinctRoles = @($roles | Sort-Object -Unique)
  if ($distinctRoles.Count -ne 1) {
    return 'W6B2_SUCCESS_OWNED_PROCESS_MIXED_REMAINS'
  }
  $failureCode = switch ($distinctRoles[0]) {
    'applicationMain' { 'W6B2_SUCCESS_OWNED_APPLICATION_MAIN_REMAINS' }
    'backendUtility' { 'W6B2_SUCCESS_OWNED_BACKEND_UTILITY_REMAINS' }
    'crashpad' { 'W6B2_SUCCESS_OWNED_CRASHPAD_REMAINS' }
    'gpu' { 'W6B2_SUCCESS_OWNED_GPU_REMAINS' }
    'renderer' { 'W6B2_SUCCESS_OWNED_RENDERER_REMAINS' }
    'utility' { 'W6B2_SUCCESS_OWNED_UTILITY_REMAINS' }
    default { 'W6B2_SUCCESS_OWNED_PROCESS_UNCLASSIFIED_REMAINS' }
  }
  return $failureCode
}

function Get-W6b2SuccessOwnedProcessRole {
  param([Parameter(Mandatory = $true)]$Process)

  $commandLine = [string]$Process.CommandLine
  if ($commandLine -match '--type=crashpad-handler(?:\s|$)') {
    return 'crashpad'
  }
  if ($commandLine -match '--type=gpu-process(?:\s|$)') {
    return 'gpu'
  }
  if ($commandLine -match '--type=renderer(?:\s|$)') {
    return 'renderer'
  }
  if ($commandLine -match '--type=utility(?:\s|$)') {
    if ($commandLine -match 'node\.mojom\.NodeService') {
      return 'backendUtility'
    }
    return 'utility'
  }
  return 'unclassified'
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
        if (!$process.WaitForExit(10000)) {
          throw 'W6B2_SUCCESS_PROCESS_REMAINS'
        }
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

function Stop-W6b2SuccessRecordedOwnedProcesses {
  param([Parameter(Mandatory = $true)]$Observation)

  foreach ($identity in @($Observation.owned.Values)) {
    $process = $null
    try {
      try {
        $process = [Diagnostics.Process]::GetProcessById(
          [int]$identity.processId
        )
      }
      catch [ArgumentException] {
        continue
      }

      try {
        $process.Refresh()
        if ($process.HasExited) {
          continue
        }
        $token = ConvertTo-EkyProcessCreationToken `
          -CreationTime ([DateTime]$process.StartTime)
        if ($token -cne [string]$identity.creationToken) {
          continue
        }
        $process.Kill()
        if (!$process.WaitForExit(10000)) {
          throw 'W6B2_SUCCESS_PROCESS_REMAINS'
        }
      }
      catch [InvalidOperationException] {
        continue
      }
      catch {
        if ($_.Exception.Message -ceq 'W6B2_SUCCESS_PROCESS_REMAINS') {
          throw
        }
        try {
          $process.Refresh()
          if ($process.HasExited) {
            continue
          }
        }
        catch [InvalidOperationException] {
          continue
        }
        catch {}
        throw 'W6B2_SUCCESS_PROCESS_CLEANUP_FAILED'
      }
    }
    catch {
      if (
        $_.Exception.Message -cin @(
          'W6B2_SUCCESS_PROCESS_CLEANUP_FAILED',
          'W6B2_SUCCESS_PROCESS_REMAINS'
        )
      ) {
        throw
      }
      throw 'W6B2_SUCCESS_PROCESS_CLEANUP_FAILED'
    }
    finally {
      if ($null -ne $process) {
        $process.Dispose()
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
    [ValidateSet('none', 'migration', 'validation')]
    [string]$ObservationMode = 'none',
    [scriptblock]$Observe = { param([string]$ResultCode) }
  )

  Clear-W6b2SuccessResultFiles -ProofRoot $ProofRoot
  Invoke-W6b2SuccessProcessMilestone -ObservationMode $ObservationMode `
    -Milestone launchStarted -Observe $Observe
  $process = Start-W6b2SuccessProcess -ExecutablePath $ExecutablePath `
    -Arguments @('--w6b2-packaged-proof') -EnvironmentOverrides @{
      EKY_W6B2_PROOF_TOKEN = $ProofToken
    }
  Invoke-W6b2SuccessProcessMilestone -ObservationMode $ObservationMode `
    -Milestone processStarted -Observe $Observe
  $observation = New-W6b2SuccessProcessObservation -Process $process
  $phaseCompleted = $false
  try {
    $resultPath = Join-Path $ProofRoot 'result\w6b2-proof-result.json'
    $result = Wait-W6b2SuccessResultProcess -Process $process `
      -Observation $observation -ReadResult {
        if (!(Test-Path -LiteralPath $resultPath -PathType Leaf)) {
          throw 'W6B2_SUCCESS_RESULT_PENDING'
        }
        Read-W6b2SuccessProofResult -ProofRoot $ProofRoot `
          -ExpectedPhase $Phase -ExpectedStatus $ExpectedStatus
      } -ObservationMode $ObservationMode -Observe $Observe
    $phaseCompleted = $true
    return [pscustomobject]@{
      result = $result
      observation = $observation
    }
  }
  finally {
    if (!$phaseCompleted) {
      Stop-W6b2SuccessOwnedProcesses -Observation $observation
      Wait-W6b2SuccessOwnedProcessesAbsent -Observation $observation `
        -TimeoutMilliseconds 30000
    }
    Close-W6b2SuccessProcess -Process $process `
      -ObservationMode $ObservationMode -Observe $Observe
  }
}

function Invoke-W6b2SuccessWorkspaceActivationMigrationPhase {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$ProofToken,
    [Parameter(Mandatory = $true)][string]$ProofRoot,
    [Parameter(Mandatory = $true)][string]$Phase,
    [scriptblock]$Observe = { param([string]$ResultCode) }
  )

  try {
    $migrationRun = Invoke-W6b2SuccessApplicationPhase `
      -ExecutablePath $ExecutablePath -ProofToken $ProofToken `
      -ProofRoot $ProofRoot -Phase $Phase -ExpectedStatus relaunching `
      -ObservationMode migration -Observe $Observe
  }
  catch {
    if ($_.Exception.Message -cmatch '^W6B2_SUCCESS_[A-Z0-9_]+$') {
      throw
    }
    throw 'W6B2_SUCCESS_MIGRATION_PHASE_FAILED'
  }
  try {
    $validationRun = Invoke-W6b2SuccessApplicationPhase `
      -ExecutablePath $ExecutablePath -ProofToken $ProofToken `
      -ProofRoot $ProofRoot -Phase $Phase -ExpectedStatus completed `
      -ObservationMode validation -Observe $Observe
  }
  catch {
    if ($_.Exception.Message -cmatch '^W6B2_SUCCESS_[A-Z0-9_]+$') {
      throw
    }
    throw 'W6B2_SUCCESS_VALIDATION_PHASE_FAILED'
  }

  return [pscustomobject]@{
    migrationObservation = $migrationRun.observation
    validationObservation = $validationRun.observation
  }
}

function Invoke-W6b2SuccessApplicationHandoffPhase {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$ProofToken,
    [Parameter(Mandatory = $true)][string]$ProofRoot
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
        Read-W6b2SuccessProofResult -ProofRoot $ProofRoot `
          -ExpectedPhase sourceHandoff -ExpectedStatus completed
      }
    Release-W6b2SuccessInstallerHandoffOwnership `
      -Observation $observation
    return [pscustomobject]@{
      result = $result
      observation = $observation
      process = $process
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
  $operationCompleted = $false
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
    $operationCompleted = $true
  }
  finally {
    if (!$operationCompleted) {
      Stop-W6b2SuccessOwnedProcesses -Observation $observation
      Wait-W6b2SuccessOwnedProcessesAbsent -Observation $observation `
        -TimeoutMilliseconds 30000
    }
    Close-W6b2SuccessProcess -Process $process
  }
}

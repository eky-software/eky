Set-StrictMode -Version Latest

function ConvertTo-EkyInstallerProcessIdentity {
  param([Parameter(Mandatory = $true)]$ProcessRecord)

  $processId = [int]$ProcessRecord.ProcessId
  if ($processId -lt 1 -or $null -eq $ProcessRecord.CreationDate) {
    throw 'INSTALLER_UPGRADE_PROCESS_IDENTITY_INVALID'
  }
  $creationDate = [DateTime]$ProcessRecord.CreationDate
  return [pscustomobject]@{
    CreationTimeUtcTicks = $creationDate.ToUniversalTime().Ticks
    ProcessId = $processId
  }
}

function Test-EkyInstallerProcessIdentityEqual {
  param(
    [Parameter(Mandatory = $true)]$Left,
    [Parameter(Mandatory = $true)]$Right
  )

  return (
    [int]$Left.ProcessId -eq [int]$Right.ProcessId -and
    [long]$Left.CreationTimeUtcTicks -eq [long]$Right.CreationTimeUtcTicks
  )
}

function Get-EkyInstallerProcessIdentityById {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  if ($ProcessId -lt 1) {
    throw 'INSTALLER_UPGRADE_PROCESS_IDENTITY_INVALID'
  }
  $record = Get-CimInstance -ClassName Win32_Process `
    -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if ($null -eq $record) {
    return $null
  }
  return ConvertTo-EkyInstallerProcessIdentity -ProcessRecord $record
}

function Test-EkyInstallerProcessIdentityAlive {
  param([Parameter(Mandatory = $true)]$Identity)

  $current = Get-EkyInstallerProcessIdentityById -ProcessId $Identity.ProcessId
  return (
    $null -ne $current -and
    (Test-EkyInstallerProcessIdentityEqual -Left $Identity -Right $current)
  )
}

function Select-EkyInstallerOwnedProcessTree {
  param(
    [Parameter(Mandatory = $true)]$RootIdentity,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$SeedIdentities,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$ProcessRecords
  )

  $recordsById = @{}
  foreach ($record in $ProcessRecords) {
    try {
      $identity = ConvertTo-EkyInstallerProcessIdentity -ProcessRecord $record
      $recordsById[[int]$identity.ProcessId] = [pscustomobject]@{
        Identity = $identity
        ParentProcessId = [int]$record.ParentProcessId
      }
    }
    catch {
      continue
    }
  }

  $selected = @{}
  foreach ($identity in @($RootIdentity) + @($SeedIdentities)) {
    $key = "$([int]$identity.ProcessId):$([long]$identity.CreationTimeUtcTicks)"
    $selected[$key] = $identity
  }

  $currentRoot = $recordsById[[int]$RootIdentity.ProcessId]
  if (
    $null -eq $currentRoot -or
    !(Test-EkyInstallerProcessIdentityEqual `
      -Left $RootIdentity -Right $currentRoot.Identity)
  ) {
    return @($selected.Values)
  }

  $parentIdentities = @{}
  foreach ($identity in $selected.Values) {
    $current = $recordsById[[int]$identity.ProcessId]
    if (
      $null -ne $current -and
      (Test-EkyInstallerProcessIdentityEqual `
        -Left $identity -Right $current.Identity)
    ) {
      $parentIdentities[[int]$identity.ProcessId] = $identity
    }
  }
  do {
    $changed = $false
    foreach ($entry in $recordsById.Values) {
      $parentIdentity = $parentIdentities[[int]$entry.ParentProcessId]
      if (
        $null -eq $parentIdentity -or
        [long]$entry.Identity.CreationTimeUtcTicks -lt
          [long]$parentIdentity.CreationTimeUtcTicks
      ) {
        continue
      }
      $key = "$([int]$entry.Identity.ProcessId):$([long]$entry.Identity.CreationTimeUtcTicks)"
      if (!$selected.ContainsKey($key)) {
        $selected[$key] = $entry.Identity
        $parentIdentities[[int]$entry.Identity.ProcessId] = $entry.Identity
        $changed = $true
      }
    }
  } while ($changed)

  return @($selected.Values)
}

function Get-EkyInstallerOwnedProcessTree {
  param(
    [Parameter(Mandatory = $true)]$RootIdentity,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$SeedIdentities
  )

  $records = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
  return @(Select-EkyInstallerOwnedProcessTree -RootIdentity $RootIdentity `
    -SeedIdentities $SeedIdentities -ProcessRecords $records)
}

function Resolve-EkyInstallerProcessTreeCleanupDecision {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('notRequired', 'zero', 'nonzero', 'timeout', 'startFailed')]
    [string]$TaskkillOutcomeClass,
    [Parameter(Mandatory = $true)][ValidateRange(0, 1000)]
    [int]$RemainingProcessCount
  )

  if ($RemainingProcessCount -eq 0) {
    return 'success'
  }
  return 'processTreeRemains'
}

function Invoke-EkyInstallerTaskkill {
  param(
    [Parameter(Mandatory = $true)][int]$RootProcessId,
    [int]$TimeoutMilliseconds = 15000
  )

  if ($RootProcessId -lt 1 -or $TimeoutMilliseconds -lt 1) {
    throw 'INSTALLER_UPGRADE_PROCESS_TERMINATION_ARGUMENTS_INVALID'
  }
  $process = $null
  try {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = 'taskkill.exe'
    $startInfo.Arguments = "/PID $RootProcessId /T /F"
    $startInfo.CreateNoWindow = $true
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (!$process.Start()) {
      return 'startFailed'
    }
    if (!$process.WaitForExit($TimeoutMilliseconds)) {
      try {
        $process.Kill()
      }
      catch {
        # The process-tree postcondition remains authoritative.
      }
      return 'timeout'
    }
    [void]$process.StandardOutput.ReadToEnd()
    [void]$process.StandardError.ReadToEnd()
    if ($process.ExitCode -eq 0) {
      return 'zero'
    }
    return 'nonzero'
  }
  catch {
    return 'startFailed'
  }
  finally {
    if ($null -ne $process) {
      $process.Dispose()
    }
  }
}

function Stop-EkyInstallerOwnedProcessTree {
  param(
    [Parameter(Mandatory = $true)]$ProcessTree,
    [int]$TimeoutMilliseconds = 10000,
    [scriptblock]$WriteSummary
  )

  if (
    $null -eq $ProcessTree.RootIdentity -or
    $TimeoutMilliseconds -lt 1
  ) {
    throw 'INSTALLER_UPGRADE_PROCESS_TREE_INVALID'
  }
  $startedAt = [DateTime]::UtcNow
  $tracked = @(Get-EkyInstallerOwnedProcessTree `
    -RootIdentity $ProcessTree.RootIdentity `
    -SeedIdentities @($ProcessTree.TrackedIdentities))
  $taskkillOutcomeClass = 'notRequired'
  if (Test-EkyInstallerProcessIdentityAlive -Identity $ProcessTree.RootIdentity) {
    $taskkillOutcomeClass = Invoke-EkyInstallerTaskkill `
      -RootProcessId $ProcessTree.RootIdentity.ProcessId
  }

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    $remaining = @(
      $tracked | Where-Object {
        Test-EkyInstallerProcessIdentityAlive -Identity $_
      }
    )
    if ($remaining.Count -eq 0 -or [DateTime]::UtcNow -ge $deadline) {
      break
    }
    Start-Sleep -Milliseconds 100
  } while ($true)

  $durationMs = [int][Math]::Max(
    0,
    ([DateTime]::UtcNow - $startedAt).TotalMilliseconds
  )
  $decision = Resolve-EkyInstallerProcessTreeCleanupDecision `
    -TaskkillOutcomeClass $taskkillOutcomeClass `
    -RemainingProcessCount $remaining.Count
  $summary = [pscustomobject]@{
    Decision = $decision
    DurationMs = $durationMs
    RemainingProcessCount = $remaining.Count
    TaskkillOutcomeClass = $taskkillOutcomeClass
    TrackedProcessCount = $tracked.Count
  }
  if ($null -ne $WriteSummary) {
    try {
      & $WriteSummary $summary | Out-Null
    }
    catch {
      # Observability must never change cleanup semantics.
    }
  }
  if ($decision -ne 'success') {
    throw 'INSTALLER_UPGRADE_PROCESS_TREE_REMAINS'
  }
  return $summary
}

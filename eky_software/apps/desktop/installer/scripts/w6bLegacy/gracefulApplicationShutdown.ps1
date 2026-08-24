function Get-W6bOwnedApplicationWindowState {
  param([Parameter(Mandatory = $true)]$RootIdentity)

  $snapshot = @(Get-EkyProcessSnapshot)
  $rootProcesses = @(
    $snapshot | Where-Object {
      $_.processId -eq $RootIdentity.processId
    }
  )
  if ($rootProcesses.Count -eq 0) {
    return [pscustomobject]@{
      ownedProcessIdentities = @()
      rootExited = $true
      windowProcess = $null
    }
  }
  if (
    $rootProcesses.Count -ne 1 -or
    $rootProcesses[0].creationToken -ne $RootIdentity.creationToken
  ) {
    throw 'W6B_LEGACY_APPLICATION_PROCESS_IDENTITY_MISMATCH'
  }

  $ownedProcessIdentities = @(
    Get-EkyOwnedProcessIdentitiesFromSnapshot `
      -RootIdentity $RootIdentity -ProcessSnapshot $snapshot
  )
  if ($ownedProcessIdentities.Count -eq 0) {
    throw 'W6B_LEGACY_APPLICATION_PROCESS_IDENTITY_MISMATCH'
  }

  $windowProcesses = @()
  foreach ($identity in $ownedProcessIdentities) {
    $process = Get-Process -Id $identity.processId -ErrorAction SilentlyContinue
    if ($null -eq $process) {
      continue
    }
    try {
      $creationToken = ConvertTo-EkyProcessCreationToken `
        -CreationTime ([DateTime]$process.StartTime)
      if ($creationToken -ne $identity.creationToken) {
        throw 'W6B_LEGACY_APPLICATION_PROCESS_IDENTITY_MISMATCH'
      }
      $process.Refresh()
      if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
        $windowProcesses += $process
      }
      else {
        $process.Dispose()
      }
    }
    catch {
      $process.Dispose()
      throw
    }
  }

  if ($windowProcesses.Count -gt 1) {
    foreach ($process in $windowProcesses) {
      $process.Dispose()
    }
    throw 'W6B_LEGACY_APPLICATION_WINDOW_OWNERSHIP_AMBIGUOUS'
  }

  return [pscustomobject]@{
    ownedProcessIdentities = $ownedProcessIdentities
    rootExited = $false
    windowProcess = if ($windowProcesses.Count -eq 1) {
      $windowProcesses[0]
    }
    else {
      $null
    }
  }
}

function Wait-W6bOwnedApplicationWindow {
  param(
    [Parameter(Mandatory = $true)]$RootIdentity,
    [Parameter(Mandatory = $true)][DateTime]$Deadline,
    [int]$PollMilliseconds = 100
  )

  if ($PollMilliseconds -lt 1) {
    throw 'W6B_LEGACY_APPLICATION_WINDOW_WAIT_INVALID'
  }

  do {
    $state = Get-W6bOwnedApplicationWindowState `
      -RootIdentity $RootIdentity
    if ($state.rootExited) {
      throw 'W6B_LEGACY_APPLICATION_EXITED_BEFORE_WINDOW'
    }
    if ($null -ne $state.windowProcess) {
      return $state
    }

    $remainingMilliseconds = [long](
      $Deadline - [DateTime]::UtcNow
    ).TotalMilliseconds
    if ($remainingMilliseconds -le 0) {
      break
    }
    Start-Sleep -Milliseconds ([Math]::Min(
      $PollMilliseconds,
      [int][Math]::Ceiling($remainingMilliseconds)
    ))
  } while ([DateTime]::UtcNow -lt $Deadline)

  throw 'W6B_LEGACY_APPLICATION_WINDOW_TIMEOUT'
}

function Stop-W6bEkyGracefully {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [int]$TimeoutMilliseconds = 30000,
    [int]$PollMilliseconds = 100
  )

  if ($TimeoutMilliseconds -lt 1 -or $PollMilliseconds -lt 1) {
    throw 'W6B_LEGACY_GRACEFUL_SHUTDOWN_WAIT_INVALID'
  }

  $rootIdentity = New-EkyProcessIdentity -ProcessId ([int]$Process.Id) `
    -CreationToken (ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$Process.StartTime))
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  $windowState = Wait-W6bOwnedApplicationWindow `
    -RootIdentity $rootIdentity `
    -Deadline $deadline `
    -PollMilliseconds $PollMilliseconds
  $windowProcess = $windowState.windowProcess
  try {
    if (!$windowProcess.CloseMainWindow()) {
      throw 'W6B_LEGACY_GRACEFUL_SHUTDOWN_UNAVAILABLE'
    }
  }
  finally {
    $windowProcess.Dispose()
  }

  do {
    $remaining = @(
      Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot `
        -OwnedProcessIdentities $windowState.ownedProcessIdentities `
        -ProcessSnapshot (Get-EkyProcessSnapshot)
    )
    if ($remaining.Count -eq 0) {
      return
    }

    $remainingMilliseconds = [long](
      $deadline - [DateTime]::UtcNow
    ).TotalMilliseconds
    if ($remainingMilliseconds -le 0) {
      break
    }
    Start-Sleep -Milliseconds ([Math]::Min(
      $PollMilliseconds,
      [int][Math]::Ceiling($remainingMilliseconds)
    ))
  } while ([DateTime]::UtcNow -lt $deadline)

  throw 'W6B_LEGACY_GRACEFUL_SHUTDOWN_TIMEOUT'
}

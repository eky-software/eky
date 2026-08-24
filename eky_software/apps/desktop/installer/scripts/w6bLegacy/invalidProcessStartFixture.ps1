Set-StrictMode -Version Latest

function New-EkyHistoricalInvalidProcessStartFixture {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('foreign', 'multipleA', 'multipleB', 'wrongExecutable')]
    [string]$Role
  )

  $eventPrefix = 'Local\EkyW6bInvalidStart-' +
    [Guid]::NewGuid().ToString('N') + "-$Role"
  $readyName = "$eventPrefix-ready"
  $releaseName = "$eventPrefix-release"
  $readyEvent = [Threading.EventWaitHandle]::new(
    $false,
    [Threading.EventResetMode]::ManualReset,
    $readyName
  )
  $releaseEvent = [Threading.EventWaitHandle]::new(
    $false,
    [Threading.EventResetMode]::ManualReset,
    $releaseName
  )
  $process = $null
  try {
    $command = ConvertTo-EkyHistoricalEncodedCommand -Command @"
`$ready = [Threading.EventWaitHandle]::OpenExisting('$readyName')
`$release = [Threading.EventWaitHandle]::OpenExisting('$releaseName')
try {
  `$ready.Set() | Out-Null
  if (!`$release.WaitOne(30000)) {
    exit 71
  }
  exit 0
}
finally {
  `$ready.Dispose()
  `$release.Dispose()
}
"@
    $process = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') `
      -ArgumentList @(
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        $command
      ) `
      -WindowStyle Hidden `
      -PassThru
    if (!$readyEvent.WaitOne(5000)) {
      throw 'W6B_LEGACY_INVALID_START_READY_TIMEOUT'
    }
    $process.Refresh()
    if ($process.HasExited) {
      throw 'W6B_LEGACY_INVALID_START_EXITED_BEFORE_READY'
    }
    $identity = New-EkyProcessIdentity -ProcessId ([int]$process.Id) `
      -CreationToken (ConvertTo-EkyProcessCreationToken `
        -CreationTime ([DateTime]$process.StartTime))
    return [pscustomobject]@{
      identity = $identity
      process = $process
      ready = $readyEvent
      release = $releaseEvent
      role = $Role
      closed = $false
    }
  }
  catch {
    $releaseEvent.Set() | Out-Null
    if ($null -ne $process) {
      try {
        $process.Refresh()
        if (!$process.HasExited) {
          Stop-EkyProcessTree -Process $process
        }
      }
      finally {
        $process.Dispose()
      }
    }
    $readyEvent.Dispose()
    $releaseEvent.Dispose()
    throw
  }
}

function Test-EkyHistoricalInvalidProcessStartFixtureActive {
  param([Parameter(Mandatory = $true)]$Fixture)

  $process = $null
  try {
    $process = [Diagnostics.Process]::GetProcessById(
      [int]$Fixture.identity.processId
    )
    $creationToken = ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$process.StartTime)
    return $creationToken -ceq [string]$Fixture.identity.creationToken
  }
  catch {
    return $false
  }
  finally {
    if ($null -ne $process) {
      $process.Dispose()
    }
  }
}

function Close-EkyHistoricalInvalidProcessStartFixture {
  param([Parameter(Mandatory = $true)]$Fixture)

  if ([bool]$Fixture.closed) {
    return
  }
  $Fixture.closed = $true
  $process = $null
  try {
    $Fixture.release.Set() | Out-Null
    try {
      $process = [Diagnostics.Process]::GetProcessById(
        [int]$Fixture.identity.processId
      )
      $creationToken = ConvertTo-EkyProcessCreationToken `
        -CreationTime ([DateTime]$process.StartTime)
      if ($creationToken -ceq [string]$Fixture.identity.creationToken) {
        if (!$process.WaitForExit(5000)) {
          Stop-EkyProcessTree -Process $process
        }
      }
    }
    catch [ArgumentException] {
    }
    if (Test-EkyHistoricalInvalidProcessStartFixtureActive -Fixture $Fixture) {
      throw 'W6B_LEGACY_INVALID_START_PROCESS_REMAINS'
    }
  }
  finally {
    if ($null -ne $process) {
      $process.Dispose()
    }
    try {
      $Fixture.process.Dispose()
    }
    finally {
      $Fixture.ready.Dispose()
      $Fixture.release.Dispose()
    }
  }
}

function Close-EkyHistoricalInvalidProcessStartFixtures {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [array]$Fixtures
  )

  $firstError = $null
  foreach ($fixture in $Fixtures) {
    try {
      Close-EkyHistoricalInvalidProcessStartFixture -Fixture $fixture
    }
    catch {
      if ($null -eq $firstError) {
        $firstError = $_
      }
    }
  }
  if ($null -ne $firstError) {
    throw $firstError
  }
}

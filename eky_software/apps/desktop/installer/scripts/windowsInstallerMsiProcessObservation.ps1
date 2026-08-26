Set-StrictMode -Version Latest

$script:EkyMsiProcessObservationPhases = @(
  'hostStarted',
  'hostIdentityCaptured',
  'waitStarted',
  'waitHeartbeat',
  'hostExited',
  'waitTimedOut',
  'cleanupStarted',
  'cleanupCompleted',
  'processTreeAbsent'
)
$script:EkyMsiProcessObservationStatuses = @(
  'started',
  'observed',
  'completed',
  'failed'
)

function New-EkyMsiProcessObservationContext {
  param(
    [Parameter(Mandatory = $true)][string]$Operation,
    [Parameter(Mandatory = $true)][bool]$Enabled,
    [AllowNull()][scriptblock]$Writer = $null
  )

  [void](Get-EkyMsiExecPolicy -Operation $Operation)
  return @{
    enabled = $Enabled
    operation = $Operation
    stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    phaseStartedAt = @{}
    writer = $Writer
  }
}

function Write-EkyMsiProcessObservation {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Context,
    [Parameter(Mandatory = $true)][string]$Phase,
    [Parameter(Mandatory = $true)][string]$Status
  )

  if (
    $Phase -notin $script:EkyMsiProcessObservationPhases -or
    $Status -notin $script:EkyMsiProcessObservationStatuses -or
    [string]$Context.operation -notmatch '^[a-z0-9_]+$' -or
    $null -eq $Context.stopwatch -or
    $null -eq $Context.phaseStartedAt
  ) {
    throw 'INSTALLER_MSI_PROCESS_OBSERVATION_INVALID'
  }
  if (![bool]$Context.enabled) {
    return
  }

  $elapsedMs = [long]$Context.stopwatch.ElapsedMilliseconds
  if ($Status -eq 'started') {
    $Context.phaseStartedAt[$Phase] = $elapsedMs
    if ($Phase -eq 'waitStarted') {
      $Context.phaseStartedAt.waitHeartbeat = $elapsedMs
      $Context.phaseStartedAt.waitTimedOut = $elapsedMs
      $Context.phaseStartedAt.hostExited = $elapsedMs
    }
    elseif ($Phase -eq 'cleanupStarted') {
      $Context.phaseStartedAt.cleanupCompleted = $elapsedMs
      $Context.phaseStartedAt.processTreeAbsent = $elapsedMs
    }
  }
  $phaseStart = if ($Context.phaseStartedAt.ContainsKey($Phase)) {
    [long]$Context.phaseStartedAt[$Phase]
  }
  else {
    0L
  }
  $line = [ordered]@{
    operation = [string]$Context.operation
    phase = $Phase
    status = $Status
    durationMs = [long][Math]::Max(0, $elapsedMs - $phaseStart)
    elapsedMs = $elapsedMs
  } | ConvertTo-Json -Compress

  try {
    if ($null -ne $Context.writer) {
      [void](& $Context.writer $line)
    }
    else {
      [Console]::Out.WriteLine($line)
    }
  }
  catch {
    # Progress evidence must never change the installer result.
  }
}

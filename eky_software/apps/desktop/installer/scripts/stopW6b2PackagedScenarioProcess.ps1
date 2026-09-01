param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)]
  [int]$RootProcessId,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{64}$')]
  [string]$ProofToken,
  [Parameter(Mandatory = $true)][ValidateSet('success', 'faultRollback')]
  [string]$ScenarioKind
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'windowsInstallerProcessTree.ps1')

$record = @(
  Get-CimInstance Win32_Process -Filter "ProcessId = $RootProcessId" `
    -OperationTimeoutSec 5 -ErrorAction Stop
)
if ($record.Count -eq 0) {
  exit 0
}
if ($record.Count -ne 1) {
  throw 'W6B2_PACKAGED_SCENARIO_PROCESS_OWNERSHIP_INVALID'
}

$tokenPattern = '(?i)(?:^|\s)-ProofToken\s+"?' +
  [regex]::Escape($ProofToken) + '"?(?:\s|$)'
$scenarioScriptName = switch ($ScenarioKind) {
  'success' { 'testW6b2PackagedSuccess.ps1' }
  'faultRollback' { 'testW6b2PackagedFaultRollback.ps1' }
  default { throw 'W6B2_PACKAGED_SCENARIO_PROCESS_OWNERSHIP_INVALID' }
}
$scriptPattern = '(?i)(?:^|[\\/])' +
  [regex]::Escape($scenarioScriptName) + '(?:"|\s|$)'
if (
  [string]::IsNullOrWhiteSpace([string]$record[0].CommandLine) -or
  [string]$record[0].CommandLine -notmatch $tokenPattern -or
  [string]$record[0].CommandLine -notmatch $scriptPattern
) {
  throw 'W6B2_PACKAGED_SCENARIO_PROCESS_OWNERSHIP_INVALID'
}

$process = [System.Diagnostics.Process]::GetProcessById($RootProcessId)
try {
  $expectedCreationToken = ConvertTo-EkyProcessCreationToken `
    -CreationTime ([DateTime]$record[0].CreationDate)
  $actualCreationToken = ConvertTo-EkyProcessCreationToken `
    -CreationTime ([DateTime]$process.StartTime)
  if ($actualCreationToken -cne $expectedCreationToken) {
    throw 'W6B2_PACKAGED_SCENARIO_PROCESS_OWNERSHIP_INVALID'
  }

  $observation = @{}
  Stop-EkyProcessTree -Process $process -TimeoutMilliseconds 20000 `
    -Observation $observation
  if ([int]$observation.remainingCount -ne 0) {
    throw 'W6B2_PACKAGED_SCENARIO_PROCESS_TREE_REMAINS'
  }
}
finally {
  $process.Dispose()
}

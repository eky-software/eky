param(
  [string]$HistoricalExecutablePath = '',
  [ValidateSet(
    'all',
    'observerNoOutput',
    'observerSingleOutput',
    'observerMultipleOutput',
    'observerFailure',
    'observerInvalidOutput',
    'ownedDescendantChain',
    'invalidStarts'
  )]
  [string]$TestCase = 'all'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) `
  'windowsInstallerProcessTree.ps1')
. (Join-Path $PSScriptRoot 'historicalPackagedSmokeProcessChain.ps1')
. (Join-Path $PSScriptRoot 'progress.ps1')

$script:AllowedHistoricalProcessChainTestCases = @(
  'observerNoOutput',
  'observerSingleOutput',
  'observerMultipleOutput',
  'observerFailure',
  'observerInvalidOutput',
  'ownedDescendantChain',
  'invalidStarts'
)
$script:CurrentHistoricalProcessChainTestCase = if ($TestCase -ceq 'all') {
  'observerNoOutput'
}
else {
  $TestCase
}

function Test-EkyHistoricalProcessChainTestCaseSelected {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
      'observerNoOutput',
      'observerSingleOutput',
      'observerMultipleOutput',
      'observerFailure',
      'observerInvalidOutput',
      'ownedDescendantChain',
      'invalidStarts'
    )]
    [string]$Name
  )

  return $TestCase -ceq 'all' -or $TestCase -ceq $Name
}

function Set-EkyHistoricalProcessChainTestCase {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
      'observerNoOutput',
      'observerSingleOutput',
      'observerMultipleOutput',
      'observerFailure',
      'observerInvalidOutput',
      'ownedDescendantChain',
      'invalidStarts'
    )]
    [string]$Name
  )

  $script:CurrentHistoricalProcessChainTestCase = $Name
}

function Get-EkyHistoricalProcessChainSafeErrorCode {
  param([Parameter(Mandatory = $true)]$ErrorRecord)

  $allowedCodes = @()
  $exception = $ErrorRecord.Exception
  while ($null -ne $exception) {
    $message = [string]$exception.Message
    if ($message -cmatch '^(W6B_[A-Z0-9_]+|INSTALLER_[A-Z0-9_]+)$') {
      $allowedCodes += $message
    }
    $exception = $exception.InnerException
  }
  if ($allowedCodes.Count -eq 1) {
    return $allowedCodes[0]
  }
  return 'W6B_LEGACY_PROCESS_CHAIN_TEST_FAILED'
}

function ConvertTo-EkyHistoricalProcessChainFailureJson {
  param([Parameter(Mandatory = $true)]$ErrorRecord)

  if (
    $script:CurrentHistoricalProcessChainTestCase -notin
      $script:AllowedHistoricalProcessChainTestCases
  ) {
    throw 'W6B_LEGACY_PROCESS_CHAIN_TEST_CASE_INVALID'
  }
  return [ordered]@{
    status = 'failed'
    testCase = $script:CurrentHistoricalProcessChainTestCase
    errorCode = Get-EkyHistoricalProcessChainSafeErrorCode `
      -ErrorRecord $ErrorRecord
  } | ConvertTo-Json -Compress
}

function ConvertTo-EkyHistoricalEncodedCommand {
  param([Parameter(Mandatory = $true)][string]$Command)

  return [Convert]::ToBase64String(
    [Text.Encoding]::Unicode.GetBytes($Command)
  )
}

$script:SyntheticProcessGenerationEvents = @{}

function Close-EkyHistoricalSyntheticProcessGenerationEvents {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('initial', 'restored')]
    [string]$Phase
  )

  $state = $script:SyntheticProcessGenerationEvents[$Phase]
  if ($null -eq $state) {
    return
  }
  try {
    $state.release.Set() | Out-Null
  }
  finally {
    $state.childReady.Dispose()
    $state.rootReady.Dispose()
    $state.release.Dispose()
    $script:SyntheticProcessGenerationEvents.Remove($Phase)
  }
}

function Close-EkyHistoricalSyntheticProcessEvents {
  foreach ($phase in @('initial', 'restored')) {
    Close-EkyHistoricalSyntheticProcessGenerationEvents -Phase $phase
  }
}

function Set-EkyHistoricalSyntheticProcessRelease {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('initial', 'restored')]
    [string]$Phase
  )

  $state = $script:SyntheticProcessGenerationEvents[$Phase]
  if ($null -eq $state) {
    throw 'W6B_LEGACY_SYNTHETIC_PROCESS_EVENTS_MISSING'
  }
  $state.release.Set() | Out-Null
}

function Start-EkyHistoricalSyntheticProcessGeneration {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('initial', 'restored')]
    [string]$Phase
  )

  Close-EkyHistoricalSyntheticProcessGenerationEvents -Phase $Phase
  $eventPrefix = 'Local\EkyW6bChain-' + [Guid]::NewGuid().ToString('N') +
    "-$Phase"
  $childReadyName = "$eventPrefix-childReady"
  $rootReadyName = "$eventPrefix-rootReady"
  $releaseName = "$eventPrefix-release"
  $state = [pscustomobject]@{
    childReady = [Threading.EventWaitHandle]::new(
      $false,
      [Threading.EventResetMode]::ManualReset,
      $childReadyName
    )
    rootReady = [Threading.EventWaitHandle]::new(
      $false,
      [Threading.EventResetMode]::ManualReset,
      $rootReadyName
    )
    release = [Threading.EventWaitHandle]::new(
      $false,
      [Threading.EventResetMode]::ManualReset,
      $releaseName
    )
  }
  $script:SyntheticProcessGenerationEvents[$Phase] = $state
  $rootProcess = $null
  try {
    $childCommand = ConvertTo-EkyHistoricalEncodedCommand -Command @"
`$childReady = [Threading.EventWaitHandle]::OpenExisting('$childReadyName')
`$release = [Threading.EventWaitHandle]::OpenExisting('$releaseName')
try {
  `$childReady.Set() | Out-Null
  if (!`$release.WaitOne(5000)) {
    exit 41
  }
  exit 0
}
finally {
  `$childReady.Dispose()
  `$release.Dispose()
}
"@
    $rootCommand = ConvertTo-EkyHistoricalEncodedCommand -Command @"
`$childReady = [Threading.EventWaitHandle]::OpenExisting('$childReadyName')
`$rootReady = [Threading.EventWaitHandle]::OpenExisting('$rootReadyName')
`$release = [Threading.EventWaitHandle]::OpenExisting('$releaseName')
`$child = `$null
try {
  `$child = Start-Process powershell.exe -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-EncodedCommand', '$childCommand'
  ) -WindowStyle Hidden -PassThru
  if (!`$childReady.WaitOne(5000)) {
    exit 42
  }
  `$rootReady.Set() | Out-Null
  if (!`$release.WaitOne(5000)) {
    exit 43
  }
  exit 0
}
finally {
  if (`$null -ne `$child) {
    `$child.Dispose()
  }
  `$childReady.Dispose()
  `$rootReady.Dispose()
  `$release.Dispose()
}
"@
    $rootProcess = Start-Process powershell.exe -ArgumentList @(
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      $rootCommand
    ) -WindowStyle Hidden -PassThru
    if (!$state.rootReady.WaitOne(5000)) {
      throw 'W6B_LEGACY_SYNTHETIC_ROOT_READY_TIMEOUT'
    }
    $rootProcess.Refresh()
    if ($rootProcess.HasExited) {
      throw 'W6B_LEGACY_SYNTHETIC_ROOT_EXITED_BEFORE_READY'
    }
    return $rootProcess
  }
  catch {
    $state.release.Set() | Out-Null
    if ($null -ne $rootProcess) {
      try {
        $rootProcess.Refresh()
        if (!$rootProcess.HasExited) {
          Stop-EkyProcessTree -Process $rootProcess
        }
      }
      finally {
        $rootProcess.Dispose()
      }
    }
    Close-EkyHistoricalSyntheticProcessGenerationEvents -Phase $Phase
    throw
  }
}

function Start-EkyHistoricalExecutable {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][hashtable]$EnvironmentOverrides
  )

  $previousValues = @{}
  try {
    foreach ($name in $EnvironmentOverrides.Keys) {
      $previousValues[$name] = [Environment]::GetEnvironmentVariable(
        $name,
        [EnvironmentVariableTarget]::Process
      )
      [Environment]::SetEnvironmentVariable(
        $name,
        $EnvironmentOverrides[$name],
        [EnvironmentVariableTarget]::Process
      )
    }
    return Start-Process -FilePath $ExecutablePath `
      -ArgumentList $Arguments -PassThru
  }
  finally {
    foreach ($name in $EnvironmentOverrides.Keys) {
      [Environment]::SetEnvironmentVariable(
        $name,
        $previousValues[$name],
        [EnvironmentVariableTarget]::Process
      )
    }
  }
}

function Read-EkyHistoricalSmokeResult {
  param([Parameter(Mandatory = $true)][string]$ResultPath)

  if (!(Test-Path -LiteralPath $ResultPath -PathType Leaf)) {
    return $null
  }
  try {
    $result = Get-Content -LiteralPath $ResultPath -Raw -Encoding UTF8 |
      ConvertFrom-Json
  }
  catch {
    return $null
  }
  if (
    [string]$result.stage -notmatch '^[a-z][A-Za-z]{1,49}$' -or
    [string]$result.status -cnotin @('started', 'failed', 'ok')
  ) {
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
  }
  return $result
}

function Remove-EkyHistoricalPrivateTestRoot {
  param([Parameter(Mandatory = $true)][string]$Root)

  $canonicalTempRoot = [IO.Path]::GetFullPath(
    [IO.Path]::GetTempPath()
  ).TrimEnd('\') + '\'
  $canonicalRoot = [IO.Path]::GetFullPath($Root)
  if (
    !$canonicalRoot.StartsWith(
      $canonicalTempRoot,
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    [IO.Path]::GetFileName($canonicalRoot) -cnotmatch `
      '^eky-hps-[0-9a-f]{32}$'
  ) {
    throw 'W6B_LEGACY_TEST_ROOT_INVALID'
  }
  if (!(Test-Path -LiteralPath $canonicalRoot)) {
    return
  }
  $process = Start-Process `
    -FilePath (Join-Path $env:SystemRoot 'System32\cmd.exe') `
    -ArgumentList @(
      '/d',
      '/c',
      'rd',
      '/s',
      '/q',
      "`"$canonicalRoot`""
    ) `
    -WindowStyle Hidden `
    -PassThru
  try {
    if (!$process.WaitForExit(10000)) {
      $process.Kill()
      throw 'W6B_LEGACY_TEST_ROOT_CLEANUP_TIMEOUT'
    }
    if (
      $process.ExitCode -ne 0 -or
      (Test-Path -LiteralPath $canonicalRoot)
    ) {
      throw 'W6B_LEGACY_TEST_ROOT_CLEANUP_FAILED'
    }
  }
  finally {
    $process.Dispose()
  }
}

function Assert-EkyHistoricalProcessChainFailure {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$StartPhase,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutablePath,
    [Parameter(Mandatory = $true)][string]$ExpectedCode
  )

  try {
    Invoke-HistoricalPackagedSmokeProcessChain `
      -StartPhase $StartPhase `
      -ExpectedExecutablePath $ExpectedExecutablePath `
      -ReadResult {
        [pscustomobject]@{ stage = 'restoreRestart'; status = 'started' }
      } `
      -ObserveResult { param($Result) } `
      -ObserveProcess { param($Process) } `
      -ValidateResult {
        param($Process, $Result, $ExpectedStage, $ExpectedStatus)
      } `
      -TimeoutMilliseconds 2000 `
      -PollMilliseconds 25 | Out-Null
    throw 'W6B_LEGACY_EXPECTED_FAILURE_MISSING'
  }
  catch {
    if ($_.Exception.Message -cne $ExpectedCode) {
      throw
    }
  }
}

function Invoke-EkyHistoricalObserverOutputContract {
  param(
    [Parameter(Mandatory = $true)][ValidateRange(0, 3)]
    [int]$ProcessOutputCount,
    [Parameter(Mandatory = $true)][ValidateRange(0, 3)]
    [int]$ResultOutputCount
  )

  $script:ObserverContractPhase = $null
  $script:ObserverProcessOutputCount = $ProcessOutputCount
  $script:ObserverResultOutputCount = $ResultOutputCount
  $script:ObserverProcessOutputWritten = $false
  $script:ObserverResultOutputWritten = $false
  $script:ObserverContractReleaseEvent = $null
  $script:AllowedStages = @('sourceStartup')
  $script:CurrentStage = 'sourceStartup'
  $script:ScenarioStartedAt = [DateTime]::UtcNow
  $script:StageStartedAt = $script:ScenarioStartedAt
  $output = $null
  try {
    $output = @(
      Invoke-HistoricalPackagedSmokeProcessChain `
        -ExpectedExecutablePath (Join-Path $PSHOME 'powershell.exe') `
        -StartPhase {
          param([string]$Phase)
          if ($null -ne $script:ObserverContractReleaseEvent) {
            $script:ObserverContractReleaseEvent.Dispose()
          }
          $script:ObserverContractPhase = $Phase
          $eventName = 'Local\EkyW6bObserver-' + `
            [Guid]::NewGuid().ToString('N')
          $script:ObserverContractReleaseEvent = `
            [Threading.EventWaitHandle]::new(
              $false,
              [Threading.EventResetMode]::ManualReset,
              $eventName
            )
          $waitCommand = ConvertTo-EkyHistoricalEncodedCommand -Command @"
`$releaseEvent = [Threading.EventWaitHandle]::OpenExisting('$eventName')
try {
  `$releaseEvent.WaitOne() | Out-Null
}
finally {
  `$releaseEvent.Dispose()
}
"@
          Start-Process powershell.exe -ArgumentList @(
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            $waitCommand
          ) -WindowStyle Hidden -PassThru
        } `
        -ReadResult {
          $script:ObserverContractReleaseEvent.Set() | Out-Null
          if ($script:ObserverContractPhase -ceq 'initial') {
            return [pscustomobject]@{
              stage = 'restoreRestart'
              status = 'started'
            }
          }
          return [pscustomobject]@{
            electronVersion = '43.2.0'
            stage = 'shutdown'
            status = 'ok'
          }
        } `
        -ObserveResult {
          param($Result)
          if (!$script:ObserverResultOutputWritten) {
            $script:ObserverResultOutputWritten = $true
            for (
              $index = 0
              $index -lt $script:ObserverResultOutputCount
              $index += 1
            ) {
              Write-W6bLegacyReadinessObservation -Signal backendHealthReady
            }
          }
        } `
        -ObserveProcess {
          param($Process)
          if (!$script:ObserverProcessOutputWritten) {
            $script:ObserverProcessOutputWritten = $true
            for (
              $index = 0
              $index -lt $script:ObserverProcessOutputCount
              $index += 1
            ) {
              Write-W6bLegacyReadinessObservation -Signal backendUtilityReady
            }
          }
        } `
        -ValidateResult {
          param(
            $Process,
            $Result,
            [string]$ExpectedStage,
            [string]$ExpectedStatus
          )
          if (
            $Process.ExitCode -ne 0 -or
            $Result.stage -cne $ExpectedStage -or
            $Result.status -cne $ExpectedStatus
          ) {
            throw 'W6B_LEGACY_SOURCE_SMOKE_FAILED'
          }
        } `
        -TimeoutMilliseconds 3000 `
        -PollMilliseconds 25
    )
  }
  finally {
    if ($null -ne $script:ObserverContractReleaseEvent) {
      $script:ObserverContractReleaseEvent.Set() | Out-Null
      $script:ObserverContractReleaseEvent.Dispose()
      $script:ObserverContractReleaseEvent = $null
    }
  }
  if (
    $output.Count -ne 1 -or
    $output[0] -isnot [pscustomobject] -or
    $output[0].contract -cne 'explicitTwoPhase' -or
    $output[0].initialGenerationCount -ne 1 -or
    $output[0].restoredGenerationCount -ne 1 -or
    $output[0].remainingOwnedProcessCount -ne 0
  ) {
    throw 'W6B_LEGACY_OBSERVER_OUTPUT_CONTAMINATED'
  }
  return $output[0]
}

function Invoke-EkyHistoricalObserverFailure {
  $script:ObserverFailureState = $null
  try {
    Invoke-HistoricalPackagedSmokeProcessChain `
      -ExpectedExecutablePath (Join-Path $PSHOME 'powershell.exe') `
      -StartPhase {
        param([string]$Phase)
        $eventPrefix = 'Local\EkyW6bObserverFailure-' + `
          [Guid]::NewGuid().ToString('N')
        $readyName = "$eventPrefix-ready"
        $releaseName = "$eventPrefix-release"
        $state = [pscustomobject]@{
          process = $null
          ready = [Threading.EventWaitHandle]::new(
            $false,
            [Threading.EventResetMode]::ManualReset,
            $readyName
          )
          release = [Threading.EventWaitHandle]::new(
            $false,
            [Threading.EventResetMode]::ManualReset,
            $releaseName
          )
        }
        $script:ObserverFailureState = $state
        try {
          $waitCommand = ConvertTo-EkyHistoricalEncodedCommand -Command @"
`$ready = [Threading.EventWaitHandle]::OpenExisting('$readyName')
`$release = [Threading.EventWaitHandle]::OpenExisting('$releaseName')
try {
  `$ready.Set() | Out-Null
  if (!`$release.WaitOne(5000)) {
    exit 51
  }
  exit 0
}
finally {
  `$ready.Dispose()
  `$release.Dispose()
}
"@
          $state.process = Start-Process powershell.exe -ArgumentList @(
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            $waitCommand
          ) -WindowStyle Hidden -PassThru
          if (!$state.ready.WaitOne(5000)) {
            throw 'W6B_LEGACY_OBSERVER_READY_TIMEOUT'
          }
          $state.process.Refresh()
          if ($state.process.HasExited) {
            throw 'W6B_LEGACY_OBSERVER_EXITED_BEFORE_READY'
          }
          return $state.process
        }
        catch {
          $state.release.Set() | Out-Null
          if ($null -ne $state.process) {
            try {
              $state.process.Refresh()
              if (!$state.process.HasExited) {
                Stop-EkyProcessTree -Process $state.process
              }
            }
            finally {
              $state.process.Dispose()
            }
          }
          throw
        }
      } `
      -ReadResult {
        $state = $script:ObserverFailureState
        if ($null -eq $state -or $null -eq $state.process) {
          throw 'W6B_LEGACY_OBSERVER_STATE_MISSING'
        }
        $state.release.Set() | Out-Null
        if (!$state.process.WaitForExit(5000)) {
          throw 'W6B_LEGACY_OBSERVER_EXIT_TIMEOUT'
        }
        $state.process.Refresh()
        if ($state.process.ExitCode -ne 0) {
          throw 'W6B_LEGACY_OBSERVER_PROCESS_FAILED'
        }
        return [pscustomobject]@{
          stage = 'restoreRestart'
          status = 'started'
        }
      } `
      -ObserveResult { throw 'W6B_LEGACY_OBSERVER_FAILED' } `
      -ObserveProcess { param($Process) } `
      -ValidateResult {
        param(
          $Process,
          $Result,
          [string]$ExpectedStage,
          [string]$ExpectedStatus
        )
      } `
      -TimeoutMilliseconds 3000 `
      -PollMilliseconds 25 | Out-Null
  }
  finally {
    $state = $script:ObserverFailureState
    if ($null -ne $state) {
      $state.release.Set() | Out-Null
      $state.ready.Dispose()
      $state.release.Dispose()
      $script:ObserverFailureState = $null
    }
  }
}

function Assert-EkyHistoricalObserverFailurePreserved {
  try {
    Invoke-EkyHistoricalObserverFailure
    throw 'W6B_LEGACY_EXPECTED_FAILURE_MISSING'
  }
  catch {
    if ($_.Exception.Message -cne 'W6B_LEGACY_OBSERVER_FAILED') {
      throw
    }
  }
}

function Invoke-EkyHistoricalInvalidObserverOutput {
  Invoke-EkyHistoricalObserver `
    -Observer { [pscustomobject]@{ unsafe = 'value' } } `
    -Argument ([pscustomobject]@{})
}

function Assert-EkyHistoricalObserverOutputRejected {
  try {
    Invoke-EkyHistoricalInvalidObserverOutput
    throw 'W6B_LEGACY_EXPECTED_FAILURE_MISSING'
  }
  catch {
    if ($_.Exception.Message -cne 'W6B_LEGACY_OBSERVER_OUTPUT_INVALID') {
      throw
    }
  }
}

$script:phase = $null
$script:initialStarts = 0
$script:restoredStarts = 0
$foreignProcess = $null
$foreignReadyEvent = $null
$foreignReleaseEvent = $null
$status = 'failed'
$foreignProcessUntouched = $false
$chain = $null
$privateTestRoot = $null
$terminalError = $null
$terminalOutcome = $null
$fixture = if ($HistoricalExecutablePath -eq '') {
  'synthetic'
}
else {
  'historicalPackage'
}
$processChainTimeoutMilliseconds = if ($fixture -ceq 'historicalPackage') {
  60000
}
else {
  5000
}
$processChainPollMilliseconds = if ($fixture -ceq 'historicalPackage') {
  250
}
else {
  25
}

try {
  $historicalExecutable = $null
  $smokeResultPath = $null
  $smokeTempRoot = $null
  $smokeToken = $null
  $isolatedAppDataRoot = $null
  if ($fixture -ceq 'historicalPackage') {
    $resolvedExecutable = Resolve-Path -LiteralPath $HistoricalExecutablePath
    $metadata = Get-Item -LiteralPath $resolvedExecutable.Path -Force
    if (
      $metadata.PSIsContainer -or
      ($metadata.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      $metadata.Name -cne 'Eky.exe'
    ) {
      throw 'W6B_LEGACY_SOURCE_EXECUTABLE_INVALID'
    }
    $historicalExecutable = $resolvedExecutable.Path
    $privateTestRoot = Join-Path ([IO.Path]::GetTempPath()) `
      ('eky-hps-' + [Guid]::NewGuid().ToString('N'))
    $smokeTempRoot = Join-Path $privateTestRoot 'smoke-temp'
    $isolatedAppDataRoot = Join-Path $privateTestRoot 'app-data-roaming'
    $smokeToken = [Guid]::NewGuid().ToString('N')
    $smokeRoot = Join-Path `
      (Join-Path $smokeTempRoot 'eky-desktop-smoke') $smokeToken
    $smokeResultPath = Join-Path $smokeRoot `
      'result\desktop-smoke-result.json'
    [IO.Directory]::CreateDirectory((Split-Path -Parent $smokeResultPath)) |
      Out-Null
    [IO.Directory]::CreateDirectory($isolatedAppDataRoot) | Out-Null
    [IO.File]::WriteAllText(
      $smokeResultPath,
      "{`"stage`":`"startup`",`"status`":`"started`"}`n",
      [Text.UTF8Encoding]::new($false)
    )
  }

  if (
    Test-EkyHistoricalProcessChainTestCaseSelected `
      -Name observerNoOutput
  ) {
    Set-EkyHistoricalProcessChainTestCase -Name observerNoOutput
    Invoke-EkyHistoricalObserverOutputContract `
      -ProcessOutputCount 0 -ResultOutputCount 0 | Out-Null
  }
  if (
    Test-EkyHistoricalProcessChainTestCaseSelected `
      -Name observerSingleOutput
  ) {
    Set-EkyHistoricalProcessChainTestCase -Name observerSingleOutput
    Invoke-EkyHistoricalObserverOutputContract `
      -ProcessOutputCount 1 -ResultOutputCount 0 | Out-Null
  }
  if (
    Test-EkyHistoricalProcessChainTestCaseSelected `
      -Name observerMultipleOutput
  ) {
    Set-EkyHistoricalProcessChainTestCase -Name observerMultipleOutput
    Invoke-EkyHistoricalObserverOutputContract `
      -ProcessOutputCount 2 -ResultOutputCount 2 | Out-Null
  }
  if (
    Test-EkyHistoricalProcessChainTestCaseSelected -Name observerFailure
  ) {
    Set-EkyHistoricalProcessChainTestCase -Name observerFailure
    if ($TestCase -ceq 'all') {
      Assert-EkyHistoricalObserverFailurePreserved
    }
    else {
      Invoke-EkyHistoricalObserverFailure
    }
  }
  if (
    Test-EkyHistoricalProcessChainTestCaseSelected `
      -Name observerInvalidOutput
  ) {
    Set-EkyHistoricalProcessChainTestCase -Name observerInvalidOutput
    if ($TestCase -ceq 'all') {
      Assert-EkyHistoricalObserverOutputRejected
    }
    else {
      Invoke-EkyHistoricalInvalidObserverOutput
    }
  }

  if (
    Test-EkyHistoricalProcessChainTestCaseSelected `
      -Name ownedDescendantChain
  ) {
    Set-EkyHistoricalProcessChainTestCase -Name ownedDescendantChain
    $foreignEventPrefix = 'Local\EkyW6bForeign-' + `
      [Guid]::NewGuid().ToString('N')
    $foreignReadyName = "$foreignEventPrefix-ready"
    $foreignReleaseName = "$foreignEventPrefix-release"
    $foreignReadyEvent = [Threading.EventWaitHandle]::new(
      $false,
      [Threading.EventResetMode]::ManualReset,
      $foreignReadyName
    )
    $foreignReleaseEvent = [Threading.EventWaitHandle]::new(
      $false,
      [Threading.EventResetMode]::ManualReset,
      $foreignReleaseName
    )
    $foreignCommand = ConvertTo-EkyHistoricalEncodedCommand -Command @"
`$ready = [Threading.EventWaitHandle]::OpenExisting('$foreignReadyName')
`$release = [Threading.EventWaitHandle]::OpenExisting('$foreignReleaseName')
try {
  `$ready.Set() | Out-Null
  if (!`$release.WaitOne(30000)) {
    exit 61
  }
  exit 0
}
finally {
  `$ready.Dispose()
  `$release.Dispose()
}
"@
    $foreignProcess = Start-Process powershell.exe -ArgumentList @(
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      $foreignCommand
    ) -WindowStyle Hidden -PassThru
    if (!$foreignReadyEvent.WaitOne(5000)) {
      throw 'W6B_LEGACY_FOREIGN_PROCESS_READY_TIMEOUT'
    }
    $foreignProcess.Refresh()
    if ($foreignProcess.HasExited) {
      throw 'W6B_LEGACY_FOREIGN_PROCESS_EXITED_BEFORE_READY'
    }

    $chain = Invoke-HistoricalPackagedSmokeProcessChain `
    -ExpectedExecutablePath $(if ($fixture -ceq 'historicalPackage') {
      $historicalExecutable
    }
    else {
      Join-Path $PSHOME 'powershell.exe'
    }) `
    -StartPhase {
      param([string]$Phase)
      if ($Phase -ceq 'initial') {
        $script:initialStarts += 1
      }
      elseif ($Phase -ceq 'restored') {
        $script:restoredStarts += 1
      }
      else {
        throw 'W6B_LEGACY_SOURCE_PROCESS_PHASE_INVALID'
      }
      $script:phase = $Phase
      if ($fixture -ceq 'historicalPackage') {
        $arguments = if ($Phase -ceq 'initial') {
          @('--desktop-smoke')
        }
        else {
          @('--desktop-smoke', '--desktop-smoke-restored')
        }
        return Start-EkyHistoricalExecutable `
          -ExecutablePath $historicalExecutable `
          -Arguments $arguments `
          -EnvironmentOverrides @{
            APPDATA = $isolatedAppDataRoot
            ELECTRON_ENABLE_SECURITY_WARNINGS = 'true'
            ELECTRON_RUN_AS_NODE = $null
            EKY_DESKTOP_SMOKE_TOKEN = $smokeToken
            TEMP = $smokeTempRoot
            TMP = $smokeTempRoot
          }
      }
      return Start-EkyHistoricalSyntheticProcessGeneration -Phase $Phase
    } `
    -ReadResult {
      if ($fixture -ceq 'historicalPackage') {
        return Read-EkyHistoricalSmokeResult -ResultPath $smokeResultPath
      }
      Set-EkyHistoricalSyntheticProcessRelease -Phase $script:phase
      if ($script:phase -ceq 'initial') {
        return [pscustomobject]@{
          stage = 'restoreRestart'
          status = 'started'
        }
      }
      return [pscustomobject]@{
        electronVersion = '43.2.0'
        stage = 'shutdown'
        status = 'ok'
      }
    } `
    -ObserveResult { param($Result) } `
    -ObserveProcess { param($Process) } `
    -ValidateResult {
      param($Process, $Result, [string]$ExpectedStage, [string]$ExpectedStatus)
      if (
        $Process.ExitCode -ne 0 -or
        $Result.stage -cne $ExpectedStage -or
        $Result.status -cne $ExpectedStatus
      ) {
        throw 'W6B_LEGACY_SOURCE_SMOKE_FAILED'
      }
      if (
        $ExpectedStatus -ceq 'ok' -and
        [string]$Result.electronVersion -notmatch '^\d+\.\d+\.\d+$'
      ) {
        throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
      }
    } `
    -TimeoutMilliseconds $processChainTimeoutMilliseconds `
    -PollMilliseconds $processChainPollMilliseconds

    $foreignProcess.Refresh()
    $foreignProcessUntouched = !$foreignProcess.HasExited
    if (
      $script:initialStarts -ne 1 -or
      $script:restoredStarts -ne 1 -or
      $chain.initialGenerationCount -ne 1 -or
      $chain.restoredGenerationCount -ne 1 -or
      $chain.initialOwnedProcessCount -lt 2 -or
      $chain.restoredOwnedProcessCount -lt 2 -or
      $chain.remainingOwnedProcessCount -ne 0 -or
      !$foreignProcessUntouched
    ) {
      throw 'W6B_LEGACY_SOURCE_PROCESS_CHAIN_INVALID'
    }
    Close-EkyHistoricalSyntheticProcessEvents
    $foreignReleaseEvent.Set() | Out-Null
    if (!$foreignProcess.WaitForExit(5000)) {
      throw 'W6B_LEGACY_FOREIGN_PROCESS_EXIT_TIMEOUT'
    }
    $foreignProcess.Refresh()
    if ($foreignProcess.ExitCode -ne 0) {
      throw 'W6B_LEGACY_FOREIGN_PROCESS_FAILED'
    }
    $foreignProcess.Dispose()
    $foreignProcess = $null
    $foreignReadyEvent.Dispose()
    $foreignReadyEvent = $null
    $foreignReleaseEvent.Dispose()
    $foreignReleaseEvent = $null
  }

  if (
    $fixture -ceq 'synthetic' -and
    (Test-EkyHistoricalProcessChainTestCaseSelected -Name invalidStarts)
  ) {
    Set-EkyHistoricalProcessChainTestCase -Name invalidStarts
    $powerShellExecutable = Join-Path $PSHOME 'powershell.exe'
    Assert-EkyHistoricalProcessChainFailure `
      -ExpectedExecutablePath $powerShellExecutable `
      -ExpectedCode 'W6B_LEGACY_SOURCE_PROCESS_START_FAILED' `
      -StartPhase { param([string]$Phase) return $null }
    Assert-EkyHistoricalProcessChainFailure `
      -ExpectedExecutablePath $powerShellExecutable `
      -ExpectedCode 'W6B_LEGACY_SOURCE_PROCESS_START_FAILED' `
      -StartPhase {
        param([string]$Phase)
        @(
          Start-Process powershell.exe -ArgumentList @(
            '-NoProfile', '-NonInteractive', '-Command',
            'Start-Sleep -Seconds 5'
          ) -WindowStyle Hidden -PassThru
          Start-Process powershell.exe -ArgumentList @(
            '-NoProfile', '-NonInteractive', '-Command',
            'Start-Sleep -Seconds 5'
          ) -WindowStyle Hidden -PassThru
        )
      }
    Assert-EkyHistoricalProcessChainFailure `
      -ExpectedExecutablePath $powerShellExecutable `
      -ExpectedCode 'W6B_LEGACY_SOURCE_PROCESS_EXECUTABLE_INVALID' `
      -StartPhase {
        param([string]$Phase)
        Start-Process (Join-Path $env:SystemRoot 'System32\cmd.exe') `
          -ArgumentList @(
            '/d', '/c', 'ping.exe', '-w', '1000', '-n', '10', '127.0.0.1'
          ) `
          -WindowStyle Hidden -PassThru
      }
  }
  $status = 'succeeded'
  if ($TestCase -ceq 'all') {
    $terminalOutcome = [ordered]@{
      status = $status
      fixture = $fixture
      contract = $chain.contract
      initialGenerationCount = $chain.initialGenerationCount
      restoredGenerationCount = $chain.restoredGenerationCount
      initialOwnedProcessCount = $chain.initialOwnedProcessCount
      restoredOwnedProcessCount = $chain.restoredOwnedProcessCount
      remainingOwnedProcessCount = $chain.remainingOwnedProcessCount
      foreignProcessUntouched = $foreignProcessUntouched
      invalidProcessStartsRejected = ($fixture -ceq 'synthetic')
    }
  }
  elseif ($TestCase -ceq 'ownedDescendantChain') {
    $terminalOutcome = [ordered]@{
      status = $status
      testCase = $TestCase
      fixture = $fixture
      contract = $chain.contract
      initialGenerationCount = $chain.initialGenerationCount
      restoredGenerationCount = $chain.restoredGenerationCount
      initialOwnedProcessCount = $chain.initialOwnedProcessCount
      restoredOwnedProcessCount = $chain.restoredOwnedProcessCount
      remainingOwnedProcessCount = $chain.remainingOwnedProcessCount
      foreignProcessUntouched = $foreignProcessUntouched
    }
  }
  elseif ($TestCase -ceq 'invalidStarts') {
    $terminalOutcome = [ordered]@{
      status = $status
      testCase = $TestCase
      invalidProcessStartsRejected = $true
    }
  }
  else {
    $terminalOutcome = [ordered]@{
      status = $status
      testCase = $TestCase
    }
  }
}
catch {
  $terminalError = $_
}
finally {
  try {
    Close-EkyHistoricalSyntheticProcessEvents
    if ($null -ne $foreignReleaseEvent) {
      $foreignReleaseEvent.Set() | Out-Null
    }
    if ($null -ne $foreignProcess) {
      $foreignProcess.Refresh()
      if (!$foreignProcess.HasExited) {
        Stop-EkyProcessTree -Process $foreignProcess
      }
      $foreignProcess.Dispose()
    }
    if ($null -ne $foreignReadyEvent) {
      $foreignReadyEvent.Dispose()
    }
    if ($null -ne $foreignReleaseEvent) {
      $foreignReleaseEvent.Dispose()
    }
    if ($null -ne $privateTestRoot) {
      Remove-EkyHistoricalPrivateTestRoot -Root $privateTestRoot
    }
  }
  catch {
    if ($null -eq $terminalError) {
      $terminalError = $_
    }
  }
}

if ($null -ne $terminalError) {
  ConvertTo-EkyHistoricalProcessChainFailureJson -ErrorRecord $terminalError
  exit 1
}

$terminalOutcome | ConvertTo-Json -Compress

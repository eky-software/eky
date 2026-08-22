param([string]$HistoricalExecutablePath = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerProcessTree.ps1')
. (Join-Path $PSScriptRoot 'historicalPackagedSmokeProcessChain.ps1')

function ConvertTo-EkyHistoricalEncodedCommand {
  param([Parameter(Mandatory = $true)][string]$Command)

  return [Convert]::ToBase64String(
    [Text.Encoding]::Unicode.GetBytes($Command)
  )
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

$script:phase = $null
$script:initialStarts = 0
$script:restoredStarts = 0
$foreignProcess = $null
$status = 'failed'
$foreignProcessUntouched = $false
$chain = $null
$privateTestRoot = $null
$fixture = if ($HistoricalExecutablePath -eq '') {
  'synthetic'
}
else {
  'historicalPackage'
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

  $foreignProcess = Start-Process powershell.exe -ArgumentList @(
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Start-Sleep -Seconds 15'
  ) -WindowStyle Hidden -PassThru

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
      $childCommand = ConvertTo-EkyHistoricalEncodedCommand `
        -Command 'Start-Sleep -Milliseconds 800'
      $rootCommand = ConvertTo-EkyHistoricalEncodedCommand -Command @"
`$child = Start-Process powershell.exe -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-EncodedCommand', '$childCommand'
) -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 300
exit 0
"@
      Start-Process powershell.exe -ArgumentList @(
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        $rootCommand
      ) -WindowStyle Hidden -PassThru
    } `
    -ReadResult {
      if ($fixture -ceq 'historicalPackage') {
        return Read-EkyHistoricalSmokeResult -ResultPath $smokeResultPath
      }
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
    -TimeoutMilliseconds 5000 `
    -PollMilliseconds 25

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
  if ($fixture -ceq 'synthetic') {
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
}
finally {
  if ($null -ne $foreignProcess) {
    $foreignProcess.Refresh()
    if (!$foreignProcess.HasExited) {
      Stop-EkyProcessTree -Process $foreignProcess
    }
    $foreignProcess.Dispose()
  }
  if ($null -ne $privateTestRoot) {
    Remove-EkyHistoricalPrivateTestRoot -Root $privateTestRoot
  }
}

[ordered]@{
  status = $status
  fixture = $fixture
  contract = $chain.contract
  initialGenerationCount = $chain.initialGenerationCount
  restoredGenerationCount = $chain.restoredGenerationCount
  remainingOwnedProcessCount = $chain.remainingOwnedProcessCount
  foreignProcessUntouched = $foreignProcessUntouched
  invalidProcessStartsRejected = ($fixture -ceq 'synthetic')
} | ConvertTo-Json -Compress

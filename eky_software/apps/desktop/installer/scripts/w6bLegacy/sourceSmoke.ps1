function Read-W6bSourceSmokeResult {
  param([switch]$AllowMissing)

  if (!(Test-Path -LiteralPath $sourceSmokeResultPath -PathType Leaf)) {
    if ($AllowMissing) {
      return $null
    }
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_MISSING'
  }
  $metadata = Get-Item -LiteralPath $sourceSmokeResultPath -Force
  if (
    $metadata.PSIsContainer -or
    ($metadata.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or
    $metadata.Length -gt 4096
  ) {
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
  }
  if ($metadata.Length -lt 1) {
    if ($AllowMissing) {
      return $null
    }
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
  }
  try {
    $value = Get-Content -LiteralPath $sourceSmokeResultPath -Raw `
      -Encoding UTF8 | ConvertFrom-Json
  }
  catch {
    if ($AllowMissing) {
      return $null
    }
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
  }
  if (
    [string]$value.stage -cnotin $script:AllowedSourceSmokeStages -or
    [string]$value.status -cnotin @('started', 'failed', 'ok')
  ) {
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
  }
  $keys = @($value.PSObject.Properties.Name | Sort-Object)
  if (
    $value.status -ceq 'started' -and
    @(Compare-Object $keys @('stage', 'status')).Count -eq 0
  ) {
    return $value
  }
  if (
    $value.status -ceq 'failed' -and
    @(Compare-Object $keys @('code', 'stage', 'status')).Count -eq 0 -and
    [string]$value.code -cmatch '^[A-Z][A-Z0-9_]{0,99}$'
  ) {
    return $value
  }
  if (
    $value.status -ceq 'ok' -and
    $value.stage -ceq 'shutdown' -and
    @(Compare-Object $keys @('electronVersion', 'stage', 'status')).Count `
      -eq 0 -and
    [string]$value.electronVersion -match '^\d+\.\d+\.\d+$'
  ) {
    return $value
  }
  throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
}

function Initialize-W6bSourceSmokeResult {
  $resultDirectory = Split-Path -Parent $sourceSmokeResultPath
  New-Item -ItemType Directory -Path $resultDirectory -Force | Out-Null
  $json = [ordered]@{
    stage = 'startup'
    status = 'started'
  } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText(
    $sourceSmokeResultPath,
    "$json`n",
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Update-W6bSourceSmokeObservations {
  param([Parameter(Mandatory = $true)]$Result)

  $script:SourceFailurePhase = [string]$Result.stage
  $stageIndex = $script:AllowedSourceSmokeStages.IndexOf(
    [string]$Result.stage
  )
  if (
    !$script:SourceBackendHealthObserved -and
    $stageIndex -ge $script:AllowedSourceSmokeStages.IndexOf('diagnostics')
  ) {
    $script:SourceBackendHealthObserved = $true
    Write-W6bLegacyReadinessObservation -Signal backendHealthReady
  }
  if (
    !$script:SourceRuntimeSessionObserved -and
    $stageIndex -ge
      $script:AllowedSourceSmokeStages.IndexOf('restoredSessionValidated')
  ) {
    $script:SourceRuntimeSessionObserved = $true
    Write-W6bLegacyReadinessObservation -Signal runtimeSessionValidated
  }
}

function Invoke-W6bSourcePackagedSmoke {
  New-Item -ItemType Directory -Path $sourceSmokeTempRoot -Force | Out-Null
  Initialize-W6bSourceSmokeResult
  $chain = Invoke-HistoricalPackagedSmokeProcessChain `
    -ExpectedExecutablePath (Join-Path $installRoot 'Eky.exe') `
    -StartPhase {
      param([string]$Phase)
      $arguments = if ($Phase -ceq 'initial') {
        @('--desktop-smoke')
      }
      elseif ($Phase -ceq 'restored') {
        @('--desktop-smoke', '--desktop-smoke-restored')
      }
      else {
        throw 'W6B_LEGACY_SOURCE_PROCESS_PHASE_INVALID'
      }
      Start-W6bEkyProcess -Arguments $arguments `
        -EnvironmentOverrides @{
          APPDATA = $isolatedAppDataRoot
          ELECTRON_ENABLE_SECURITY_WARNINGS = 'true'
          ELECTRON_RUN_AS_NODE = $null
          EKY_DESKTOP_SMOKE_TOKEN = $sourceSmokeToken
          TEMP = $sourceSmokeTempRoot
          TMP = $sourceSmokeTempRoot
        }
    } `
    -ReadResult { Read-W6bSourceSmokeResult -AllowMissing } `
    -ReadFinalResult { Read-W6bSourceSmokeResult } `
    -ObserveResult {
      param($Result)
      Update-W6bSourceSmokeObservations -Result $Result
    } `
    -ObserveProcess {
      param($Process)
      if (!$script:SourceUtilityObserved) {
        $script:SourceUtilityObserved = Test-W6bUtilityDescendant `
          -RootProcessId $Process.Id
        if ($script:SourceUtilityObserved) {
          Write-W6bLegacyReadinessObservation -Signal backendUtilityReady
        }
      }
    } `
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
    }
  if (
    $chain.contract -cne 'explicitTwoPhase' -or
    $chain.initialGenerationCount -ne 1 -or
    $chain.restoredGenerationCount -ne 1 -or
    $chain.remainingOwnedProcessCount -ne 0
  ) {
    throw 'W6B_LEGACY_SOURCE_PROCESS_CHAIN_INVALID'
  }
  if (
    !$script:SourceUtilityObserved -or
    !$script:SourceBackendHealthObserved -or
    !$script:SourceRuntimeSessionObserved
  ) {
    throw 'W6B_LEGACY_SOURCE_SMOKE_READINESS_MISSING'
  }
}

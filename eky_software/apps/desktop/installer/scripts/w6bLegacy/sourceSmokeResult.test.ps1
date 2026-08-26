Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'sourceSmoke.ps1')

function Assert-W6bSourceSmokeResultTestThrows {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$ExpectedCode
  )

  try {
    & $Action
  }
  catch {
    if ($_.Exception.Message -cne $ExpectedCode) {
      throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_TEST_UNEXPECTED_ERROR'
    }
    return
  }
  throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_TEST_EXPECTED_ERROR_MISSING'
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) `
  ('eky-w6b-smoke-result-' + [Guid]::NewGuid().ToString('N'))
$script:sourceSmokeResultPath = Join-Path $testRoot 'result.json'
$script:AllowedSourceSmokeStages = @('startup', 'secondBackup', 'shutdown')

try {
  [void](New-Item -ItemType Directory -Path $testRoot)

  [IO.File]::WriteAllBytes($script:sourceSmokeResultPath, [byte[]]::new(0))
  if ($null -ne (Read-W6bSourceSmokeResult -AllowMissing)) {
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_TEST_TRANSIENT_NOT_IGNORED'
  }
  Assert-W6bSourceSmokeResultTestThrows {
    Read-W6bSourceSmokeResult
  } 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'

  [IO.File]::WriteAllText(
    $script:sourceSmokeResultPath,
    '{"stage":"secondBackup","status":"started"}',
    [Text.UTF8Encoding]::new($false)
  )
  $progress = Read-W6bSourceSmokeResult -AllowMissing
  if (
    $progress.stage -cne 'secondBackup' -or
    $progress.status -cne 'started'
  ) {
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_TEST_PROGRESS_INVALID'
  }

  [IO.File]::WriteAllText(
    $script:sourceSmokeResultPath,
    '{"electronVersion":"43.2.0","stage":"shutdown","status":"ok"}',
    [Text.UTF8Encoding]::new($false)
  )
  $terminal = Read-W6bSourceSmokeResult
  if (
    $terminal.stage -cne 'shutdown' -or
    $terminal.status -cne 'ok' -or
    $terminal.electronVersion -cne '43.2.0'
  ) {
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_TEST_TERMINAL_INVALID'
  }

  [IO.File]::WriteAllText(
    $script:sourceSmokeResultPath,
    ('x' * 4097),
    [Text.UTF8Encoding]::new($false)
  )
  Assert-W6bSourceSmokeResultTestThrows {
    Read-W6bSourceSmokeResult -AllowMissing
  } 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'

  [Console]::Out.WriteLine((ConvertTo-Json -InputObject ([ordered]@{
    status = 'succeeded'
    transientWriteIgnoredDuringPolling = $true
    terminalReadRemainsStrict = $true
    structuralInvalidityRejected = $true
  }) -Compress))
}
finally {
  Remove-Item -LiteralPath $testRoot -Force -Recurse -ErrorAction SilentlyContinue
}

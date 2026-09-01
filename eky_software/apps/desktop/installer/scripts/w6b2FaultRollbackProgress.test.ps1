Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'w6b2Fault\rollbackProgress.ps1')

$path = Join-Path ([IO.Path]::GetTempPath()) `
  "eky-w6b2-rollback-progress-$([Guid]::NewGuid().ToString('N')).jsonl"

function Write-TestProgress {
  param([Parameter(Mandatory = $true)][string]$Value)

  [IO.File]::WriteAllText(
    $path,
    $Value,
    [Text.UTF8Encoding]::new($false)
  )
}

function Assert-InvalidProgress {
  param([Parameter(Mandatory = $true)][string]$Value)

  Write-TestProgress -Value $Value
  try {
    [void](Read-W6b2FaultRollbackProgress -Path $path)
  }
  catch {
    if ($_.Exception.Message -ceq 'W6B2_FAULT_ROLLBACK_PROGRESS_INVALID') {
      return
    }
    throw
  }
  throw 'W6B2_FAULT_ROLLBACK_PROGRESS_TEST_FAILED'
}

try {
  Write-TestProgress -Value (
    '{"durationMs":0,"elapsedMs":1,"event":"started","phase":"inputValidation"}' + "`n" +
    '{"durationMs":2,"elapsedMs":3,"event":"completed","phase":"inputValidation"}' + "`n" +
    '{"durationMs":4,"elapsedMs":5,"event":"started","phase":"launcherExitWait"}'
  )
  $records = @(Read-W6b2FaultRollbackProgress -Path $path)
  if (
    $records.Count -ne 2 -or
    $records[0].phase -cne 'inputValidation' -or
    $records[1].event -cne 'completed'
  ) {
    throw 'W6B2_FAULT_ROLLBACK_PROGRESS_TEST_FAILED'
  }

  Assert-InvalidProgress -Value (
    '{"durationMs":0,"elapsedMs":1,"event":"started","phase":"unknown"}' + "`n"
  )
  Assert-InvalidProgress -Value (
    '{"durationMs":0,"elapsedMs":1,"event":"started","phase":"inputValidation","path":"C:/private"}' + "`n"
  )
  Assert-InvalidProgress -Value (
    '{"durationMs":0,"elapsedMs":1,"event":"started","phase":"inputValidation","stack":"private"}' + "`n"
  )

  [Console]::Out.WriteLine('{"status":"succeeded"}')
}
finally {
  Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
}

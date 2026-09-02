param(
  [Parameter(Mandatory = $true)][string]$EncodedArguments,
  [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'windowsInstallerProcessTree.ps1')

$hostFailureExitCode = 255
$hostTimeoutExitCode = 254
$process = $null

try {
  if ($TimeoutMilliseconds -lt 1) {
    exit $hostFailureExitCode
  }
  $argumentJson = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String($EncodedArguments)
  )
  $decodedArguments = [string[]](ConvertFrom-Json -InputObject $argumentJson)
  if (
    $decodedArguments.Count -lt 1 -or
    @($decodedArguments | Where-Object {
      $_ -isnot [string] -or $_.Length -lt 1 -or $_.Length -gt 32767
    }).Count -ne 0
  ) {
    exit $hostFailureExitCode
  }

  $process = Start-Process `
    -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') `
    -ArgumentList ([string[]]$decodedArguments) `
    -WindowStyle Hidden `
    -PassThru
  if (!$process.WaitForExit($TimeoutMilliseconds)) {
    Stop-EkyProcessTree -Process $process -TimeoutMilliseconds 10000
    exit $hostTimeoutExitCode
  }
  exit ([int]$process.ExitCode)
}
catch {
  exit $hostFailureExitCode
}
finally {
  if ($null -ne $process) {
    $process.Dispose()
  }
}

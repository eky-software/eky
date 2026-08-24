param(
  [Parameter(Mandatory = $true)][string]$EncodedArguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hostFailureExitCode = 255
$process = $null

try {
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
    -NoNewWindow `
    -Wait `
    -PassThru
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

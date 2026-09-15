param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$ExpectedExecutablePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  $expected = [System.IO.Path]::GetFullPath($ExpectedExecutablePath)
  if ($expected -cnotmatch '^[A-Za-z]:\\') {
    exit 64
  }
  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  try {
    $null = $process.Handle
    $process.Refresh()
    $actual = [System.IO.Path]::GetFullPath($process.Path)
    if (!$actual.Equals($expected, [System.StringComparison]::OrdinalIgnoreCase) -or $process.HasExited) {
      exit 65
    }
    Add-Type -Path (Join-Path $PSScriptRoot 'WindowsApplicationCloseRequest.cs')
    $result = [Eky.WindowsAcceptance.WindowsApplicationCloseRequest]::Request($process, $null)
  }
  finally {
    $process.Dispose()
  }
  exit $result
}
catch {
  exit 67
}

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
    $process.Refresh()
    $actual = [System.IO.Path]::GetFullPath($process.Path)
    if (
      !$actual.Equals($expected, [System.StringComparison]::OrdinalIgnoreCase) -or
      $process.HasExited -or
      $process.MainWindowHandle -eq [IntPtr]::Zero
    ) {
      exit 65
    }
    if (!$process.CloseMainWindow()) {
      exit 66
    }
  }
  finally {
    $process.Dispose()
  }
  exit 0
}
catch {
  exit 67
}

param([Parameter(Mandatory = $true)][string]$ResultPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  if (![IO.Path]::IsPathRooted($ResultPath) -or
    $ResultPath.IndexOf([char]0) -ge 0 -or
    $ResultPath -match '(^|[\\/])(?:\.|\.\.)([\\/]|$)' -or
    $ResultPath -match '[\\/]$' -or (Test-Path -LiteralPath $ResultPath)) { exit 64 }
  $current = [Diagnostics.Process]::GetCurrentProcess()
  try { $sessionId = $current.SessionId } finally { $current.Dispose() }
  $processes = @(Get-Process -ErrorAction Stop)
  try {
    $count = @($processes | Where-Object {
      $_.ProcessName -eq 'msiexec' -and $_.SessionId -eq $sessionId
    }).Count
  } finally { foreach ($process in $processes) { $process.Dispose() } }
  $result = [ordered]@{ schemaVersion = 1; msiClientCount = $count } | ConvertTo-Json -Compress
  $stream = [IO.File]::Open($ResultPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes("$result`n")
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
  exit 0
} catch { exit 1 }

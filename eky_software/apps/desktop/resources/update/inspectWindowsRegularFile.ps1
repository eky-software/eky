param(
  [Parameter(Mandatory = $true)]
  [string]$FilePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$item = Get-Item -LiteralPath $FilePath -Force
if (
  $item.PSIsContainer -or
  (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
) {
  throw 'UPDATE_REGULAR_FILE_REQUIRED'
}

[ordered]@{
  length = [long]$item.Length
  lastWriteTimeUtcTicks = $item.LastWriteTimeUtc.Ticks.ToString(
    [System.Globalization.CultureInfo]::InvariantCulture
  )
} | ConvertTo-Json -Compress

param(
  [string]$DotnetExecutable = 'dotnet'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installerDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$projectPath = Join-Path $installerDirectory 'Eky.Installer.wixproj'
$configPath = Join-Path $installerDirectory 'NuGet.Config'
$lockPath = Join-Path $installerDirectory 'packages.lock.json'

function Get-LockHash {
  if (!(Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    throw 'INSTALLER_RESTORE_LOCK_MISSING'
  }
  $stream = [System.IO.File]::OpenRead($lockPath)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $algorithm.ComputeHash($stream)
    return [System.BitConverter]::ToString($hash).Replace('-', '')
  }
  finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

function Invoke-LockedRestore {
  $process = Start-Process -FilePath $DotnetExecutable -ArgumentList @(
    'restore',
    "`"$projectPath`"",
    '--locked-mode',
    '--configfile',
    "`"$configPath`"",
    '--verbosity',
    'minimal'
  ) -NoNewWindow -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "INSTALLER_LOCKED_RESTORE_FAILED:$($process.ExitCode)"
  }
}

$initialHash = Get-LockHash
Invoke-LockedRestore
$firstRestoreHash = Get-LockHash
Invoke-LockedRestore
$secondRestoreHash = Get-LockHash

if (
  $initialHash -ne $firstRestoreHash -or
  $firstRestoreHash -ne $secondRestoreHash
) {
  throw 'INSTALLER_RESTORE_LOCK_CHANGED'
}

[ordered]@{
  lockSha256 = $secondRestoreHash.ToLowerInvariant()
  lockedMode = $true
  restoreCount = 2
  source = 'https://api.nuget.org/v3/index.json'
} | ConvertTo-Json -Compress

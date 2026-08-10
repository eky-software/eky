param(
  [Parameter(Mandatory = $true)]
  [string]$MsiPath,

  [Parameter(Mandatory = $true)]
  [string]$PayloadRoot,

  [Parameter(Mandatory = $true)]
  [string]$ProductCode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedMsiPath = (Resolve-Path -LiteralPath $MsiPath).Path
$resolvedPayloadRoot = (Resolve-Path -LiteralPath $PayloadRoot).Path
$normalizedProductCode = "{$($ProductCode.Trim('{}').ToUpperInvariant())}"
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Eky'
$shortcutPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Eky\Eky.lnk'
$businessDataRoot = Join-Path $env:APPDATA 'Eky'
$logRoot = Join-Path $env:TEMP "eky-installer-lifecycle-$([guid]::NewGuid().ToString('N'))"
$installer = New-Object -ComObject WindowsInstaller.Installer
$installedByThisTest = $false
$completed = $false

function Get-ProductState {
  param([Parameter(Mandatory = $true)][string]$Code)

  try {
    return $installer.ProductState($Code)
  }
  catch {
    return -1
  }
}

function Invoke-MsiExec {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Operation
  )

  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $Arguments `
    -NoNewWindow -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "INSTALLER_LIFECYCLE_$($Operation.ToUpperInvariant())_FAILED:$($process.ExitCode)"
  }
}

function Get-DirectoryInventory {
  param([Parameter(Mandatory = $true)][string]$Root)

  if (!(Test-Path -LiteralPath $Root -PathType Container)) {
    return @()
  }
  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
  return @(
    Get-ChildItem -LiteralPath $resolvedRoot -File -Recurse -Force |
      Sort-Object FullName |
      ForEach-Object {
        $relativePath = $_.FullName.Substring($resolvedRoot.Length).TrimStart('\')
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        "$relativePath|$($_.Length)|$hash"
      }
  )
}

function Assert-InventoryEqual {
  param(
    [Parameter(Mandatory = $true)][object[]]$Actual,
    [Parameter(Mandatory = $true)][object[]]$Expected,
    [Parameter(Mandatory = $true)][string]$Code
  )

  if ($Actual.Count -ne $Expected.Count) {
    throw "$Code`: file count mismatch"
  }
  for ($index = 0; $index -lt $Expected.Count; $index += 1) {
    if ($Actual[$index] -ne $Expected[$index]) {
      throw "$Code`: content mismatch"
    }
  }
}

function Assert-InstalledPayload {
  $installedInventory = Get-DirectoryInventory -Root $installRoot
  Assert-InventoryEqual $installedInventory $payloadInventory 'INSTALLER_PAYLOAD_MISMATCH'
  if (!(Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
    throw 'INSTALLER_SHORTCUT_MISSING'
  }
}

function Install-Eky {
  param([Parameter(Mandatory = $true)][string]$LogName)

  $logPath = Join-Path $logRoot $LogName
  Invoke-MsiExec -Operation 'install' -Arguments @(
    '/i',
    "`"$resolvedMsiPath`"",
    '/qn',
    '/norestart',
    '/l*v',
    "`"$logPath`""
  )
  $script:installedByThisTest = $true
  Assert-InstalledPayload
}

function Uninstall-Eky {
  param([Parameter(Mandatory = $true)][string]$LogName)

  $logPath = Join-Path $logRoot $LogName
  Invoke-MsiExec -Operation 'uninstall' -Arguments @(
    '/x',
    $normalizedProductCode,
    '/qn',
    '/norestart',
    '/l*v',
    "`"$logPath`""
  )
  $script:installedByThisTest = $false
  if (Test-Path -LiteralPath $installRoot) {
    throw 'INSTALLER_UNINSTALL_ROOT_REMAINS'
  }
  if (Test-Path -LiteralPath $shortcutPath) {
    throw 'INSTALLER_UNINSTALL_SHORTCUT_REMAINS'
  }
}

try {
  if ((Get-ProductState -Code $normalizedProductCode) -ge 1) {
    throw 'INSTALLER_LIFECYCLE_EXISTING_PRODUCT_FORBIDDEN'
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw 'INSTALLER_LIFECYCLE_EXISTING_INSTALL_ROOT_FORBIDDEN'
  }
  if (@(Get-Process -Name 'Eky' -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'INSTALLER_LIFECYCLE_RUNNING_PROCESS_FORBIDDEN'
  }

  New-Item -ItemType Directory -Path $logRoot | Out-Null
  $payloadInventory = Get-DirectoryInventory -Root $resolvedPayloadRoot
  $businessDataInventoryBefore = Get-DirectoryInventory -Root $businessDataRoot

  Install-Eky -LogName 'install.log'

  $repairTarget = Join-Path $installRoot 'resources\backend\dist\index.js'
  Remove-Item -LiteralPath $repairTarget -Force
  if (Test-Path -LiteralPath $repairTarget) {
    throw 'INSTALLER_REPAIR_FIXTURE_DELETE_FAILED'
  }
  Invoke-MsiExec -Operation 'repair' -Arguments @(
    '/fa',
    $normalizedProductCode,
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot 'repair.log')`""
  )
  Assert-InstalledPayload

  Uninstall-Eky -LogName 'uninstall.log'
  Assert-InventoryEqual (Get-DirectoryInventory -Root $businessDataRoot) `
    $businessDataInventoryBefore 'INSTALLER_BUSINESS_DATA_CHANGED'

  Install-Eky -LogName 'reinstall.log'
  Assert-InventoryEqual (Get-DirectoryInventory -Root $businessDataRoot) `
    $businessDataInventoryBefore 'INSTALLER_BUSINESS_DATA_CHANGED'
  Uninstall-Eky -LogName 'reinstall-uninstall.log'
  Assert-InventoryEqual (Get-DirectoryInventory -Root $businessDataRoot) `
    $businessDataInventoryBefore 'INSTALLER_BUSINESS_DATA_CHANGED'

  $completed = $true
  [ordered]@{
    businessDataPreserved = $true
    cleanInstall = $true
    installRoot = '%LOCALAPPDATA%\Programs\Eky'
    payloadFileCount = $payloadInventory.Count
    reinstall = $true
    repair = $true
    shortcutRemoved = $true
    uninstall = $true
  } | ConvertTo-Json -Compress
}
finally {
  if ($installedByThisTest) {
    try {
      Invoke-MsiExec -Operation 'cleanup' -Arguments @(
        '/x',
        $normalizedProductCode,
        '/qn',
        '/norestart',
        '/l*v',
        "`"$(Join-Path $logRoot 'cleanup.log')`""
      )
    }
    catch {
      Write-Warning 'Installer lifecycle cleanup failed; inspect the private test log directory.'
    }
  }
  if ($null -ne $installer) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
  }
  if ($completed -and (Test-Path -LiteralPath $logRoot)) {
    Remove-Item -LiteralPath $logRoot -Force -Recurse
  }
}

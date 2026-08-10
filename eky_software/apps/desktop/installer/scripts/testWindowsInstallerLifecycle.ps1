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
. (Join-Path $PSScriptRoot 'windowsInstallerTestSupport.ps1')

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

function Install-Eky {
  param([Parameter(Mandatory = $true)][string]$LogName)

  $logPath = Join-Path $logRoot $LogName
  Invoke-EkyMsiExec -Operation 'lifecycle_install' -Arguments @(
    '/i',
    "`"$resolvedMsiPath`"",
    '/qn',
    '/norestart',
    '/l*v',
    "`"$logPath`""
  )
  $script:installedByThisTest = $true
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
}

function Uninstall-Eky {
  param([Parameter(Mandatory = $true)][string]$LogName)

  $logPath = Join-Path $logRoot $LogName
  Invoke-EkyMsiExec -Operation 'lifecycle_uninstall' -Arguments @(
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
  if ((Get-EkyProductState -Installer $installer -Code $normalizedProductCode) -ge 1) {
    throw 'INSTALLER_LIFECYCLE_EXISTING_PRODUCT_FORBIDDEN'
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw 'INSTALLER_LIFECYCLE_EXISTING_INSTALL_ROOT_FORBIDDEN'
  }
  if (@(Get-Process -Name 'Eky' -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'INSTALLER_LIFECYCLE_RUNNING_PROCESS_FORBIDDEN'
  }

  New-Item -ItemType Directory -Path $logRoot | Out-Null
  $payloadInventory = Get-EkyDirectoryInventory -Root $resolvedPayloadRoot
  $businessDataInventoryBefore = Get-EkyDirectoryInventory -Root $businessDataRoot

  Install-Eky -LogName 'install.log'

  $repairTarget = Join-Path $installRoot 'resources\backend\dist\index.js'
  Remove-Item -LiteralPath $repairTarget -Force
  if (Test-Path -LiteralPath $repairTarget) {
    throw 'INSTALLER_REPAIR_FIXTURE_DELETE_FAILED'
  }
  Invoke-EkyMsiExec -Operation 'lifecycle_repair' -Arguments @(
    '/fa',
    $normalizedProductCode,
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot 'repair.log')`""
  )
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath

  Uninstall-Eky -LogName 'uninstall.log'
  Assert-EkyInventoryEqual (Get-EkyDirectoryInventory -Root $businessDataRoot) `
    $businessDataInventoryBefore 'INSTALLER_BUSINESS_DATA_CHANGED'

  Install-Eky -LogName 'reinstall.log'
  Assert-EkyInventoryEqual (Get-EkyDirectoryInventory -Root $businessDataRoot) `
    $businessDataInventoryBefore 'INSTALLER_BUSINESS_DATA_CHANGED'
  Uninstall-Eky -LogName 'reinstall-uninstall.log'
  Assert-EkyInventoryEqual (Get-EkyDirectoryInventory -Root $businessDataRoot) `
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
      Invoke-EkyMsiExec -Operation 'lifecycle_cleanup' -Arguments @(
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

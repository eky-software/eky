Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerTestSupport.ps1')

$installerDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$fixtureRoot = Join-Path $installerDirectory 'artifacts\upgrade-fixture'
$fixturePath = Join-Path $fixtureRoot 'fixture.json'
$payloadRoot = (Resolve-Path -LiteralPath (Join-Path $installerDirectory '..\out\Eky-win32-x64')).Path
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Eky'
$shortcutPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Eky\Eky.lnk'
$businessDataRoot = Join-Path $env:APPDATA 'Eky'
$logRoot = Join-Path $env:TEMP "eky-installer-upgrade-$([guid]::NewGuid().ToString('N'))"
$unicodeDirectoryName = "Eky installer testi $([char]0x00E4) $([char]0x00F6)"
$unicodeSourceRoot = Join-Path $logRoot $unicodeDirectoryName
$unicodeMsiPath = Join-Path $unicodeSourceRoot 'Eky asennin.msi'
$installer = New-Object -ComObject WindowsInstaller.Installer
$completed = $false
$currentProductCode = $null
$nextProductCode = $null

function Normalize-ProductCode {
  param([Parameter(Mandatory = $true)][string]$Code)

  if ($Code -notmatch '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$') {
    throw 'INSTALLER_UPGRADE_FIXTURE_PRODUCT_CODE_INVALID'
  }
  return "{$($Code.ToUpperInvariant())}"
}

function Resolve-FixtureMsi {
  param([Parameter(Mandatory = $true)][string]$Path)

  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  $resolvedRoot = (Resolve-Path -LiteralPath $fixtureRoot).Path.TrimEnd('\') + '\'
  if (
    !$resolvedPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    [System.IO.Path]::GetExtension($resolvedPath) -ne '.msi'
  ) {
    throw 'INSTALLER_UPGRADE_FIXTURE_MSI_PATH_INVALID'
  }
  return $resolvedPath
}

function Assert-ProductInstalled {
  param([Parameter(Mandatory = $true)][string]$ProductCode)

  if ((Get-EkyProductState -Installer $installer -Code $ProductCode) -lt 1) {
    throw 'INSTALLER_UPGRADE_EXPECTED_PRODUCT_MISSING'
  }
}

function Assert-ProductAbsent {
  param([Parameter(Mandatory = $true)][string]$ProductCode)

  if ((Get-EkyProductState -Installer $installer -Code $ProductCode) -ge 1) {
    throw 'INSTALLER_UPGRADE_UNEXPECTED_PRODUCT_PRESENT'
  }
}

function Install-EkyMsi {
  param(
    [Parameter(Mandatory = $true)][string]$MsiPath,
    [Parameter(Mandatory = $true)][string]$LogName
  )

  $arguments = @(
    '/i',
    "`"$MsiPath`"",
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot $LogName)`""
  )
  Invoke-EkyMsiExec -Operation 'upgrade_install' -Arguments $arguments | Out-Null
}

function Uninstall-EkyProduct {
  param(
    [Parameter(Mandatory = $true)][string]$ProductCode,
    [Parameter(Mandatory = $true)][string]$LogName
  )

  Invoke-EkyMsiExec -Operation 'upgrade_uninstall' -Arguments @(
    '/x',
    $ProductCode,
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot $LogName)`""
  ) | Out-Null
}

function Assert-BusinessDataUnchanged {
  Assert-EkyInventoryEqual (Get-EkyDirectoryInventory -Root $businessDataRoot) `
    $businessDataInventoryBefore 'INSTALLER_UPGRADE_BUSINESS_DATA_CHANGED'
}

try {
  $fixture = Get-Content -LiteralPath $fixturePath -Raw -Encoding UTF8 |
    ConvertFrom-Json
  if ($fixture.fixtureFormatVersion -ne 1) {
    throw 'INSTALLER_UPGRADE_FIXTURE_FORMAT_INVALID'
  }
  if ($fixture.payloadRoot -ne $payloadRoot) {
    throw 'INSTALLER_UPGRADE_FIXTURE_PAYLOAD_ROOT_INVALID'
  }
  if ([version]$fixture.next.msiProductVersion -le [version]$fixture.current.msiProductVersion) {
    throw 'INSTALLER_UPGRADE_FIXTURE_VERSION_ORDER_INVALID'
  }

  $currentMsiPath = Resolve-FixtureMsi -Path $fixture.current.msiPath
  $nextMsiPath = Resolve-FixtureMsi -Path $fixture.next.msiPath
  $rollbackMsiPath = Resolve-FixtureMsi -Path $fixture.rollback.msiPath
  $currentProductCode = Normalize-ProductCode -Code $fixture.current.productCode
  $nextProductCode = Normalize-ProductCode -Code $fixture.next.productCode
  $rollbackProductCode = Normalize-ProductCode -Code $fixture.rollback.productCode
  if ($currentProductCode -eq $nextProductCode) {
    throw 'INSTALLER_UPGRADE_FIXTURE_PRODUCT_CODES_NOT_DISTINCT'
  }
  if ($rollbackProductCode -ne $nextProductCode) {
    throw 'INSTALLER_UPGRADE_ROLLBACK_PRODUCT_CODE_INVALID'
  }
  if ($fixture.payloadFileCount -lt 1) {
    throw 'INSTALLER_UPGRADE_FIXTURE_PAYLOAD_COUNT_INVALID'
  }
  if ($fixture.rollback.payloadFileCount -ne $fixture.payloadFileCount + 1) {
    throw 'INSTALLER_UPGRADE_ROLLBACK_PAYLOAD_COUNT_INVALID'
  }

  Assert-ProductAbsent -ProductCode $currentProductCode
  Assert-ProductAbsent -ProductCode $nextProductCode
  if (Test-Path -LiteralPath $installRoot) {
    throw 'INSTALLER_UPGRADE_EXISTING_INSTALL_ROOT_FORBIDDEN'
  }
  if (@(Get-Process -Name 'Eky' -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'INSTALLER_UPGRADE_RUNNING_PROCESS_FORBIDDEN'
  }

  New-Item -ItemType Directory -Path $logRoot | Out-Null
  $payloadInventory = Get-EkyDirectoryInventory -Root $payloadRoot
  if ($payloadInventory.Count -ne $fixture.payloadFileCount) {
    throw 'INSTALLER_UPGRADE_FIXTURE_PAYLOAD_COUNT_MISMATCH'
  }
  $businessDataInventoryBefore = Get-EkyDirectoryInventory -Root $businessDataRoot

  Install-EkyMsi -MsiPath $currentMsiPath -LogName 'install-current.log'
  Assert-ProductInstalled -ProductCode $currentProductCode
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath

  Install-EkyMsi -MsiPath $nextMsiPath -LogName 'upgrade-next.log'
  Assert-ProductAbsent -ProductCode $currentProductCode
  Assert-ProductInstalled -ProductCode $nextProductCode
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
  Assert-BusinessDataUnchanged

  Invoke-EkyMsiExecExpectedFailure -Operation 'downgrade' -Arguments @(
    '/i',
    "`"$currentMsiPath`"",
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot 'downgrade.log')`""
  ) | Out-Null
  Assert-ProductAbsent -ProductCode $currentProductCode
  Assert-ProductInstalled -ProductCode $nextProductCode
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
  Assert-BusinessDataUnchanged

  Uninstall-EkyProduct -ProductCode $nextProductCode -LogName 'uninstall-next.log'
  Assert-ProductAbsent -ProductCode $nextProductCode
  Assert-EkyPathEventuallyAbsent -Path $installRoot `
    -Code 'INSTALLER_UPGRADE_UNINSTALL_ROOT_REMAINS'

  New-Item -ItemType Directory -Path $unicodeSourceRoot | Out-Null
  Copy-Item -LiteralPath $currentMsiPath -Destination $unicodeMsiPath
  Install-EkyMsi -MsiPath $unicodeMsiPath -LogName 'install-unicode.log'
  Assert-ProductInstalled -ProductCode $currentProductCode
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
  Uninstall-EkyProduct -ProductCode $currentProductCode -LogName 'uninstall-unicode.log'
  Assert-ProductAbsent -ProductCode $currentProductCode
  Assert-EkyPathEventuallyAbsent -Path $installRoot `
    -Code 'INSTALLER_UPGRADE_UNICODE_INSTALL_ROOT_REMAINS'
  Remove-Item -LiteralPath $unicodeSourceRoot -Force -Recurse
  Assert-BusinessDataUnchanged

  Install-EkyMsi -MsiPath $currentMsiPath -LogName 'install-before-rollback.log'
  $rollbackBlocker = Join-Path $installRoot `
    'resources\desktop-runtime\installer-rollback-probe'
  Set-Content -LiteralPath $rollbackBlocker -Value 'synthetic filesystem blocker' `
    -Encoding ASCII -NoNewline
  Invoke-EkyMsiExecExpectedFailure -Operation 'rollback_probe' -Arguments @(
    '/i',
    "`"$rollbackMsiPath`"",
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot 'rollback-probe.log')`""
  ) | Out-Null
  Assert-ProductInstalled -ProductCode $currentProductCode
  Assert-ProductAbsent -ProductCode $nextProductCode
  Remove-Item -LiteralPath $rollbackBlocker -Force
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
  Assert-BusinessDataUnchanged

  Uninstall-EkyProduct -ProductCode $currentProductCode -LogName 'uninstall-current.log'
  Assert-ProductAbsent -ProductCode $currentProductCode
  Assert-EkyPathEventuallyAbsent -Path $installRoot `
    -Code 'INSTALLER_UPGRADE_FINAL_ROOT_REMAINS'
  Assert-EkyPathEventuallyAbsent -Path $shortcutPath `
    -Code 'INSTALLER_UPGRADE_FINAL_SHORTCUT_REMAINS'
  Assert-BusinessDataUnchanged

  $completed = $true
  [ordered]@{
    businessDataPreserved = $true
    downgradeBlocked = $true
    majorUpgrade = $true
    payloadFileCount = $payloadInventory.Count
    rollbackRestoredPreviousVersion = $true
    unicodeAndSpaceSourcePath = $true
  } | ConvertTo-Json -Compress
}
finally {
  foreach ($productCode in @($nextProductCode, $currentProductCode)) {
    if (
      $null -ne $productCode -and
      (Get-EkyProductState -Installer $installer -Code $productCode) -ge 1
    ) {
      try {
        Invoke-EkyMsiExec -Operation 'upgrade_cleanup' -Arguments @(
          '/x',
          $productCode,
          '/qn',
          '/norestart',
          '/l*v',
          "`"$(Join-Path $logRoot "cleanup-$($productCode.Trim('{}')).log")`""
        )
      }
      catch {
        Write-Warning 'Installer upgrade cleanup failed; inspect the private test log directory.'
      }
    }
  }
  if ($null -ne $installer) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
  }
  if ($completed) {
    foreach ($path in @($logRoot)) {
      if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force -Recurse
      }
    }
  }
}

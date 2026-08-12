Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerTestSupport.ps1')

$installerDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$fixtureRoot = Join-Path $installerDirectory 'artifacts\upgrade-fixture'
$artifactsRoot = Join-Path $installerDirectory 'artifacts'
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
$runningEkyProcess = $null

function Normalize-ProductCode {
  param([Parameter(Mandatory = $true)][string]$Code)

  if ($Code -notmatch '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$') {
    throw 'INSTALLER_UPGRADE_FIXTURE_PRODUCT_CODE_INVALID'
  }
  return "{$($Code.ToUpperInvariant())}"
}

function Resolve-FixtureMsi {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][ValidateSet('current', 'next', 'rollback')]
    [string]$Role
  )

  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  $allowedRoot = if ($Role -eq 'current') { $artifactsRoot } else { $fixtureRoot }
  $resolvedRoot = (Resolve-Path -LiteralPath $allowedRoot).Path.TrimEnd('\') + '\'
  if (
    !$resolvedPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    [System.IO.Path]::GetExtension($resolvedPath) -ne '.msi'
  ) {
    throw 'INSTALLER_UPGRADE_FIXTURE_MSI_PATH_INVALID'
  }
  return $resolvedPath
}

function Invoke-EkyUpgradeAttempt {
  param(
    [Parameter(Mandatory = $true)][string]$MsiPath,
    [Parameter(Mandatory = $true)][string]$LogName
  )

  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @(
    '/i',
    "`"$MsiPath`"",
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot $LogName)`""
  ) -NoNewWindow -Wait -PassThru
  return $process.ExitCode
}

function Invoke-EkyCoordinatedRollback {
  param(
    [Parameter(Mandatory = $true)][string]$FailedProductCode,
    [Parameter(Mandatory = $true)][string]$FailedPackagePath,
    [Parameter(Mandatory = $true)][string]$RollbackPackagePath
  )

  $rollbackScriptPath = Join-Path $installRoot `
    'resources\update-runtime\rollbackWindowsInstaller.ps1'
  if (!(Test-Path -LiteralPath $rollbackScriptPath -PathType Leaf)) {
    throw 'INSTALLER_UPGRADE_ROLLBACK_SCRIPT_MISSING'
  }
  $msiExecPath = Join-Path $env:SystemRoot 'System32\msiexec.exe'
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    "`"$rollbackScriptPath`"",
    '-MsiExecPath',
    "`"$msiExecPath`"",
    '-FailedProductCode',
    $FailedProductCode,
    '-FailedPackagePath',
    "`"$FailedPackagePath`"",
    '-RollbackPackagePath',
    "`"$RollbackPackagePath`""
  ) -NoNewWindow -Wait -PassThru
  return $process.ExitCode
}

function Start-EkyForUpgrade {
  $executablePath = Join-Path $installRoot 'Eky.exe'
  $testUserDataRoot = Join-Path $logRoot 'running-upgrade-user-data'
  New-Item -ItemType Directory -Path $testUserDataRoot | Out-Null
  $process = Start-Process -FilePath $executablePath -ArgumentList @(
    "--user-data-dir=`"$testUserDataRoot`""
  ) -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    $rootProcess = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    if ($null -eq $rootProcess) {
      throw 'INSTALLER_UPGRADE_EKY_PROCESS_EXITED_EARLY'
    }
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $descendantIds = @($process.Id)
    $foundUtilityProcess = $false
    do {
      $previousCount = $descendantIds.Count
      foreach ($candidate in $processes) {
        if (
          $descendantIds -contains [int]$candidate.ParentProcessId -and
          $descendantIds -notcontains [int]$candidate.ProcessId
        ) {
          $descendantIds += [int]$candidate.ProcessId
          if (
            $candidate.Name -eq 'Eky.exe' -and
            $candidate.CommandLine -match '--type=utility'
          ) {
            $foundUtilityProcess = $true
          }
        }
      }
    } while ($descendantIds.Count -ne $previousCount)
    if ($foundUtilityProcess) {
      return $process
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'INSTALLER_UPGRADE_BACKEND_UTILITY_PROCESS_MISSING'
}

function Stop-EkyProcessTree {
  param($Process)

  if ($null -eq $Process) {
    return
  }
  $rootProcess = Get-Process -Id $Process.Id -ErrorAction SilentlyContinue
  if ($null -ne $rootProcess) {
    & taskkill.exe /PID $Process.Id /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw 'INSTALLER_UPGRADE_PROCESS_TREE_STOP_FAILED'
    }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while (@(Get-Process -Name 'Eky' -ErrorAction SilentlyContinue).Count -ne 0) {
    if ([DateTime]::UtcNow -ge $deadline) {
      throw 'INSTALLER_UPGRADE_PROCESS_TREE_REMAINS'
    }
    Start-Sleep -Milliseconds 100
  }
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
  if ($fixture.fixtureFormatVersion -ne 2) {
    throw 'INSTALLER_UPGRADE_FIXTURE_FORMAT_INVALID'
  }
  if ($fixture.payloadRoot -ne $payloadRoot) {
    throw 'INSTALLER_UPGRADE_FIXTURE_PAYLOAD_ROOT_INVALID'
  }
  if ([version]$fixture.next.msiProductVersion -le [version]$fixture.current.msiProductVersion) {
    throw 'INSTALLER_UPGRADE_FIXTURE_VERSION_ORDER_INVALID'
  }

  if (
    $fixture.current.source -ne 'release' -or
    $fixture.next.source -ne 'synthetic-upgrade' -or
    $fixture.rollback.source -ne 'synthetic-rollback'
  ) {
    throw 'INSTALLER_UPGRADE_FIXTURE_SOURCE_INVALID'
  }
  $expectedCurrentMsiPath = Join-Path $artifactsRoot `
    "Eky-$($fixture.current.appVersion)-x64.msi"
  if (
    $fixture.current.packageSha256 -notmatch '^[0-9a-f]{64}$' -or
    ![System.IO.Path]::GetFullPath($fixture.current.msiPath).Equals(
      [System.IO.Path]::GetFullPath($expectedCurrentMsiPath),
      [System.StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw 'INSTALLER_UPGRADE_RELEASE_IDENTITY_INVALID'
  }
  $currentMsiPath = Resolve-FixtureMsi -Path $fixture.current.msiPath -Role 'current'
  $nextMsiPath = Resolve-FixtureMsi -Path $fixture.next.msiPath -Role 'next'
  $rollbackMsiPath = Resolve-FixtureMsi -Path $fixture.rollback.msiPath -Role 'rollback'
  if (
    (Get-EkyFileSha256 -Path $currentMsiPath).ToLowerInvariant() -ne
    $fixture.current.packageSha256
  ) {
    throw 'INSTALLER_UPGRADE_RELEASE_BYTES_CHANGED'
  }
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
  Assert-EkyInstallerRegistrationAbsent -ProductCodes @(
    $currentProductCode,
    $nextProductCode
  )

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
  Assert-EkyInstallerRegistrationPresent -ProductCode $currentProductCode

  $runningEkyProcess = Start-EkyForUpgrade
  $runningUpgradeExitCode = Invoke-EkyUpgradeAttempt -MsiPath $nextMsiPath `
    -LogName 'upgrade-next-running.log'
  if ($runningUpgradeExitCode -eq 0) {
    $runningUpgradeResult = 'succeeded'
    Assert-ProductAbsent -ProductCode $currentProductCode
    Assert-ProductInstalled -ProductCode $nextProductCode
    Assert-EkyInstalledPayload -InstallRoot $installRoot `
      -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
    Assert-EkyInstallerRegistrationPresent -ProductCode $nextProductCode
  }
  elseif ($runningUpgradeExitCode -in @(1641, 3010)) {
    throw 'INSTALLER_UPGRADE_RESTART_REQUIRED_FORBIDDEN'
  }
  else {
    $runningUpgradeResult = 'blocked-cleanly'
    Assert-ProductInstalled -ProductCode $currentProductCode
    Assert-ProductAbsent -ProductCode $nextProductCode
    Assert-EkyInstalledPayload -InstallRoot $installRoot `
      -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
    Assert-EkyInstallerRegistrationPresent -ProductCode $currentProductCode
  }
  Stop-EkyProcessTree -Process $runningEkyProcess
  $runningEkyProcess = $null
  if ($runningUpgradeResult -eq 'blocked-cleanly') {
    Install-EkyMsi -MsiPath $nextMsiPath -LogName 'upgrade-next-after-stop.log'
  }
  Assert-ProductAbsent -ProductCode $currentProductCode
  Assert-ProductInstalled -ProductCode $nextProductCode
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
  Assert-EkyInstallerRegistrationPresent -ProductCode $nextProductCode
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

  $invalidRollbackMsiPath = Join-Path $logRoot 'invalid-rollback.msi'
  Set-Content -LiteralPath $invalidRollbackMsiPath `
    -Value 'synthetic invalid rollback package' -Encoding ASCII -NoNewline
  $failedRollbackExitCode = Invoke-EkyCoordinatedRollback `
    -FailedProductCode $nextProductCode -FailedPackagePath $nextMsiPath `
    -RollbackPackagePath $invalidRollbackMsiPath
  if ($failedRollbackExitCode -ne 21) {
    throw "INSTALLER_UPGRADE_ROLLBACK_REPAIR_RESULT_INVALID:$failedRollbackExitCode"
  }
  Assert-ProductAbsent -ProductCode $currentProductCode
  Assert-ProductInstalled -ProductCode $nextProductCode
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
  Assert-EkyInstallerRegistrationPresent -ProductCode $nextProductCode
  Assert-BusinessDataUnchanged

  $rollbackExitCode = Invoke-EkyCoordinatedRollback `
    -FailedProductCode $nextProductCode -FailedPackagePath $nextMsiPath `
    -RollbackPackagePath $currentMsiPath
  if ($rollbackExitCode -ne 0) {
    throw 'INSTALLER_UPGRADE_COORDINATED_ROLLBACK_FAILED'
  }
  Assert-ProductInstalled -ProductCode $currentProductCode
  Assert-ProductAbsent -ProductCode $nextProductCode
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
  Assert-EkyInstallerRegistrationPresent -ProductCode $currentProductCode
  Assert-BusinessDataUnchanged

  Uninstall-EkyProduct -ProductCode $currentProductCode `
    -LogName 'uninstall-after-coordinated-rollback.log'
  Assert-ProductAbsent -ProductCode $currentProductCode
  Assert-EkyPathEventuallyAbsent -Path $installRoot `
    -Code 'INSTALLER_UPGRADE_UNINSTALL_ROOT_REMAINS'
  Assert-EkyInstallerRegistrationAbsent -ProductCodes @(
    $currentProductCode,
    $nextProductCode
  )

  New-Item -ItemType Directory -Path $unicodeSourceRoot | Out-Null
  Copy-Item -LiteralPath $currentMsiPath -Destination $unicodeMsiPath
  Install-EkyMsi -MsiPath $unicodeMsiPath -LogName 'install-unicode.log'
  Assert-ProductInstalled -ProductCode $currentProductCode
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
  Assert-EkyInstallerRegistrationPresent -ProductCode $currentProductCode
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
  Assert-EkyInstallerRegistrationPresent -ProductCode $currentProductCode
  Assert-BusinessDataUnchanged

  Uninstall-EkyProduct -ProductCode $currentProductCode -LogName 'uninstall-current.log'
  Assert-ProductAbsent -ProductCode $currentProductCode
  Assert-EkyPathEventuallyAbsent -Path $installRoot `
    -Code 'INSTALLER_UPGRADE_FINAL_ROOT_REMAINS'
  Assert-EkyPathEventuallyAbsent -Path $shortcutPath `
    -Code 'INSTALLER_UPGRADE_FINAL_SHORTCUT_REMAINS'
  Assert-EkyInstallerRegistrationAbsent -ProductCodes @(
    $currentProductCode,
    $nextProductCode
  )
  Assert-BusinessDataUnchanged

  $completed = $true
  [ordered]@{
    businessDataPreserved = $true
    coordinatedRollback = $true
    coordinatedRollbackRepairFallback = $true
    downgradeBlocked = $true
    majorUpgrade = $true
    payloadFileCount = $payloadInventory.Count
    rollbackRestoredPreviousVersion = $true
    runningProcessUpgrade = $runningUpgradeResult
    unicodeAndSpaceSourcePath = $true
  } | ConvertTo-Json -Compress
}
finally {
  if ($null -ne $runningEkyProcess) {
    try {
      Stop-EkyProcessTree -Process $runningEkyProcess
    }
    catch {
      Write-Warning 'Installer upgrade process-tree cleanup failed.'
    }
  }
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

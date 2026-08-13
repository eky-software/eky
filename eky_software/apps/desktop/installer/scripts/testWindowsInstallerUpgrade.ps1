Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerTestSupport.ps1')
. (Join-Path $PSScriptRoot 'installerUpgradeProcessTreeTestSupport.ps1')
. (Join-Path $PSScriptRoot 'installerUpgradeOutcomeTestSupport.ps1')
. (Join-Path $PSScriptRoot 'installerUpgradeProgress.ps1')

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
$runningEkyProcessTree = $null
$progress = New-EkyInstallerUpgradeProgressObserver

function Invoke-EkyObservedUpgradePhase {
  param(
    [Parameter(Mandatory = $true)][string]$Phase,
    [Parameter(Mandatory = $true)][scriptblock]$Operation
  )

  return Invoke-EkyInstallerUpgradeProgressPhase -Observer $progress `
    -Phase $Phase -Operation $Operation
}

function Write-EkyUpgradeHeartbeat {
  Write-EkyInstallerUpgradeHeartbeat -Observer $progress
}

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

  $process = Start-EkyTrackedInstallerProcess -FilePath 'msiexec.exe' `
    -ArgumentList @(
    '/i',
    "`"$MsiPath`"",
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot $LogName)`""
  )
  return Wait-EkyInstallerProcessExitCode -Process $process -OnWait {
      Write-EkyUpgradeHeartbeat
    }
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
  $process = Start-EkyTrackedInstallerProcess -FilePath 'powershell.exe' `
    -ArgumentList @(
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
  )
  return Wait-EkyInstallerProcessExitCode -Process $process -OnWait {
      Write-EkyUpgradeHeartbeat
    }
}

function Start-EkyForUpgrade {
  $executablePath = Join-Path $installRoot 'Eky.exe'
  $testUserDataRoot = Join-Path $logRoot 'running-upgrade-user-data'
  New-Item -ItemType Directory -Path $testUserDataRoot | Out-Null
  $process = Start-Process -FilePath $executablePath -ArgumentList @(
    "--user-data-dir=`"$testUserDataRoot`""
  ) -PassThru
  $rootIdentity = $null
  $identityDeadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    if ($process.HasExited) {
      throw 'INSTALLER_UPGRADE_EKY_PROCESS_EXITED_EARLY'
    }
    $rootIdentity = Get-EkyInstallerProcessIdentityById `
      -ProcessId $process.Id
    if ($null -ne $rootIdentity) {
      break
    }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $identityDeadline)
  if ($null -eq $rootIdentity) {
    throw 'INSTALLER_UPGRADE_PROCESS_IDENTITY_INVALID'
  }

  $trackedIdentities = @($rootIdentity)
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $rootRecord = @(
      $processes | Where-Object { [int]$_.ProcessId -eq $process.Id }
    ) | Select-Object -First 1
    if ($null -eq $rootRecord) {
      throw 'INSTALLER_UPGRADE_EKY_PROCESS_EXITED_EARLY'
    }
    $currentRootIdentity = ConvertTo-EkyInstallerProcessIdentity `
      -ProcessRecord $rootRecord
    if (!(Test-EkyInstallerProcessIdentityEqual `
      -Left $rootIdentity -Right $currentRootIdentity)) {
      throw 'INSTALLER_UPGRADE_EKY_PROCESS_EXITED_EARLY'
    }
    $ownedIdentities = @(Select-EkyInstallerOwnedProcessTree `
      -RootIdentity $rootIdentity -SeedIdentities $trackedIdentities `
      -ProcessRecords $processes)
    $trackedIdentities = $ownedIdentities
    $ownedIds = @($ownedIdentities | ForEach-Object { $_.ProcessId })
    $foundUtilityProcess = @(
      $processes | Where-Object {
        $ownedIds -contains [int]$_.ProcessId -and
        $_.Name -eq 'Eky.exe' -and
        $_.CommandLine -match '--type=utility'
      }
    ).Count -gt 0
    if ($foundUtilityProcess) {
      return [pscustomobject]@{
        RootIdentity = $rootIdentity
        TrackedIdentities = $ownedIdentities
      }
    }
    Write-EkyUpgradeHeartbeat
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'INSTALLER_UPGRADE_BACKEND_UTILITY_PROCESS_MISSING'
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
  Invoke-EkyMsiExec -Operation 'upgrade_install' -Arguments $arguments `
    -OnWait { Write-EkyUpgradeHeartbeat } | Out-Null
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
  ) -OnWait { Write-EkyUpgradeHeartbeat } | Out-Null
}

function Assert-BusinessDataUnchanged {
  Assert-EkyInventoryEqual (Get-EkyDirectoryInventory -Root $businessDataRoot) `
    $businessDataInventoryBefore 'INSTALLER_UPGRADE_BUSINESS_DATA_CHANGED'
}

function Test-EkyUpgradeAssertion {
  param([Parameter(Mandatory = $true)][scriptblock]$Operation)

  try {
    & $Operation
    return $true
  }
  catch {
    return $false
  }
}

function Get-EkyRunningUpgradeState {
  $currentInstalled = (
    (Get-EkyProductState -Installer $installer -Code $currentProductCode) -ge 1
  )
  $candidateInstalled = (
    (Get-EkyProductState -Installer $installer -Code $nextProductCode) -ge 1
  )
  $payloadMatches = Test-EkyUpgradeAssertion {
    Assert-EkyInventoryEqual (
      Get-EkyDirectoryInventory -Root $installRoot
    ) $payloadInventory 'INSTALLER_UPGRADE_PAYLOAD_STATE_INVALID'
  }
  $currentRegistrationMatches = Test-EkyUpgradeAssertion {
    Assert-EkyInstallerRegistrationPresent -ProductCode $currentProductCode
  }
  $candidateRegistrationMatches = Test-EkyUpgradeAssertion {
    Assert-EkyInstallerRegistrationPresent -ProductCode $nextProductCode
  }
  $businessDataUnchanged = Test-EkyUpgradeAssertion {
    Assert-BusinessDataUnchanged
  }
  return [pscustomobject]@{
    BusinessDataUnchanged = $businessDataUnchanged
    CandidatePayloadMatches = $candidateInstalled -and $payloadMatches
    CandidateProductInstalled = $candidateInstalled
    CandidateRegistrationMatches = $candidateRegistrationMatches
    CandidateRegistrationPresent = $candidateRegistrationMatches
    CurrentPayloadMatches = $currentInstalled -and $payloadMatches
    CurrentProductInstalled = $currentInstalled
    CurrentRegistrationMatches = $currentRegistrationMatches
    CurrentRegistrationPresent = $currentRegistrationMatches
    ShortcutPresent = Test-Path -LiteralPath $shortcutPath -PathType Leaf
  }
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

  Invoke-EkyObservedUpgradePhase -Phase 'fixtureValidated' `
    -Operation { $true } | Out-Null
  Invoke-EkyObservedUpgradePhase -Phase 'currentInstallStarted' -Operation {
    Install-EkyMsi -MsiPath $currentMsiPath -LogName 'install-current.log'
  } | Out-Null
  Invoke-EkyObservedUpgradePhase -Phase 'currentInstallCompleted' -Operation {
    Assert-ProductInstalled -ProductCode $currentProductCode
    Assert-EkyInstalledPayload -InstallRoot $installRoot `
      -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
    Assert-EkyInstallerRegistrationPresent -ProductCode $currentProductCode
  } | Out-Null

  $runningEkyProcessTree = Invoke-EkyObservedUpgradePhase `
    -Phase 'runningApplicationStarted' -Operation { Start-EkyForUpgrade }
  Invoke-EkyObservedUpgradePhase -Phase 'utilityProcessObserved' -Operation {
    if (@($runningEkyProcessTree.TrackedIdentities).Count -lt 2) {
      throw 'INSTALLER_UPGRADE_BACKEND_UTILITY_PROCESS_MISSING'
    }
  } | Out-Null
  $runningUpgradeExitCode = Invoke-EkyObservedUpgradePhase `
    -Phase 'runningUpgradeStarted' -Operation {
      Invoke-EkyUpgradeAttempt -MsiPath $nextMsiPath `
        -LogName 'upgrade-next-running.log'
    }
  $runningUpgradeResult = Invoke-EkyObservedUpgradePhase `
    -Phase 'runningUpgradeCompleted' -Operation {
      Resolve-EkyRunningUpgradeOutcome -ExitCode $runningUpgradeExitCode `
        -State (Get-EkyRunningUpgradeState)
    }
  Invoke-EkyObservedUpgradePhase -Phase 'processTreeCleanupStarted' `
    -Operation { $true } | Out-Null
  Invoke-EkyObservedUpgradePhase -Phase 'processTreeCleanupCompleted' `
    -Operation {
      Stop-EkyInstallerOwnedProcessTree -ProcessTree $runningEkyProcessTree `
        -WriteSummary {
          param($Summary)
          Write-EkyInstallerUpgradeProcessCleanupSummary `
            -Observer $progress -Summary $Summary
        }
    } | Out-Null
  $runningEkyProcessTree = $null

  Invoke-EkyObservedUpgradePhase -Phase 'nextVersionVerified' -Operation {
    if ($runningUpgradeResult -eq 'blocked-cleanly') {
      Install-EkyMsi -MsiPath $nextMsiPath `
        -LogName 'upgrade-next-after-stop.log'
    }
    Assert-ProductAbsent -ProductCode $currentProductCode
    Assert-ProductInstalled -ProductCode $nextProductCode
    Assert-EkyInstalledPayload -InstallRoot $installRoot `
      -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
    Assert-EkyInstallerRegistrationPresent -ProductCode $nextProductCode
    Assert-BusinessDataUnchanged
  } | Out-Null

  Invoke-EkyObservedUpgradePhase -Phase 'downgradeVerificationStarted' `
    -Operation {
      Invoke-EkyMsiExecExpectedFailure -Operation 'downgrade' -Arguments @(
        '/i',
        "`"$currentMsiPath`"",
        '/qn',
        '/norestart',
        '/l*v',
        "`"$(Join-Path $logRoot 'downgrade.log')`""
      ) -OnWait { Write-EkyUpgradeHeartbeat } | Out-Null
    } | Out-Null
  Invoke-EkyObservedUpgradePhase -Phase 'downgradeVerificationCompleted' `
    -Operation {
      Assert-ProductAbsent -ProductCode $currentProductCode
      Assert-ProductInstalled -ProductCode $nextProductCode
      Assert-EkyInstalledPayload -InstallRoot $installRoot `
        -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
      Assert-BusinessDataUnchanged
    } | Out-Null

  $failedRollbackBlocker = Join-Path $installRoot `
    'resources\desktop-runtime\installer-rollback-probe'
  Invoke-EkyObservedUpgradePhase -Phase 'rollbackFailureProbePrepared' `
    -Operation {
      Set-Content -LiteralPath $failedRollbackBlocker `
        -Value 'synthetic rollback blocker' -Encoding ASCII -NoNewline
    } | Out-Null
  try {
    $failedRollbackExitCode = Invoke-EkyObservedUpgradePhase `
      -Phase 'rollbackFailureAttempted' -Operation {
        Invoke-EkyCoordinatedRollback `
          -FailedProductCode $nextProductCode `
          -FailedPackagePath $nextMsiPath `
          -RollbackPackagePath $rollbackMsiPath
      }
    Invoke-EkyObservedUpgradePhase -Phase 'rollbackFailureResultVerified' `
      -Operation {
        if ($failedRollbackExitCode -ne 21) {
          throw 'INSTALLER_UPGRADE_ROLLBACK_REPAIR_RESULT_INVALID'
        }
      } | Out-Null
  }
  finally {
    if (Test-Path -LiteralPath $failedRollbackBlocker) {
      Remove-Item -LiteralPath $failedRollbackBlocker -Force
    }
  }
  Invoke-EkyObservedUpgradePhase -Phase 'rollbackFailureStateVerified' `
    -Operation {
      Assert-ProductAbsent -ProductCode $currentProductCode
      Assert-ProductInstalled -ProductCode $nextProductCode
      Assert-EkyInstalledPayload -InstallRoot $installRoot `
        -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
      Assert-EkyInstallerRegistrationPresent -ProductCode $nextProductCode
      Assert-BusinessDataUnchanged
    } | Out-Null

  $rollbackExitCode = Invoke-EkyObservedUpgradePhase `
    -Phase 'coordinatedRollbackAttempted' -Operation {
      Invoke-EkyCoordinatedRollback `
        -FailedProductCode $nextProductCode `
        -FailedPackagePath $nextMsiPath `
        -RollbackPackagePath $currentMsiPath
    }
  Invoke-EkyObservedUpgradePhase -Phase 'coordinatedRollbackResultVerified' `
    -Operation {
      if ($rollbackExitCode -ne 0) {
        throw 'INSTALLER_UPGRADE_COORDINATED_ROLLBACK_FAILED'
      }
    } | Out-Null
  Invoke-EkyObservedUpgradePhase -Phase 'coordinatedRollbackStateVerified' `
    -Operation {
      Assert-ProductInstalled -ProductCode $currentProductCode
      Assert-ProductAbsent -ProductCode $nextProductCode
      Assert-EkyInstalledPayload -InstallRoot $installRoot `
        -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
      Assert-EkyInstallerRegistrationPresent -ProductCode $currentProductCode
      Assert-BusinessDataUnchanged
    } | Out-Null
  Invoke-EkyObservedUpgradePhase -Phase 'postRollbackUninstallCompleted' `
    -Operation {
      Uninstall-EkyProduct -ProductCode $currentProductCode `
        -LogName 'uninstall-after-coordinated-rollback.log'
      Assert-ProductAbsent -ProductCode $currentProductCode
      Assert-EkyPathEventuallyAbsent -Path $installRoot `
        -Code 'INSTALLER_UPGRADE_UNINSTALL_ROOT_REMAINS'
      Assert-EkyInstallerRegistrationAbsent -ProductCodes @(
        $currentProductCode,
        $nextProductCode
      )
    } | Out-Null

  Invoke-EkyObservedUpgradePhase -Phase 'unicodePathVerificationCompleted' `
    -Operation {
      New-Item -ItemType Directory -Path $unicodeSourceRoot | Out-Null
      Copy-Item -LiteralPath $currentMsiPath -Destination $unicodeMsiPath
      try {
        Install-EkyMsi -MsiPath $unicodeMsiPath -LogName 'install-unicode.log'
        Assert-ProductInstalled -ProductCode $currentProductCode
        Assert-EkyInstalledPayload -InstallRoot $installRoot `
          -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
        Assert-EkyInstallerRegistrationPresent `
          -ProductCode $currentProductCode
        Uninstall-EkyProduct -ProductCode $currentProductCode `
          -LogName 'uninstall-unicode.log'
        Assert-ProductAbsent -ProductCode $currentProductCode
        Assert-EkyPathEventuallyAbsent -Path $installRoot `
          -Code 'INSTALLER_UPGRADE_UNICODE_INSTALL_ROOT_REMAINS'
      }
      finally {
        if (Test-Path -LiteralPath $unicodeSourceRoot) {
          Remove-Item -LiteralPath $unicodeSourceRoot -Force -Recurse
        }
      }
      Assert-BusinessDataUnchanged
    } | Out-Null

  Invoke-EkyObservedUpgradePhase -Phase 'transactionRollbackStarted' `
    -Operation {
      Install-EkyMsi -MsiPath $currentMsiPath `
        -LogName 'install-before-rollback.log'
      $rollbackBlocker = Join-Path $installRoot `
        'resources\desktop-runtime\installer-rollback-probe'
      Set-Content -LiteralPath $rollbackBlocker `
        -Value 'synthetic filesystem blocker' -Encoding ASCII -NoNewline
      try {
        Invoke-EkyMsiExecExpectedFailure -Operation 'rollback_probe' `
          -Arguments @(
            '/i',
            "`"$rollbackMsiPath`"",
            '/qn',
            '/norestart',
            '/l*v',
            "`"$(Join-Path $logRoot 'rollback-probe.log')`""
          ) -OnWait { Write-EkyUpgradeHeartbeat } | Out-Null
      }
      finally {
        if (Test-Path -LiteralPath $rollbackBlocker) {
          Remove-Item -LiteralPath $rollbackBlocker -Force
        }
      }
    } | Out-Null

  Invoke-EkyObservedUpgradePhase -Phase 'transactionRollbackCompleted' `
    -Operation {
      Assert-ProductInstalled -ProductCode $currentProductCode
      Assert-ProductAbsent -ProductCode $nextProductCode
      Assert-EkyInstalledPayload -InstallRoot $installRoot `
        -PayloadInventory $payloadInventory -ShortcutPath $shortcutPath
      Assert-EkyInstallerRegistrationPresent -ProductCode $currentProductCode
      Assert-BusinessDataUnchanged

      Uninstall-EkyProduct -ProductCode $currentProductCode `
        -LogName 'uninstall-current.log'
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
    } | Out-Null

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
  try {
    Invoke-EkyObservedUpgradePhase -Phase 'finalCleanupStarted' `
      -Operation { $true } | Out-Null
  }
  catch {
    Write-Warning 'Installer upgrade final cleanup progress failed.'
  }
  try {
    Invoke-EkyObservedUpgradePhase -Phase 'finalCleanupCompleted' -Operation {
      if ($null -ne $runningEkyProcessTree) {
        try {
          Stop-EkyInstallerOwnedProcessTree `
            -ProcessTree $runningEkyProcessTree -WriteSummary {
              param($Summary)
              Write-EkyInstallerUpgradeProcessCleanupSummary `
                -Observer $progress -Summary $Summary
            } | Out-Null
        }
        catch {
          Write-Warning 'Installer upgrade process-tree cleanup failed.'
        }
      }
      foreach ($productCode in @($nextProductCode, $currentProductCode)) {
        if (
          $null -eq $productCode -or
          (Get-EkyProductState -Installer $installer -Code $productCode) -lt 1
        ) {
          continue
        }
        try {
          Invoke-EkyMsiExec -Operation 'upgrade_cleanup' -Arguments @(
            '/x',
            $productCode,
            '/qn',
            '/norestart',
            '/l*v',
            "`"$(Join-Path $logRoot "cleanup-$($productCode.Trim('{}')).log")`""
          ) -OnWait { Write-EkyUpgradeHeartbeat } | Out-Null
        }
        catch {
          Write-Warning 'Installer upgrade cleanup failed; inspect the private test log directory.'
        }
      }
    } | Out-Null
  }
  catch {
    Write-Warning 'Installer upgrade final cleanup failed.'
  }
  if ($null -ne $installer) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
  }
  if ($completed) {
    foreach ($path in @($logRoot)) {
      if (Test-Path -LiteralPath $path) {
        try {
          Remove-Item -LiteralPath $path -Force -Recurse
        }
        catch {
          Write-Warning 'Installer upgrade private log cleanup failed.'
        }
      }
    }
  }
}

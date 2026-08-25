param(
  [Parameter(Mandatory = $true)][string]$TemporaryRoot,
  [Parameter(Mandatory = $true)][string]$ProofToken,
  [Parameter(Mandatory = $true)][string]$SourceMsiPath,
  [Parameter(Mandatory = $true)][string]$TargetMsiPath,
  [Parameter(Mandatory = $true)][string]$SourcePayloadRoot,
  [Parameter(Mandatory = $true)][string]$TargetPayloadRoot,
  [Parameter(Mandatory = $true)][string]$SourceProductCode,
  [Parameter(Mandatory = $true)][string]$TargetProductCode,
  [Parameter(Mandatory = $true)][string]$SourcePackageSha256,
  [Parameter(Mandatory = $true)][string]$TargetPackageSha256,
  [Parameter(Mandatory = $true)][string]$BuildRevision,
  [Parameter(Mandatory = $true)][string]$ElectronPath,
  [Parameter(Mandatory = $true)][string]$ProfileApplicationPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerTestSupport.ps1')
. (Join-Path $PSScriptRoot 'w6b2Success\progress.ps1')
. (Join-Path $PSScriptRoot 'w6b2Success\evidence.ps1')
. (Join-Path $PSScriptRoot 'w6b2Success\applicationProcess.ps1')
. (Join-Path $PSScriptRoot 'w6b2Success\installerLifecycle.ps1')

$installer = $null
$sourceCode = $null
$targetCode = $null
$proofRoot = $null
$sourceMsi = $null
$targetMsi = $null
$sourcePayload = $null
$targetPayload = $null
$sourcePayloadInventory = $null
$targetPayloadInventory = $null
$normalProfileInventory = $null
$normalProfileExisted = $null
$sourceObservation = $null
$ownedObservations = [Collections.Generic.List[object]]::new()
$sourceCleanupAuthorized = $false
$targetCleanupAuthorized = $false
$scenarioSucceeded = $false
$cleanupFailed = $false
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Eky'
$applicationPath = Join-Path $installRoot 'Eky.exe'
$shortcutPath = Join-Path $env:APPDATA `
  'Microsoft\Windows\Start Menu\Programs\Eky\Eky.lnk'
$normalProfileRoot = Join-Path $env:APPDATA 'Eky'

Start-W6b2SuccessScenario

try {
  Start-W6b2SuccessStage -Stage preflight
  if ($BuildRevision -cnotmatch '^[0-9a-f]{40}$') {
    throw 'W6B2_SUCCESS_BUILD_REVISION_INVALID'
  }
  $proofRoot = Resolve-W6b2SuccessProofRoot `
    -TemporaryRoot $TemporaryRoot -ProofToken $ProofToken
  $sourceMsi = Resolve-W6b2SuccessRegularFile -Path $SourceMsiPath `
    -Extension '.msi' -ContainedBy (Join-Path $proofRoot 'packages\source')
  $targetMsi = Resolve-W6b2SuccessRegularFile -Path $TargetMsiPath `
    -Extension '.msi' -ContainedBy (Join-Path $proofRoot 'packages\target')
  $sourcePayload = Assert-W6b2SuccessCanonicalDirectory `
    -Path $SourcePayloadRoot
  $targetPayload = Assert-W6b2SuccessCanonicalDirectory `
    -Path $TargetPayloadRoot
  $resolvedElectron = Resolve-W6b2SuccessRegularFile `
    -Path $ElectronPath -Extension '.exe'
  $resolvedProfileApplication = Assert-W6b2SuccessCanonicalDirectory `
    -Path $ProfileApplicationPath
  Assert-W6b2SuccessPackageHash -Path $sourceMsi `
    -ExpectedSha256 $SourcePackageSha256
  Assert-W6b2SuccessPackageHash -Path $targetMsi `
    -ExpectedSha256 $TargetPackageSha256
  $sourceCode = Normalize-W6b2SuccessProductCode -Code $SourceProductCode
  $targetCode = Normalize-W6b2SuccessProductCode -Code $TargetProductCode
  if ($sourceCode -ceq $targetCode) {
    throw 'W6B2_SUCCESS_PRODUCT_CODES_NOT_DISTINCT'
  }
  Assert-W6b2SuccessNoApplicationOrMsiProcesses
  if (
    (Test-Path -LiteralPath $installRoot) -or
    (Test-Path -LiteralPath $shortcutPath)
  ) {
    throw 'W6B2_SUCCESS_EXISTING_INSTALLATION_FORBIDDEN'
  }
  $installer = New-Object -ComObject WindowsInstaller.Installer
  Assert-W6b2SuccessProductAbsent -Installer $installer `
    -ProductCode $sourceCode
  Assert-W6b2SuccessProductAbsent -Installer $installer `
    -ProductCode $targetCode
  Assert-EkyInstallerRegistrationAbsent -ProductCodes @(
    $sourceCode,
    $targetCode
  )
  $sourcePayloadInventory = Get-W6b2SuccessDirectoryInventory `
    -Root $sourcePayload
  $targetPayloadInventory = Get-W6b2SuccessDirectoryInventory `
    -Root $targetPayload
  if ($sourcePayloadInventory.Count -lt 1 -or $targetPayloadInventory.Count -lt 1) {
    throw 'W6B2_SUCCESS_PAYLOAD_INVALID'
  }
  if (
    (Test-Path -LiteralPath $normalProfileRoot) -and
    !(Test-Path -LiteralPath $normalProfileRoot -PathType Container)
  ) {
    throw 'W6B2_SUCCESS_NORMAL_PROFILE_INVALID'
  }
  $normalProfileExisted = Test-Path -LiteralPath $normalProfileRoot `
    -PathType Container
  $normalProfileInventory = Get-W6b2SuccessDirectoryInventory `
    -Root $normalProfileRoot
  [void](New-Item -ItemType Directory -Path (Join-Path $proofRoot 'private-logs') `
    -Force)
  Complete-W6b2SuccessStage -ResultCode preflightCompleted

  Start-W6b2SuccessStage -Stage sourceInstall
  $sourceCleanupAuthorized = $true
  Install-W6b2SuccessSourcePackage -MsiPath $sourceMsi `
    -LogPath (Join-Path $proofRoot 'private-logs\source-install.log')
  Assert-W6b2SuccessProductInstalled -Installer $installer `
    -ProductCode $sourceCode
  Assert-W6b2SuccessProductAbsent -Installer $installer `
    -ProductCode $targetCode
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $sourcePayloadInventory -ShortcutPath $shortcutPath
  Assert-EkyInstallerRegistrationPresent -ProductCode $sourceCode
  Complete-W6b2SuccessStage -ResultCode sourceInstalled

  Start-W6b2SuccessStage -Stage profilePreparation
  Invoke-W6b2SuccessProfileOperation -ElectronPath $resolvedElectron `
    -ProfileApplicationPath $resolvedProfileApplication `
    -ProofToken $ProofToken -ProofRoot $proofRoot -Operation prepare
  Complete-W6b2SuccessStage -ResultCode profilePrepared

  Start-W6b2SuccessStage -Stage sourceHandoff
  Set-W6b2SuccessPhase -ProofRoot $proofRoot -Phase sourceHandoff
  $sourceRun = Invoke-W6b2SuccessApplicationPhase `
    -ExecutablePath $applicationPath -ProofToken $ProofToken `
    -ProofRoot $proofRoot -Phase sourceHandoff -ExpectedStatus completed `
    -AllowOwnedDescendantsAfterExit
  $sourceObservation = $sourceRun.observation
  $ownedObservations.Add($sourceObservation)
  Complete-W6b2SuccessStage -ResultCode handoffCompleted

  Start-W6b2SuccessStage -Stage targetInstall
  $targetCleanupAuthorized = $true
  Wait-W6b2SuccessTargetInstallation -Installer $installer `
    -SourceProductCode $sourceCode -TargetProductCode $targetCode
  Wait-W6b2SuccessOwnedProcessesAbsent -Observation $sourceObservation `
    -TimeoutMilliseconds 30000
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $targetPayloadInventory -ShortcutPath $shortcutPath
  Assert-EkyInstallerRegistrationPresent -ProductCode $targetCode
  Assert-W6b2SuccessPackageHash -Path $sourceMsi `
    -ExpectedSha256 $SourcePackageSha256
  Assert-W6b2SuccessPackageHash -Path $targetMsi `
    -ExpectedSha256 $TargetPackageSha256
  Complete-W6b2SuccessStage -ResultCode targetInstalled

  Start-W6b2SuccessStage -Stage targetFirstStart
  Set-W6b2SuccessPhase -ProofRoot $proofRoot -Phase targetFirstStart
  $targetFirst = Invoke-W6b2SuccessApplicationPhase `
    -ExecutablePath $applicationPath -ProofToken $ProofToken `
    -ProofRoot $proofRoot -Phase targetFirstStart -ExpectedStatus completed
  $ownedObservations.Add($targetFirst.observation)
  Invoke-W6b2SuccessProfileOperation -ElectronPath $resolvedElectron `
    -ProfileApplicationPath $resolvedProfileApplication `
    -ProofToken $ProofToken -ProofRoot $proofRoot -Operation targetFirstStart
  Complete-W6b2SuccessStage -ResultCode targetAccepted

  Start-W6b2SuccessStage -Stage switchToB
  Set-W6b2SuccessPhase -ProofRoot $proofRoot -Phase switchToB
  $switchB = Invoke-W6b2SuccessApplicationPhase `
    -ExecutablePath $applicationPath -ProofToken $ProofToken `
    -ProofRoot $proofRoot -Phase switchToB -ExpectedStatus relaunching
  $ownedObservations.Add($switchB.observation)
  Complete-W6b2SuccessStage -ResultCode workspaceBActive

  Start-W6b2SuccessStage -Stage verifyBRestart
  Set-W6b2SuccessPhase -ProofRoot $proofRoot -Phase verifyBRestart
  $verifyB = Invoke-W6b2SuccessApplicationPhase `
    -ExecutablePath $applicationPath -ProofToken $ProofToken `
    -ProofRoot $proofRoot -Phase verifyBRestart -ExpectedStatus completed
  $ownedObservations.Add($verifyB.observation)
  Invoke-W6b2SuccessProfileOperation -ElectronPath $resolvedElectron `
    -ProfileApplicationPath $resolvedProfileApplication `
    -ProofToken $ProofToken -ProofRoot $proofRoot -Operation verifyBRestart
  Complete-W6b2SuccessStage -ResultCode workspaceBActive

  Start-W6b2SuccessStage -Stage switchToA
  Set-W6b2SuccessPhase -ProofRoot $proofRoot -Phase switchToA
  $switchA = Invoke-W6b2SuccessApplicationPhase `
    -ExecutablePath $applicationPath -ProofToken $ProofToken `
    -ProofRoot $proofRoot -Phase switchToA -ExpectedStatus relaunching
  $ownedObservations.Add($switchA.observation)
  Complete-W6b2SuccessStage -ResultCode workspaceAActive

  Start-W6b2SuccessStage -Stage rejectC
  Set-W6b2SuccessPhase -ProofRoot $proofRoot -Phase rejectC
  $rejectC = Invoke-W6b2SuccessApplicationPhase `
    -ExecutablePath $applicationPath -ProofToken $ProofToken `
    -ProofRoot $proofRoot -Phase rejectC -ExpectedStatus completed
  $ownedObservations.Add($rejectC.observation)
  Invoke-W6b2SuccessProfileOperation -ElectronPath $resolvedElectron `
    -ProfileApplicationPath $resolvedProfileApplication `
    -ProofToken $ProofToken -ProofRoot $proofRoot -Operation rejectC
  Complete-W6b2SuccessStage -ResultCode recoveryRejected
  $scenarioSucceeded = $true
}
catch {
  Fail-W6b2SuccessStage
}
finally {
  try {
    if (!$script:W6b2SuccessCurrentStageTerminal) {
      Fail-W6b2SuccessStage
    }
    Start-W6b2SuccessStage -Stage cleanup
    foreach ($observation in $ownedObservations) {
      Stop-W6b2SuccessOwnedProcesses -Observation $observation
    }
    if ($null -ne $installer) {
      foreach ($entry in @(
        [pscustomobject]@{
          authorized = $targetCleanupAuthorized
          code = $targetCode
          log = 'target-uninstall.log'
        },
        [pscustomobject]@{
          authorized = $sourceCleanupAuthorized
          code = $sourceCode
          log = 'source-uninstall.log'
        }
      )) {
        if (
          $entry.authorized -and
          $null -ne $entry.code -and
          (Get-EkyProductState -Installer $installer -Code $entry.code) -ge 1
        ) {
          Uninstall-W6b2SuccessPackage -ProductCode $entry.code `
            -LogPath (Join-Path $proofRoot "private-logs\$($entry.log)")
        }
      }
      if ($null -ne $sourceCode) {
        Assert-W6b2SuccessProductAbsent -Installer $installer `
          -ProductCode $sourceCode
      }
      if ($null -ne $targetCode) {
        Assert-W6b2SuccessProductAbsent -Installer $installer `
          -ProductCode $targetCode
      }
    }
    Assert-EkyPathEventuallyAbsent -Path $installRoot `
      -Code W6B2_SUCCESS_INSTALL_ROOT_REMAINS -TimeoutMilliseconds 30000
    Assert-EkyPathEventuallyAbsent -Path $shortcutPath `
      -Code W6B2_SUCCESS_SHORTCUT_REMAINS -TimeoutMilliseconds 30000
    if ($null -ne $sourceCode -and $null -ne $targetCode) {
      Assert-EkyInstallerRegistrationAbsent -ProductCodes @(
        $sourceCode,
        $targetCode
      )
    }
    Assert-W6b2SuccessNoApplicationOrMsiProcesses
    if ($null -ne $normalProfileInventory) {
      $normalProfileExistsAfter = Test-Path -LiteralPath $normalProfileRoot `
        -PathType Container
      if ($normalProfileExistsAfter -ne $normalProfileExisted) {
        throw 'W6B2_SUCCESS_INVENTORY_CHANGED'
      }
      Assert-W6b2SuccessInventoryEqual `
        -Actual (Get-W6b2SuccessDirectoryInventory -Root $normalProfileRoot) `
        -Expected $normalProfileInventory
    }
    if ($null -ne $sourceMsi) {
      Assert-W6b2SuccessPackageHash -Path $sourceMsi `
        -ExpectedSha256 $SourcePackageSha256
    }
    if ($null -ne $targetMsi) {
      Assert-W6b2SuccessPackageHash -Path $targetMsi `
        -ExpectedSha256 $TargetPackageSha256
    }
    Complete-W6b2SuccessStage -ResultCode cleanupCompleted
  }
  catch {
    $cleanupFailed = $true
    Fail-W6b2SuccessStage
  }
  if ($null -ne $installer) {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
  }
}

if (!$scenarioSucceeded -or $cleanupFailed) {
  Fail-W6b2SuccessScenario
  exit 1
}
Complete-W6b2SuccessScenario
exit 0

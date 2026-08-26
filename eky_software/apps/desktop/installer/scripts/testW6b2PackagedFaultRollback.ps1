param(
  [Parameter(Mandatory = $true)][string]$TemporaryRoot,
  [Parameter(Mandatory = $true)][string]$ProofToken,
  [Parameter(Mandatory = $true)][string]$FaultScenario,
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
. (Join-Path $PSScriptRoot 'w6b2Success\evidence.ps1')
. (Join-Path $PSScriptRoot 'w6b2Fault\evidence.ps1')
. (Join-Path $PSScriptRoot 'w6b2Fault\progress.ps1')
. (Join-Path $PSScriptRoot 'w6b2Fault\rollbackProgress.ps1')
. (Join-Path $PSScriptRoot 'w6b2Success\applicationProcess.ps1')
. (Join-Path $PSScriptRoot 'w6b2Fault\applicationProcess.ps1')
. (Join-Path $PSScriptRoot 'w6b2Success\installerLifecycle.ps1')
. (Join-Path $PSScriptRoot 'w6b2Fault\scenarioOperations.ps1')

$installer = $null
$sourceCode = $null
$targetCode = $null
$proofRoot = $null
$sourceMsi = $null
$targetMsi = $null
$sourcePayloadInventory = $null
$targetPayloadInventory = $null
$normalProfileInventory = $null
$normalProfileExisted = $null
$sourceCleanupAuthorized = $false
$targetCleanupAuthorized = $false
$scenarioSucceeded = $false
$cleanupFailed = $false
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Eky'
$applicationPath = Join-Path $installRoot 'Eky.exe'
$shortcutPath = Join-Path $env:APPDATA `
  'Microsoft\Windows\Start Menu\Programs\Eky\Eky.lnk'
$normalProfileRoot = Join-Path $env:APPDATA 'Eky'
$context = $null

Start-W6b2FaultScenario -FaultScenario $FaultScenario

try {
  Start-W6b2FaultStage -Stage preflight
  Assert-W6b2FaultScenarioPhase `
    -FaultScenario $FaultScenario -Phase sourceHandoff
  if ($BuildRevision -cnotmatch '^[0-9a-f]{7,40}$') {
    throw 'W6B2_FAULT_CONTROL_INVALID'
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
    throw 'W6B2_FAULT_CONTROL_INVALID'
  }
  Assert-W6b2SuccessNoApplicationOrMsiProcesses
  if (
    (Test-Path -LiteralPath $installRoot) -or
    (Test-Path -LiteralPath $shortcutPath)
  ) {
    throw 'W6B2_FAULT_STATE_INVALID'
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
    throw 'W6B2_FAULT_STATE_INVALID'
  }
  if (
    (Test-Path -LiteralPath $normalProfileRoot) -and
    !(Test-Path -LiteralPath $normalProfileRoot -PathType Container)
  ) {
    throw 'W6B2_FAULT_STATE_INVALID'
  }
  $normalProfileExisted = Test-Path -LiteralPath $normalProfileRoot `
    -PathType Container
  $normalProfileInventory = Get-W6b2SuccessDirectoryInventory `
    -Root $normalProfileRoot
  [void](New-Item -ItemType Directory `
    -Path (Join-Path $proofRoot 'private-logs') -Force)
  Complete-W6b2FaultStage -ResultCode preflightValidated

  Start-W6b2FaultStage -Stage sourceInstall
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
  Complete-W6b2FaultStage -ResultCode sourceInstalled

  Start-W6b2FaultStage -Stage profilePreparation
  Set-W6b2SuccessPhase -ProofRoot $proofRoot -Phase sourceHandoff
  Invoke-W6b2SuccessProfileOperation -ElectronPath $resolvedElectron `
    -ProfileApplicationPath $resolvedProfileApplication `
    -ProofToken $ProofToken -ProofRoot $proofRoot -Operation prepare
  Set-W6b2FaultPhase -ProofRoot $proofRoot `
    -FaultScenario $FaultScenario -Phase sourceHandoff
  Complete-W6b2FaultStage -ResultCode profilePrepared

  $context = [pscustomobject]@{
    ApplicationPath = $applicationPath
    ElectronPath = $resolvedElectron
    FaultScenario = $FaultScenario
    HandoffObservation = $null
    HandoffProcess = $null
    InstallRoot = $installRoot
    Installer = $installer
    OwnedObservations = [Collections.Generic.List[object]]::new()
    ProfileApplicationPath = $resolvedProfileApplication
    ProofRoot = $proofRoot
    ProofToken = $ProofToken
    RollbackProgressPath = Resolve-W6b2FaultRollbackProgressPath `
      -ProofRoot $proofRoot
    RollbackProgressReportedCount = 0
    ShortcutPath = $shortcutPath
    SourceCode = $sourceCode
    SourceMsi = $sourceMsi
    SourcePackageSha256 = $SourcePackageSha256
    SourcePayloadInventory = $sourcePayloadInventory
    TargetCleanupAuthorized = $false
    TargetCode = $targetCode
    TargetMsi = $targetMsi
    TargetPackageSha256 = $TargetPackageSha256
    TargetPayloadInventory = $targetPayloadInventory
  }
  Invoke-W6b2FaultScenarioFlow -Context $context
  $targetCleanupAuthorized = $context.TargetCleanupAuthorized
  $scenarioSucceeded = $true
}
catch {
  Fail-W6b2FaultStage -ErrorRecord $_
}
finally {
  try {
    if (!$script:W6b2FaultCurrentStageTerminal) {
      Fail-W6b2FaultStage
    }
    Start-W6b2FaultStage -Stage cleanup
    Write-W6b2FaultObservation -ResultCode cleanupOwnedProcessesStarted
    if ($null -ne $context) {
      foreach ($observation in $context.OwnedObservations) {
        Stop-W6b2SuccessRecordedOwnedProcesses -Observation $observation
      }
    }
    Write-W6b2FaultObservation -ResultCode cleanupOwnedProcessesCompleted
    Write-W6b2FaultObservation -ResultCode cleanupSourceProcessStarted
    if ($null -ne $context -and $null -ne $context.HandoffProcess) {
      Wait-W6b2SuccessOwnedProcessesAbsent `
        -Observation $context.HandoffObservation -TimeoutMilliseconds 30000
      Close-W6b2SuccessProcess -Process $context.HandoffProcess
      $context.HandoffObservation = $null
      $context.HandoffProcess = $null
    }
    Write-W6b2FaultObservation -ResultCode cleanupSourceProcessCompleted
    if ($null -ne $context) {
      $targetCleanupAuthorized = $context.TargetCleanupAuthorized
    }
    if ($null -ne $installer) {
      foreach ($entry in @(
        [pscustomobject]@{
          authorized = $targetCleanupAuthorized
          code = $targetCode
          log = 'target-uninstall.log'
          started = 'cleanupTargetPackageStarted'
          completed = 'cleanupTargetPackageCompleted'
        },
        [pscustomobject]@{
          authorized = $sourceCleanupAuthorized
          code = $sourceCode
          log = 'source-uninstall.log'
          started = 'cleanupSourcePackageStarted'
          completed = 'cleanupSourcePackageCompleted'
        }
      )) {
        Write-W6b2FaultObservation -ResultCode $entry.started
        if ($entry.authorized -and $null -ne $entry.code) {
          Uninstall-W6b2SuccessPackage -ProductCode $entry.code `
            -LogPath (Join-Path $proofRoot "private-logs\$($entry.log)")
        }
        Write-W6b2FaultObservation -ResultCode $entry.completed
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
    Write-W6b2FaultObservation -ResultCode cleanupPostconditionsStarted
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
        throw 'W6B2_FAULT_STATE_INVALID'
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
    Write-W6b2FaultObservation -ResultCode cleanupPostconditionsCompleted
    Complete-W6b2FaultStage -ResultCode cleanupCompleted
  }
  catch {
    $cleanupFailed = $true
    Fail-W6b2FaultStage -ErrorRecord $_
  }
  if ($null -ne $installer) {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
  }
}

if (!$scenarioSucceeded -or $cleanupFailed) {
  Fail-W6b2FaultScenario
  exit 1
}
Complete-W6b2FaultScenario
exit 0

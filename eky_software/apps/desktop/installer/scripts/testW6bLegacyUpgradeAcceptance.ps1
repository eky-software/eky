param(
  [Parameter(Mandatory = $true)][string]$SourceMsiPath,
  [Parameter(Mandatory = $true)][string]$TargetMsiPath,
  [Parameter(Mandatory = $true)][string]$TargetPayloadRoot,
  [Parameter(Mandatory = $true)][string]$SourceProductCode,
  [Parameter(Mandatory = $true)][string]$TargetProductCode,
  [Parameter(Mandatory = $true)][string]$SourceAppVersion,
  [Parameter(Mandatory = $true)][string]$TargetAppVersion,
  [Parameter(Mandatory = $true)][string]$SourceBuildRevision,
  [Parameter(Mandatory = $true)][string]$SourceRuntimeBuildRevision,
  [Parameter(Mandatory = $true)][string]$TargetBuildRevision,
  [Parameter(Mandatory = $true)][string]$TargetMsiProductVersion,
  [Parameter(Mandatory = $true)][string]$TargetPackageVersion,
  [Parameter(Mandatory = $true)][string]$TargetReleaseChannel,
  [Parameter(Mandatory = $true)][string]$TargetUpgradeCode,
  [Parameter(Mandatory = $true)][string]$SourcePackageSha256,
  [Parameter(Mandatory = $true)][string]$TargetPackageSha256,
  [Parameter(Mandatory = $true)]
  [ValidateSet('exact-local-release', 'historical-source-rebuild')]
  [string]$SourceClassification,
  [Parameter(Mandatory = $true)][string]$LineageProfileIdPattern
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerTestSupport.ps1')
. (Join-Path $PSScriptRoot 'windowsInstallerProcessTree.ps1')
. (Join-Path $PSScriptRoot `
  'w6bLegacy\historicalPackagedSmokeProcessChain.ps1')
. (Join-Path $PSScriptRoot 'w6bLegacy\sourceUserData.ps1')

$script:AllowedStages = @(
  'preflight',
  'sourceInstall',
  'sourceStartup',
  'legacyFixtureVerification',
  'targetInstall',
  'targetFirstStartup',
  'adoptionVerification',
  'targetSecondStartup',
  'cleanup'
)
$script:AllowedSourceSmokeStages = @(
  'startup',
  'backend',
  'emptyArtifactSnapshot',
  'diagnostics',
  'logFolder',
  'supportBundle',
  'secretStorage',
  'invoicePdfArchive',
  'pdfPreview',
  'profileBackup',
  'profileSnapshotMaintenance',
  'profileSnapshotCreated',
  'profileSnapshotCaptured',
  'profileBackupVerified',
  'profileMutationCreated',
  'profileRestore',
  'profileRestoreStaged',
  'restoreRestart',
  'restoredStartup',
  'restoreActivationJournalLoaded',
  'restoredBackend',
  'restoredSessionValidated',
  'profileComparison',
  'secondBackup',
  'shutdown'
)
$script:CurrentStage = 'preflight'
$script:ScenarioStartedAt = [DateTime]::UtcNow
$script:StageStartedAt = [DateTime]::UtcNow
$script:FailureCode = $null
$script:FailureStage = $null
$script:SourceFailurePhase = $null
$script:CleanupFailure = $false
$script:Completed = $false
$script:SourceBackendHealthObserved = $false
$script:SourceBusinessFixtureObserved = $false
$script:SourceRuntimeSessionObserved = $false
$script:SourceUtilityObserved = $false
$script:PreflightIsolationEstablished = $false
$script:SourceCleanupAuthorized = $false
$script:TargetCleanupAuthorized = $false
$script:TargetCurrentAcceptedBuildClass = $null
$script:TargetLegacyAcceptedBuildClass = $null

$installer = $null
$sourceCode = $null
$targetCode = $null
$runningProcess = $null
$businessInventoryBefore = $null
$testRootToken = [guid]::NewGuid().ToString('N').Substring(0, 12)
$testRoot = Join-Path $env:TEMP "w6-$testRootToken"
$isolatedAppDataRoot = Join-Path $testRoot 'app-data-roaming'
$sourceSmokeTempRoot = Join-Path $testRoot 's'
$sourceSmokeToken = [guid]::NewGuid().ToString('N')
$sourceSmokeRoot = Join-Path `
  (Join-Path $sourceSmokeTempRoot 'eky-desktop-smoke') $sourceSmokeToken
$sourceSmokeResultPath = Join-Path $sourceSmokeRoot `
  'result\desktop-smoke-result.json'
$userDataRoot = $null
$logRoot = Join-Path $testRoot 'private-logs'
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Eky'
$shortcutPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Eky\Eky.lnk'
$businessDataRoot = Join-Path $env:APPDATA 'Eky'

. (Join-Path $PSScriptRoot 'w6bLegacy\progress.ps1')
. (Join-Path $PSScriptRoot 'w6bLegacy\pathSafety.ps1')
. (Join-Path $PSScriptRoot 'w6bLegacy\evidence.ps1')
. (Join-Path $PSScriptRoot 'w6bLegacy\gracefulApplicationShutdown.ps1')
. (Join-Path $PSScriptRoot 'w6bLegacy\installerLifecycle.ps1')
. (Join-Path $PSScriptRoot 'w6bLegacy\sourceSmoke.ps1')
Assert-W6bLegacyArtifactPathBudget -SourceSmokeRoot $sourceSmokeRoot
Start-W6bLegacyStage -Stage preflight
try {
  if (
    $SourceAppVersion -ne '0.2.6' -or
    $TargetAppVersion -ne '0.2.7' -or
    $SourceBuildRevision -cnotmatch '^[0-9a-f]{40}$' -or
    $SourceRuntimeBuildRevision -cnotmatch '^[0-9a-f]{12}$' -or
    $SourceBuildRevision.Substring(0, 12) -cne $SourceRuntimeBuildRevision -or
    $TargetBuildRevision -cnotmatch '^[0-9a-f]{7,40}$' -or
    $TargetMsiProductVersion -cne $TargetAppVersion -or
    $TargetPackageVersion -cne $TargetAppVersion -or
    $TargetReleaseChannel -cne 'pilot' -or
    $TargetUpgradeCode -cne '302530B2-D950-41F5-8397-264B485FEE9A' -or
    $LineageProfileIdPattern -cne '^[0-9a-f]{64}$'
  ) {
    throw 'W6B_LEGACY_RELEASE_IDENTITY_INVALID'
  }
  $sourceMsi = Resolve-W6bFile -Path $SourceMsiPath -Extension '.msi'
  $targetMsi = Resolve-W6bFile -Path $TargetMsiPath -Extension '.msi'
  $targetPayload = (Resolve-Path -LiteralPath $TargetPayloadRoot).Path
  if (!(Test-Path -LiteralPath $targetPayload -PathType Container)) {
    throw 'W6B_LEGACY_TARGET_PAYLOAD_INVALID'
  }
  Assert-W6bPackageHash -Path $sourceMsi -ExpectedSha256 $SourcePackageSha256
  Assert-W6bPackageHash -Path $targetMsi -ExpectedSha256 $TargetPackageSha256
  $sourceCode = Normalize-W6bProductCode -Code $SourceProductCode
  $targetCode = Normalize-W6bProductCode -Code $TargetProductCode
  if ($sourceCode -eq $targetCode) {
    throw 'W6B_LEGACY_PRODUCT_CODES_NOT_DISTINCT'
  }
  if (Test-Path -LiteralPath $testRoot) {
    throw 'W6B_LEGACY_TEST_ROOT_COLLISION'
  }
  $installer = New-Object -ComObject WindowsInstaller.Installer
  Assert-W6bProductAbsent -ProductCode $sourceCode
  Assert-W6bProductAbsent -ProductCode $targetCode
  Assert-W6bNoEkyProcesses
  if (
    (Test-Path -LiteralPath $installRoot) -or
    (Test-Path -LiteralPath $shortcutPath)
  ) {
    throw 'W6B_LEGACY_EXISTING_INSTALLATION_FORBIDDEN'
  }
  Assert-EkyInstallerRegistrationAbsent -ProductCodes @(
    $sourceCode,
    $targetCode
  )
  $script:PreflightIsolationEstablished = $true
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $isolatedAppDataRoot -Force | Out-Null
  $businessInventoryBefore = Get-EkyDirectoryInventory -Root $businessDataRoot
  $targetPayloadInventory = Get-EkyDirectoryInventory -Root $targetPayload
  if ($targetPayloadInventory.Count -lt 1) {
    throw 'W6B_LEGACY_TARGET_PAYLOAD_INVALID'
  }
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage sourceInstall
  $script:SourceCleanupAuthorized = $true
  Install-W6bPackage -MsiPath $sourceMsi -LogName 'source-install.log' `
    -Operation w6b_source_install
  Assert-W6bProductInstalled -ProductCode $sourceCode
  Assert-W6bProductAbsent -ProductCode $targetCode
  Assert-EkyInstallerRegistrationPresent -ProductCode $sourceCode
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage sourceStartup
  Invoke-W6bSourcePackagedSmoke
  $sourceUserData = Resolve-W6bLegacySourceUserData `
    -SourceSmokeTempRoot $sourceSmokeTempRoot `
    -SourceSmokeToken $sourceSmokeToken `
    -ExpectedVersion $SourceAppVersion `
    -ExpectedRevision $SourceRuntimeBuildRevision `
    -ReadAcceptedBuild {
      param([string]$Path)
      Read-W6bAcceptedBuildFile -Path $Path
    }
  $userDataRoot = $sourceUserData.Root
  Write-W6bLegacyReadinessObservation -Signal sourceUserDataReady
  $runningProcess = Start-W6bIsolatedEkyProcess
  Wait-W6bEkyAccepted -Process $runningProcess `
    -ExpectedIdentity source `
    -SourceVersion $SourceAppVersion `
    -SourceRevision $SourceRuntimeBuildRevision `
    -TargetVersion $TargetAppVersion `
    -TargetRevision $TargetBuildRevision
  Stop-W6bEkyGracefully -Process $runningProcess
  $runningProcess = $null
  Assert-W6bNoEkyProcesses
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage legacyFixtureVerification
  $legacyDataRoot = Join-Path $userDataRoot 'runtime\data'
  $legacyStorageRoot = Join-Path $userDataRoot 'runtime\storage'
  $legacyDatabasePath = Join-Path $legacyDataRoot 'eky.sqlite'
  if (!(Test-Path -LiteralPath $legacyDatabasePath -PathType Leaf)) {
    throw 'W6B_LEGACY_DATABASE_MISSING'
  }
  $legacyPdf = Find-W6bAuthoritativeInvoicePdf `
    -StorageRoot $legacyStorageRoot
  $legacyPdfPath = $legacyPdf.FullName
  $legacyPdfRelativePath = $legacyPdf.RelativePath
  $legacyDataInventory = Get-W6bEvidenceDirectoryInventory `
    -Root $legacyDataRoot
  $legacyStorageInventory = Get-W6bEvidenceDirectoryInventory `
    -Root $legacyStorageRoot
  if (
    $legacyDataInventory.Count -lt 1 -or
    $legacyStorageInventory.Count -lt 1
  ) {
    throw 'W6B_LEGACY_BUSINESS_FIXTURE_INVALID'
  }
  $legacyDatabaseHash = Get-W6bEvidenceFileSha256 -Path $legacyDatabasePath
  $legacyPdfHash = Get-W6bEvidenceFileSha256 -Path $legacyPdfPath
  $script:SourceBusinessFixtureObserved = $true
  Write-W6bLegacyReadinessObservation -Signal legacyBusinessFixtureReady
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage targetInstall
  $script:TargetCleanupAuthorized = $true
  Write-W6bLegacyInstallerObservation -Signal msiStarted
  Install-W6bPackage -MsiPath $targetMsi -LogName 'target-upgrade.log' `
    -Operation w6b_target_install
  Write-W6bLegacyInstallerObservation -Signal msiExited
  Assert-W6bProductAbsent -ProductCode $sourceCode
  Assert-W6bProductInstalled -ProductCode $targetCode
  Write-W6bLegacyInstallerObservation -Signal productStateValidated
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $targetPayloadInventory -ShortcutPath $shortcutPath
  Assert-EkyInstallerRegistrationPresent -ProductCode $targetCode
  Write-W6bLegacyInstallerObservation -Signal payloadValidated
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage targetFirstStartup
  $runningProcess = Start-W6bIsolatedEkyProcess
  Wait-W6bEkyAccepted -Process $runningProcess `
    -ExpectedIdentity target `
    -SourceVersion $SourceAppVersion `
    -SourceRevision $SourceRuntimeBuildRevision `
    -TargetVersion $TargetAppVersion `
    -TargetRevision $TargetBuildRevision
  $registry = Read-W6bWorkspaceRegistry
  Stop-W6bEkyGracefully -Process $runningProcess
  $runningProcess = $null
  Assert-W6bNoEkyProcesses
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage adoptionVerification
  Assert-EkyInventoryEqual `
    (Get-W6bEvidenceDirectoryInventory -Root $legacyDataRoot) `
    $legacyDataInventory 'W6B_LEGACY_SOURCE_DATA_CHANGED'
  Assert-EkyInventoryEqual `
    (Get-W6bEvidenceDirectoryInventory -Root $legacyStorageRoot) `
    $legacyStorageInventory 'W6B_LEGACY_SOURCE_STORAGE_CHANGED'
  $workspaceRuntimeRoot = Join-Path $userDataRoot `
    "workspaces\$($registry.activeWorkspaceId)\runtime"
  $workspaceDataRoot = Join-Path $workspaceRuntimeRoot 'data'
  $workspaceStorageRoot = Join-Path $workspaceRuntimeRoot 'storage'
  $workspaceDatabasePath = Join-Path $workspaceDataRoot 'eky.sqlite'
  $workspacePdfPath = Join-Path $workspaceStorageRoot `
    $legacyPdfRelativePath
  if (
    (Get-W6bEvidenceFileSha256 -Path $workspaceDatabasePath) -ne `
      $legacyDatabaseHash -or
    (Get-W6bEvidenceFileSha256 -Path $workspacePdfPath) -ne $legacyPdfHash
  ) {
    throw 'W6B_LEGACY_ADOPTED_CONTENT_MISMATCH'
  }
  $registryInventoryAfterFirstStart = Get-W6bWorkspaceRegistryInventory `
    -UserDataRoot $userDataRoot
  $workspaceDataAfterFirstStart = Get-W6bEvidenceDirectoryInventory `
    -Root $workspaceDataRoot
  $workspaceStorageAfterFirstStart = Get-W6bEvidenceDirectoryInventory `
    -Root $workspaceStorageRoot
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage targetSecondStartup
  $runningProcess = Start-W6bIsolatedEkyProcess
  Wait-W6bEkyAccepted -Process $runningProcess `
    -ExpectedIdentity target `
    -SourceVersion $SourceAppVersion `
    -SourceRevision $SourceRuntimeBuildRevision `
    -TargetVersion $TargetAppVersion `
    -TargetRevision $TargetBuildRevision
  $registryAfterSecondStart = Read-W6bWorkspaceRegistry
  Stop-W6bEkyGracefully -Process $runningProcess
  $runningProcess = $null
  Assert-W6bNoEkyProcesses
  if (
    $registryAfterSecondStart.activeWorkspaceId -ne
      $registry.activeWorkspaceId -or
    @($registryAfterSecondStart.workspaces).Count -ne 1
  ) {
    throw 'W6B_LEGACY_ADOPTION_NOT_IDEMPOTENT'
  }
  Assert-EkyInventoryEqual `
    (Get-W6bWorkspaceRegistryInventory -UserDataRoot $userDataRoot) `
    @($registryInventoryAfterFirstStart) `
    'W6B_LEGACY_REGISTRY_CHANGED_ON_SECOND_START'
  Assert-EkyInventoryEqual `
    (Get-W6bEvidenceDirectoryInventory -Root $workspaceDataRoot) `
    $workspaceDataAfterFirstStart `
    'W6B_LEGACY_WORKSPACE_DATA_CHANGED_ON_SECOND_START'
  Assert-EkyInventoryEqual `
    (Get-W6bEvidenceDirectoryInventory -Root $workspaceStorageRoot) `
    $workspaceStorageAfterFirstStart `
    'W6B_LEGACY_WORKSPACE_STORAGE_CHANGED_ON_SECOND_START'
  Assert-EkyInventoryEqual `
    (Get-EkyDirectoryInventory -Root $businessDataRoot) `
    $businessInventoryBefore 'W6B_LEGACY_NORMAL_PROFILE_CHANGED'
  Assert-W6bPackageHash -Path $sourceMsi -ExpectedSha256 $SourcePackageSha256
  Assert-W6bPackageHash -Path $targetMsi -ExpectedSha256 $TargetPackageSha256
  Complete-W6bLegacyStage
  $script:Completed = $true
}
catch {
  $script:FailureCode = Get-W6bSafeErrorCode -ErrorRecord $_
  $script:FailureStage = $script:CurrentStage
  try {
    Write-W6bLegacyProgress -Status failed -ResultCode failedSafe
  }
  catch {
    $script:FailureCode = 'W6B_LEGACY_ACCEPTANCE_FAILED'
  }
}
finally {
  $script:CurrentStage = 'cleanup'
  $script:StageStartedAt = [DateTime]::UtcNow
  Write-W6bLegacyProgress -Status started -ResultCode started
  Write-W6bLegacyCleanupObservation -Signal processStopStarted
  try {
    if ($null -ne $runningProcess) {
      Stop-EkyProcessTree -Process $runningProcess
    }
    Write-W6bLegacyCleanupObservation -Signal processStopCompleted
  }
  catch {
    $script:CleanupFailure = $true
    Write-W6bLegacyCleanupObservation -Signal processStopFailed
  }
  $cleanupProducts = if ($script:PreflightIsolationEstablished) {
    @(
      if ($script:TargetCleanupAuthorized) {
        [pscustomobject]@{
          productCode = $targetCode
          startedSignal = 'targetUninstallStarted'
          completedSignal = 'targetUninstallCompleted'
          failedSignal = 'targetUninstallFailed'
        }
      }
      if ($script:SourceCleanupAuthorized) {
        [pscustomobject]@{
          productCode = $sourceCode
          startedSignal = 'sourceUninstallStarted'
          completedSignal = 'sourceUninstallCompleted'
          failedSignal = 'sourceUninstallFailed'
        }
      }
    )
  }
  else {
    @()
  }
  foreach ($cleanupProduct in $cleanupProducts) {
    Write-W6bLegacyCleanupObservation `
      -Signal $cleanupProduct.startedSignal
    try {
      $productCode = $cleanupProduct.productCode
      if (
        $null -ne $installer -and
        $null -ne $productCode -and
        (Get-EkyProductState -Installer $installer -Code $productCode) -ge 1
      ) {
        Uninstall-W6bProduct -ProductCode $productCode `
          -LogName "cleanup-$($productCode.Trim('{}')).log"
      }
      Write-W6bLegacyCleanupObservation `
        -Signal $cleanupProduct.completedSignal
    }
    catch {
      $script:CleanupFailure = $true
      Write-W6bLegacyCleanupObservation `
        -Signal $cleanupProduct.failedSignal
    }
  }
  Write-W6bLegacyCleanupObservation -Signal postconditionsStarted
  try {
    if ($script:PreflightIsolationEstablished) {
      Assert-EkyPathEventuallyAbsent -Path $installRoot `
        -Code 'W6B_LEGACY_INSTALL_ROOT_REMAINS'
      Assert-EkyPathEventuallyAbsent -Path $shortcutPath `
        -Code 'W6B_LEGACY_SHORTCUT_REMAINS'
      Assert-W6bNoEkyProcesses
      if ($null -ne $installer) {
        Assert-EkyInstallerRegistrationAbsent -ProductCodes @(
          @($sourceCode, $targetCode) | Where-Object { $null -ne $_ }
        )
      }
    }
    if ($null -ne $businessInventoryBefore) {
      Assert-EkyInventoryEqual `
        (Get-EkyDirectoryInventory -Root $businessDataRoot) `
        $businessInventoryBefore 'W6B_LEGACY_NORMAL_PROFILE_CHANGED'
    }
    Write-W6bLegacyCleanupObservation -Signal postconditionsCompleted
  }
  catch {
    $script:CleanupFailure = $true
    Write-W6bLegacyCleanupObservation -Signal postconditionsFailed
  }
  Write-W6bLegacyCleanupObservation -Signal installerReleaseStarted
  try {
    if ($null -ne $installer) {
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
    }
    Write-W6bLegacyCleanupObservation -Signal installerReleaseCompleted
  }
  catch {
    $script:CleanupFailure = $true
    Write-W6bLegacyCleanupObservation -Signal installerReleaseFailed
  }
  if ($script:Completed -and !$script:CleanupFailure) {
    Write-W6bLegacyCleanupObservation -Signal testRootRemovalStarted
    try {
      Remove-W6bLegacyAcceptanceTestRoot -Root $testRoot
      Write-W6bLegacyCleanupObservation -Signal testRootRemovalCompleted
    }
    catch {
      $script:CleanupFailure = $true
      Write-W6bLegacyCleanupObservation -Signal testRootRemovalFailed
    }
  }
  if ($script:CleanupFailure) {
    $script:FailureCode = 'W6B_LEGACY_CLEANUP_FAILED'
    Write-W6bLegacyProgress -Status failed -ResultCode failedSafe
  }
  else {
    Write-W6bLegacyProgress -Status completed -ResultCode completed
  }
}

if ($null -ne $script:FailureCode) {
  $failure = [ordered]@{
    scenario = 'legacyUpgrade'
    status = 'failed'
    stage = $script:FailureStage
    errorCode = $script:FailureCode
  }
  if ($null -ne $script:SourceFailurePhase) {
    $failure.sourceFailurePhase = $script:SourceFailurePhase
  }
  $failure | ConvertTo-Json -Compress
  exit 1
}

[ordered]@{
  scenario = 'legacyUpgrade'
  status = 'completed'
  sourceClassification = $SourceClassification
  sourceVersion = $SourceAppVersion
  targetVersion = $TargetAppVersion
  legacyBusinessFixtureValidated = $true
  runtimeSessionValidated = $true
  adoptedWorkspaceCount = 1
  businessDataPreserved = $true
  idempotentSecondStartup = $true
  targetCurrentAcceptedBuildClass = $script:TargetCurrentAcceptedBuildClass
  targetLegacyAcceptedBuildClass = $script:TargetLegacyAcceptedBuildClass
  targetPayloadBytesValidated = $true
  orphanProcessCount = 0
} | ConvertTo-Json -Compress

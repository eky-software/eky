param(
  [Parameter(Mandatory = $true)][string]$SourceMsiPath,
  [Parameter(Mandatory = $true)][string]$TargetMsiPath,
  [Parameter(Mandatory = $true)][string]$TargetPayloadRoot,
  [Parameter(Mandatory = $true)][string]$SourceProductCode,
  [Parameter(Mandatory = $true)][string]$TargetProductCode,
  [Parameter(Mandatory = $true)][string]$SourceAppVersion,
  [Parameter(Mandatory = $true)][string]$TargetAppVersion,
  [Parameter(Mandatory = $true)][string]$SourceBuildRevision,
  [Parameter(Mandatory = $true)][string]$TargetBuildRevision,
  [Parameter(Mandatory = $true)][string]$SourcePackageSha256,
  [Parameter(Mandatory = $true)][string]$TargetPackageSha256,
  [Parameter(Mandatory = $true)]
  [ValidateSet('exact-local-release', 'historical-source-rebuild')]
  [string]$SourceClassification
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerTestSupport.ps1')
. (Join-Path $PSScriptRoot 'windowsInstallerProcessTree.ps1')

$script:AllowedStages = @(
  'preflight',
  'sourceInstall',
  'sourceStartup',
  'legacyProfileSeed',
  'targetInstall',
  'targetFirstStartup',
  'adoptionVerification',
  'targetSecondStartup',
  'cleanup'
)
$script:CurrentStage = 'preflight'
$script:ScenarioStartedAt = [DateTime]::UtcNow
$script:StageStartedAt = [DateTime]::UtcNow
$script:FailureCode = $null
$script:CleanupFailure = $false
$script:Completed = $false

$installer = $null
$sourceCode = $null
$targetCode = $null
$runningProcess = $null
$businessInventoryBefore = $null
$testRoot = Join-Path $env:TEMP "eky-w6b-legacy-$([guid]::NewGuid().ToString('N'))"
$isolatedAppDataRoot = Join-Path $testRoot 'app-data-roaming'
$userDataRoot = Join-Path $isolatedAppDataRoot 'Eky'
$logRoot = Join-Path $testRoot 'private-logs'
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Eky'
$shortcutPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Eky\Eky.lnk'
$businessDataRoot = Join-Path $env:APPDATA 'Eky'

function Write-W6bLegacyProgress {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('started', 'completed', 'failed')]
    [string]$Status,
    [Parameter(Mandatory = $true)][string]$ResultCode
  )

  if ($script:CurrentStage -notin $script:AllowedStages) {
    throw 'W6B_LEGACY_PROGRESS_STAGE_INVALID'
  }
  [ordered]@{
    scenario = 'legacyUpgrade'
    stage = $script:CurrentStage
    status = $Status
    resultCode = $ResultCode
    durationMs = [long]([DateTime]::UtcNow - $script:StageStartedAt).TotalMilliseconds
    elapsedMs = [long]([DateTime]::UtcNow - $script:ScenarioStartedAt).TotalMilliseconds
  } | ConvertTo-Json -Compress
}

function Start-W6bLegacyStage {
  param([Parameter(Mandatory = $true)][string]$Stage)

  if ($Stage -notin $script:AllowedStages) {
    throw 'W6B_LEGACY_PROGRESS_STAGE_INVALID'
  }
  $script:CurrentStage = $Stage
  $script:StageStartedAt = [DateTime]::UtcNow
  Write-W6bLegacyProgress -Status started -ResultCode started
}

function Complete-W6bLegacyStage {
  Write-W6bLegacyProgress -Status completed -ResultCode completed
}

function Normalize-W6bProductCode {
  param([Parameter(Mandatory = $true)][string]$Code)

  if ($Code -notmatch '^\{?[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}?$') {
    throw 'W6B_LEGACY_PRODUCT_CODE_INVALID'
  }
  return "{$($Code.Trim('{}').ToUpperInvariant())}"
}

function Resolve-W6bFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Extension
  )

  $resolved = (Resolve-Path -LiteralPath $Path).Path
  if (
    !(Test-Path -LiteralPath $resolved -PathType Leaf) -or
    [System.IO.Path]::GetExtension($resolved) -ne $Extension
  ) {
    throw 'W6B_LEGACY_INPUT_FILE_INVALID'
  }
  return $resolved
}

function Assert-W6bPackageHash {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256
  )

  if (
    $ExpectedSha256 -notmatch '^[0-9a-f]{64}$' -or
    (Get-EkyFileSha256 -Path $Path).ToLowerInvariant() -ne $ExpectedSha256
  ) {
    throw 'W6B_LEGACY_PACKAGE_HASH_MISMATCH'
  }
}

function Assert-W6bProductInstalled {
  param([Parameter(Mandatory = $true)][string]$ProductCode)

  if ((Get-EkyProductState -Installer $installer -Code $ProductCode) -lt 1) {
    throw 'W6B_LEGACY_EXPECTED_PRODUCT_MISSING'
  }
}

function Assert-W6bProductAbsent {
  param([Parameter(Mandatory = $true)][string]$ProductCode)

  if ((Get-EkyProductState -Installer $installer -Code $ProductCode) -ge 1) {
    throw 'W6B_LEGACY_UNEXPECTED_PRODUCT_PRESENT'
  }
}

function Install-W6bPackage {
  param(
    [Parameter(Mandatory = $true)][string]$MsiPath,
    [Parameter(Mandatory = $true)][string]$LogName
  )

  Invoke-EkyMsiExec -Operation 'w6b_install' -Arguments @(
    '/i',
    "`"$MsiPath`"",
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot $LogName)`""
  ) | Out-Null
}

function Uninstall-W6bProduct {
  param(
    [Parameter(Mandatory = $true)][string]$ProductCode,
    [Parameter(Mandatory = $true)][string]$LogName
  )

  Invoke-EkyMsiExec -Operation 'w6b_uninstall' -Arguments @(
    '/x',
    $ProductCode,
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot $LogName)`""
  ) | Out-Null
}

function Test-W6bUtilityDescendant {
  param([Parameter(Mandatory = $true)][int]$RootProcessId)

  $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $descendantIds = @($RootProcessId)
  do {
    $previousCount = $descendantIds.Count
    foreach ($candidate in $processes) {
      if (
        $descendantIds -contains [int]$candidate.ParentProcessId -and
        $descendantIds -notcontains [int]$candidate.ProcessId
      ) {
        $descendantIds += [int]$candidate.ProcessId
      }
    }
  } while ($descendantIds.Count -ne $previousCount)
  return @(
    $processes | Where-Object {
      $descendantIds -contains [int]$_.ProcessId -and
      $_.Name -eq 'Eky.exe' -and
      $_.CommandLine -match '--type=utility'
    }
  ).Count -gt 0
}

function Read-W6bAcceptedBuild {
  param([Parameter(Mandatory = $true)][string]$UserDataPath)

  $paths = @(
    (Join-Path $UserDataPath 'update-state\accepted-build-v1.json'),
    (Join-Path $UserDataPath 'runtime\update-state\accepted-build-v1.json')
  )
  foreach ($path in $paths) {
    if (!(Test-Path -LiteralPath $path -PathType Leaf)) {
      continue
    }
    $metadata = Get-Item -LiteralPath $path -Force
    if ($metadata.Length -lt 1 -or $metadata.Length -gt 4096) {
      throw 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
    }
    try {
      $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 |
        ConvertFrom-Json
    }
    catch {
      throw 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
    }
    $keys = @($value.PSObject.Properties.Name | Sort-Object)
    $expectedKeys = @(
      'acceptedAt',
      'appVersion',
      'buildRevision',
      'formatVersion',
      'releaseChannel'
    )
    if (
      (Compare-Object $keys $expectedKeys).Count -ne 0 -or
      $value.formatVersion -ne 1 -or
      $value.releaseChannel -ne 'pilot' -or
      $value.appVersion -notmatch '^\d+\.\d+\.\d+$' -or
      $value.buildRevision -notmatch '^[0-9a-f]{7,40}$'
    ) {
      throw 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
    }
    return $value
  }
  return $null
}

function Start-W6bIsolatedEkyProcess {
  $executablePath = Join-Path $installRoot 'Eky.exe'
  if (!(Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw 'W6B_LEGACY_EXECUTABLE_MISSING'
  }

  $previousAppData = [Environment]::GetEnvironmentVariable(
    'APPDATA',
    [EnvironmentVariableTarget]::Process
  )
  try {
    [Environment]::SetEnvironmentVariable(
      'APPDATA',
      $isolatedAppDataRoot,
      [EnvironmentVariableTarget]::Process
    )
    return Start-Process -FilePath $executablePath -ArgumentList @(
      "--user-data-dir=`"$userDataRoot`""
    ) -PassThru
  }
  finally {
    [Environment]::SetEnvironmentVariable(
      'APPDATA',
      $previousAppData,
      [EnvironmentVariableTarget]::Process
    )
  }
}

function Wait-W6bEkyAccepted {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][string]$ExpectedRevision
  )

  $readinessFailureCode = 'W6B_LEGACY_ACCEPTED_BUILD_MISSING'
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 250
    $Process.Refresh()
    if ($Process.HasExited) {
      throw 'W6B_LEGACY_APPLICATION_EXITED_EARLY'
    }
    $accepted = Read-W6bAcceptedBuild -UserDataPath $userDataRoot
    if ($null -eq $accepted) {
      $readinessFailureCode = 'W6B_LEGACY_ACCEPTED_BUILD_MISSING'
      continue
    }
    if (
      $accepted.appVersion -ne $ExpectedVersion -or
      $accepted.buildRevision -ne $ExpectedRevision
    ) {
      $readinessFailureCode = 'W6B_LEGACY_ACCEPTED_BUILD_IDENTITY_MISMATCH'
      continue
    }
    if (!(Test-W6bUtilityDescendant -RootProcessId $Process.Id)) {
      $readinessFailureCode = 'W6B_LEGACY_BACKEND_UTILITY_MISSING'
      continue
    }
    return
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $readinessFailureCode
}

function Stop-W6bEkyGracefully {
  param([Parameter(Mandatory = $true)]$Process)

  $rootIdentity = New-EkyProcessIdentity -ProcessId ([int]$Process.Id) `
    -CreationToken (ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$Process.StartTime))
  $owned = @(
    Get-EkyOwnedProcessIdentitiesFromSnapshot -RootIdentity $rootIdentity `
      -ProcessSnapshot (Get-EkyProcessSnapshot)
  )
  if ($owned.Count -eq 0) {
    throw 'W6B_LEGACY_APPLICATION_PROCESS_MISSING'
  }
  if (!$Process.CloseMainWindow()) {
    throw 'W6B_LEGACY_GRACEFUL_SHUTDOWN_UNAVAILABLE'
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $remaining = @(
      Get-EkyRemainingOwnedProcessIdentitiesFromSnapshot `
        -OwnedProcessIdentities $owned `
        -ProcessSnapshot (Get-EkyProcessSnapshot)
    )
    if ($remaining.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'W6B_LEGACY_GRACEFUL_SHUTDOWN_TIMEOUT'
}

function Read-W6bWorkspaceRegistry {
  $registryPath = Join-Path $userDataRoot 'workspace-registry-v1.json'
  if (!(Test-Path -LiteralPath $registryPath -PathType Leaf)) {
    throw 'W6B_LEGACY_WORKSPACE_REGISTRY_MISSING'
  }
  $metadata = Get-Item -LiteralPath $registryPath -Force
  if ($metadata.Length -lt 1 -or $metadata.Length -gt 1048576) {
    throw 'W6B_LEGACY_WORKSPACE_REGISTRY_INVALID'
  }
  try {
    $registry = Get-Content -LiteralPath $registryPath -Raw -Encoding UTF8 |
      ConvertFrom-Json
  }
  catch {
    throw 'W6B_LEGACY_WORKSPACE_REGISTRY_INVALID'
  }
  if (
    $registry.formatVersion -ne 1 -or
    $registry.activeWorkspaceId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or
    @($registry.workspaces).Count -ne 1
  ) {
    throw 'W6B_LEGACY_WORKSPACE_REGISTRY_INVALID'
  }
  $workspace = @($registry.workspaces)[0]
  if (
    $workspace.workspaceId -ne $registry.activeWorkspaceId -or
    $workspace.workspaceLabel -ne 'Oma yritys' -or
    $workspace.layoutVersion -ne 1 -or
    $workspace.lifecycleState -ne 'ready' -or
    $workspace.lineageIdentity.formatVersion -ne 1 -or
    $workspace.lineageIdentity.profileId -notmatch '^[0-9a-f-]{36}$'
  ) {
    throw 'W6B_LEGACY_WORKSPACE_REGISTRY_INVALID'
  }
  return $registry
}

function Assert-W6bNoEkyProcesses {
  if (@(Get-Process -Name 'Eky' -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'W6B_LEGACY_ORPHAN_PROCESS_REMAINS'
  }
}

function Get-W6bSafeErrorCode {
  param([Parameter(Mandatory = $true)]$ErrorRecord)

  $candidate = ([string]$ErrorRecord.Exception.Message -split ':')[0]
  if ($candidate -match '^(W6B_LEGACY_[A-Z0-9_]+|INSTALLER_W6B_[A-Z0-9_]+)$') {
    return $candidate
  }
  return 'W6B_LEGACY_ACCEPTANCE_FAILED'
}

Start-W6bLegacyStage -Stage preflight
try {
  if (
    $SourceAppVersion -ne '0.2.6' -or
    $TargetAppVersion -ne '0.2.7' -or
    $SourceBuildRevision -notmatch '^[0-9a-f]{40}$' -or
    $TargetBuildRevision -notmatch '^[0-9a-f]{7,40}$'
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
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $isolatedAppDataRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $userDataRoot -Force | Out-Null
  $businessInventoryBefore = Get-EkyDirectoryInventory -Root $businessDataRoot
  $targetPayloadInventory = Get-EkyDirectoryInventory -Root $targetPayload
  if ($targetPayloadInventory.Count -lt 1) {
    throw 'W6B_LEGACY_TARGET_PAYLOAD_INVALID'
  }
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage sourceInstall
  Install-W6bPackage -MsiPath $sourceMsi -LogName 'source-install.log'
  Assert-W6bProductInstalled -ProductCode $sourceCode
  Assert-W6bProductAbsent -ProductCode $targetCode
  Assert-EkyInstallerRegistrationPresent -ProductCode $sourceCode
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage sourceStartup
  $runningProcess = Start-W6bIsolatedEkyProcess
  Wait-W6bEkyAccepted -Process $runningProcess `
    -ExpectedVersion $SourceAppVersion `
    -ExpectedRevision $SourceBuildRevision
  Stop-W6bEkyGracefully -Process $runningProcess
  $runningProcess = $null
  Assert-W6bNoEkyProcesses
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage legacyProfileSeed
  $legacyDataRoot = Join-Path $userDataRoot 'runtime\data'
  $legacyStorageRoot = Join-Path $userDataRoot 'runtime\storage'
  $legacyDatabasePath = Join-Path $legacyDataRoot 'eky.sqlite'
  if (!(Test-Path -LiteralPath $legacyDatabasePath -PathType Leaf)) {
    throw 'W6B_LEGACY_DATABASE_MISSING'
  }
  $legacyPdfPath = Join-Path $legacyStorageRoot `
    'invoices\11111111-1111-4111-8111-111111111111\22222222-2222-4222-8222-222222222222\approved-invoice.pdf'
  New-Item -ItemType Directory -Path (Split-Path -Parent $legacyPdfPath) `
    -Force | Out-Null
  [System.IO.File]::WriteAllText(
    $legacyPdfPath,
    "%PDF-1.7`n% Eky W6B synthetic legacy invoice`n%%EOF`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  $legacyDataInventory = Get-EkyDirectoryInventory -Root $legacyDataRoot
  $legacyStorageInventory = Get-EkyDirectoryInventory -Root $legacyStorageRoot
  $legacyDatabaseHash = Get-EkyFileSha256 -Path $legacyDatabasePath
  $legacyPdfHash = Get-EkyFileSha256 -Path $legacyPdfPath
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage targetInstall
  Install-W6bPackage -MsiPath $targetMsi -LogName 'target-upgrade.log'
  Assert-W6bProductAbsent -ProductCode $sourceCode
  Assert-W6bProductInstalled -ProductCode $targetCode
  Assert-EkyInstalledPayload -InstallRoot $installRoot `
    -PayloadInventory $targetPayloadInventory -ShortcutPath $shortcutPath
  Assert-EkyInstallerRegistrationPresent -ProductCode $targetCode
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage targetFirstStartup
  $runningProcess = Start-W6bIsolatedEkyProcess
  Wait-W6bEkyAccepted -Process $runningProcess `
    -ExpectedVersion $TargetAppVersion `
    -ExpectedRevision $TargetBuildRevision
  $registry = Read-W6bWorkspaceRegistry
  Stop-W6bEkyGracefully -Process $runningProcess
  $runningProcess = $null
  Assert-W6bNoEkyProcesses
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage adoptionVerification
  Assert-EkyInventoryEqual `
    (Get-EkyDirectoryInventory -Root $legacyDataRoot) `
    $legacyDataInventory 'W6B_LEGACY_SOURCE_DATA_CHANGED'
  Assert-EkyInventoryEqual `
    (Get-EkyDirectoryInventory -Root $legacyStorageRoot) `
    $legacyStorageInventory 'W6B_LEGACY_SOURCE_STORAGE_CHANGED'
  $workspaceRuntimeRoot = Join-Path $userDataRoot `
    "workspaces\$($registry.activeWorkspaceId)\runtime"
  $workspaceDataRoot = Join-Path $workspaceRuntimeRoot 'data'
  $workspaceStorageRoot = Join-Path $workspaceRuntimeRoot 'storage'
  $workspaceDatabasePath = Join-Path $workspaceDataRoot 'eky.sqlite'
  $workspacePdfPath = Join-Path $workspaceStorageRoot `
    'invoices\11111111-1111-4111-8111-111111111111\22222222-2222-4222-8222-222222222222\approved-invoice.pdf'
  if (
    (Get-EkyFileSha256 -Path $workspaceDatabasePath) -ne $legacyDatabaseHash -or
    (Get-EkyFileSha256 -Path $workspacePdfPath) -ne $legacyPdfHash
  ) {
    throw 'W6B_LEGACY_ADOPTED_CONTENT_MISMATCH'
  }
  $registryInventoryAfterFirstStart = Get-EkyDirectoryInventory `
    -Root $userDataRoot | Where-Object {
      $_ -match '^workspace-registry-v1\.json\|'
    }
  $workspaceDataAfterFirstStart = Get-EkyDirectoryInventory `
    -Root $workspaceDataRoot
  $workspaceStorageAfterFirstStart = Get-EkyDirectoryInventory `
    -Root $workspaceStorageRoot
  Complete-W6bLegacyStage

  Start-W6bLegacyStage -Stage targetSecondStartup
  $runningProcess = Start-W6bIsolatedEkyProcess
  Wait-W6bEkyAccepted -Process $runningProcess `
    -ExpectedVersion $TargetAppVersion `
    -ExpectedRevision $TargetBuildRevision
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
    @(Get-EkyDirectoryInventory -Root $userDataRoot | Where-Object {
      $_ -match '^workspace-registry-v1\.json\|'
    }) `
    @($registryInventoryAfterFirstStart) `
    'W6B_LEGACY_REGISTRY_CHANGED_ON_SECOND_START'
  Assert-EkyInventoryEqual `
    (Get-EkyDirectoryInventory -Root $workspaceDataRoot) `
    $workspaceDataAfterFirstStart `
    'W6B_LEGACY_WORKSPACE_DATA_CHANGED_ON_SECOND_START'
  Assert-EkyInventoryEqual `
    (Get-EkyDirectoryInventory -Root $workspaceStorageRoot) `
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
  if ($null -ne $runningProcess) {
    try {
      Stop-EkyProcessTree -Process $runningProcess
    }
    catch {
      $script:CleanupFailure = $true
    }
  }
  foreach ($productCode in @($targetCode, $sourceCode)) {
    if (
      $null -ne $installer -and
      $null -ne $productCode -and
      (Get-EkyProductState -Installer $installer -Code $productCode) -ge 1
    ) {
      try {
        Uninstall-W6bProduct -ProductCode $productCode `
          -LogName "cleanup-$($productCode.Trim('{}')).log"
      }
      catch {
        $script:CleanupFailure = $true
      }
    }
  }
  try {
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
    if ($null -ne $businessInventoryBefore) {
      Assert-EkyInventoryEqual `
        (Get-EkyDirectoryInventory -Root $businessDataRoot) `
        $businessInventoryBefore 'W6B_LEGACY_NORMAL_PROFILE_CHANGED'
    }
  }
  catch {
    $script:CleanupFailure = $true
  }
  if ($null -ne $installer) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
  }
  if ($script:Completed -and !$script:CleanupFailure) {
    Remove-Item -LiteralPath $testRoot -Force -Recurse
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
  [ordered]@{
    scenario = 'legacyUpgrade'
    status = 'failed'
    stage = $script:CurrentStage
    errorCode = $script:FailureCode
  } | ConvertTo-Json -Compress
  exit 1
}

[ordered]@{
  scenario = 'legacyUpgrade'
  status = 'completed'
  sourceClassification = $SourceClassification
  sourceVersion = $SourceAppVersion
  targetVersion = $TargetAppVersion
  adoptedWorkspaceCount = 1
  businessDataPreserved = $true
  idempotentSecondStartup = $true
  orphanProcessCount = 0
} | ConvertTo-Json -Compress

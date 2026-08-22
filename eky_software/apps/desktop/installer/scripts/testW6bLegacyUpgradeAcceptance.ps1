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
  [string]$SourceClassification,
  [Parameter(Mandatory = $true)][string]$LineageProfileIdPattern
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerTestSupport.ps1')
. (Join-Path $PSScriptRoot 'windowsInstallerProcessTree.ps1')
. (Join-Path $PSScriptRoot 'historicalPackagedSmokeProcessChain.ps1')
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

$installer = $null
$sourceCode = $null
$targetCode = $null
$runningProcess = $null
$businessInventoryBefore = $null
$testRoot = Join-Path $env:TEMP "eky-w6b-legacy-$([guid]::NewGuid().ToString('N'))"
$isolatedAppDataRoot = Join-Path $testRoot 'app-data-roaming'
$sourceSmokeTempRoot = Join-Path $testRoot 'source-smoke-temp'
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

function Write-W6bLegacyReadinessObservation {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
      'databaseReady',
      'backendUtilityReady',
      'acceptedBuildReady',
      'backendHealthReady',
      'sourceUserDataReady',
      'legacyBusinessFixtureReady',
      'runtimeSessionValidated'
    )]
    [string]$Signal
  )

  if (
    $script:CurrentStage -notin @(
      'sourceStartup',
      'legacyFixtureVerification',
      'targetFirstStartup',
      'targetSecondStartup'
    )
  ) {
    throw 'W6B_LEGACY_PROGRESS_STAGE_INVALID'
  }
  [ordered]@{
    scenario = 'legacyUpgrade'
    stage = $script:CurrentStage
    status = 'observed'
    resultCode = $Signal
    durationMs = [long]([DateTime]::UtcNow - $script:StageStartedAt).TotalMilliseconds
    elapsedMs = [long]([DateTime]::UtcNow - $script:ScenarioStartedAt).TotalMilliseconds
  } | ConvertTo-Json -Compress
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

function Test-W6bPathContained {
  param(
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $normalizedRoot = $Root.TrimEnd('\')
  return (
    $Candidate.Equals(
      $normalizedRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    ) -or
    $Candidate.StartsWith(
      "$normalizedRoot\",
      [System.StringComparison]::OrdinalIgnoreCase
    )
  )
}

function Get-W6bSafeFilesUnderRoot {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$FileName
  )

  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
  $rootItem = Get-Item -LiteralPath $resolvedRoot -Force
  if (
    !$rootItem.PSIsContainer -or
    ($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
  ) {
    throw 'W6B_LEGACY_TEST_ROOT_INVALID'
  }
  $directories = [System.Collections.Generic.Queue[object]]::new()
  $directories.Enqueue($rootItem)
  $files = @()
  while ($directories.Count -gt 0) {
    $directory = $directories.Dequeue()
    foreach ($item in @(Get-ChildItem -LiteralPath $directory.FullName -Force)) {
      if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw 'W6B_LEGACY_TEST_ROOT_INVALID'
      }
      $resolvedItem = (Resolve-Path -LiteralPath $item.FullName).Path
      if (!(Test-W6bPathContained -Candidate $resolvedItem -Root $resolvedRoot)) {
        throw 'W6B_LEGACY_TEST_ROOT_INVALID'
      }
      if ($item.PSIsContainer) {
        $directories.Enqueue($item)
        continue
      }
      if (
        [string]::IsNullOrEmpty($FileName) -or
        $item.Name -ceq $FileName
      ) {
        $files += $item
      }
    }
  }
  return ,@($files)
}

function Get-W6bRelativeContainedPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Code
  )

  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')
  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  if (!(Test-W6bPathContained -Candidate $resolvedPath -Root $resolvedRoot)) {
    throw $Code
  }
  return $resolvedPath.Substring($resolvedRoot.Length).TrimStart('\')
}

function Read-W6bAcceptedBuildFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  $metadata = Get-Item -LiteralPath $Path -Force
  if (
    $metadata.PSIsContainer -or
    ($metadata.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or
    $metadata.Length -lt 1 -or
    $metadata.Length -gt 4096
  ) {
    throw 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
  }
  try {
    $value = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
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
  $acceptedAt = [DateTimeOffset]::MinValue
  $acceptedAtValid = [DateTimeOffset]::TryParseExact(
    [string]$value.acceptedAt,
    "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
    [System.Globalization.CultureInfo]::InvariantCulture,
    [System.Globalization.DateTimeStyles]::AssumeUniversal -bor
      [System.Globalization.DateTimeStyles]::AdjustToUniversal,
    [ref]$acceptedAt
  )
  $canonicalAcceptedAt = $acceptedAt.ToUniversalTime().ToString(
    "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
    [System.Globalization.CultureInfo]::InvariantCulture
  )
  if (
    @(Compare-Object $keys $expectedKeys).Count -ne 0 -or
    $value.formatVersion -ne 1 -or
    $value.releaseChannel -cne 'pilot' -or
    [string]$value.appVersion -notmatch '^\d+\.\d+\.\d+$' -or
    [string]$value.buildRevision -cnotmatch '^[0-9a-f]{7,40}$' -or
    !$acceptedAtValid -or
    $canonicalAcceptedAt -cne [string]$value.acceptedAt
  ) {
    throw 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
  }
  return $value
}

function Read-W6bAcceptedBuild {
  param([Parameter(Mandatory = $true)][string]$UserDataPath)

  $paths = @(
    (Join-Path $UserDataPath 'update-state\accepted-build-v1.json'),
    (Join-Path $UserDataPath 'runtime\update-state\accepted-build-v1.json')
  )
  foreach ($path in $paths) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      return Read-W6bAcceptedBuildFile -Path $path
    }
  }
  return $null
}

function Find-W6bAuthoritativeInvoicePdf {
  param([Parameter(Mandatory = $true)][string]$StorageRoot)

  $files = @(
    Get-W6bSafeFilesUnderRoot -Root $StorageRoot `
      -FileName 'approved-invoice.pdf'
  )
  if ($files.Count -ne 1) {
    throw 'W6B_LEGACY_AUTHORITATIVE_PDF_COUNT_INVALID'
  }
  $file = $files[0]
  if ($file.Length -lt 5 -or $file.Length -gt 26214400) {
    throw 'W6B_LEGACY_AUTHORITATIVE_PDF_INVALID'
  }
  $stream = [System.IO.File]::OpenRead($file.FullName)
  try {
    $header = New-Object byte[] 5
    if ($stream.Read($header, 0, 5) -ne 5) {
      throw 'W6B_LEGACY_AUTHORITATIVE_PDF_INVALID'
    }
  }
  finally {
    $stream.Dispose()
  }
  if ([System.Text.Encoding]::ASCII.GetString($header) -cne '%PDF-') {
    throw 'W6B_LEGACY_AUTHORITATIVE_PDF_INVALID'
  }
  return [pscustomobject]@{
    FullName = (Resolve-Path -LiteralPath $file.FullName).Path
    RelativePath = Get-W6bRelativeContainedPath -Path $file.FullName `
      -Root $StorageRoot -Code 'W6B_LEGACY_AUTHORITATIVE_PDF_INVALID'
  }
}

function Start-W6bEkyProcess {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments,
    [Parameter(Mandatory = $true)][hashtable]$EnvironmentOverrides
  )

  $executablePath = Join-Path $installRoot 'Eky.exe'
  if (!(Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw 'W6B_LEGACY_EXECUTABLE_MISSING'
  }
  $previousValues = @{}
  try {
    foreach ($name in $EnvironmentOverrides.Keys) {
      $previousValues[$name] = [Environment]::GetEnvironmentVariable(
        $name,
        [EnvironmentVariableTarget]::Process
      )
      [Environment]::SetEnvironmentVariable(
        $name,
        $EnvironmentOverrides[$name],
        [EnvironmentVariableTarget]::Process
      )
    }
    return Start-Process -FilePath $executablePath `
      -ArgumentList $Arguments -PassThru
  }
  finally {
    foreach ($name in $EnvironmentOverrides.Keys) {
      [Environment]::SetEnvironmentVariable(
        $name,
        $previousValues[$name],
        [EnvironmentVariableTarget]::Process
      )
    }
  }
}

function Start-W6bIsolatedEkyProcess {
  if ($null -eq $userDataRoot) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }
  return Start-W6bEkyProcess -Arguments @(
    "--user-data-dir=`"$userDataRoot`""
  ) -EnvironmentOverrides @{
    APPDATA = $isolatedAppDataRoot
    ELECTRON_RUN_AS_NODE = $null
  }
}

function Read-W6bSourceSmokeResult {
  param([switch]$AllowMissing)

  if (!(Test-Path -LiteralPath $sourceSmokeResultPath -PathType Leaf)) {
    if ($AllowMissing) {
      return $null
    }
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_MISSING'
  }
  $metadata = Get-Item -LiteralPath $sourceSmokeResultPath -Force
  if (
    $metadata.PSIsContainer -or
    ($metadata.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or
    $metadata.Length -lt 1 -or
    $metadata.Length -gt 4096
  ) {
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
  }
  try {
    $value = Get-Content -LiteralPath $sourceSmokeResultPath -Raw `
      -Encoding UTF8 | ConvertFrom-Json
  }
  catch {
    if ($AllowMissing) {
      return $null
    }
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
  }
  if (
    [string]$value.stage -cnotin $script:AllowedSourceSmokeStages -or
    [string]$value.status -cnotin @('started', 'failed', 'ok')
  ) {
    throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
  }
  $keys = @($value.PSObject.Properties.Name | Sort-Object)
  if (
    $value.status -ceq 'started' -and
    @(Compare-Object $keys @('stage', 'status')).Count -eq 0
  ) {
    return $value
  }
  if (
    $value.status -ceq 'failed' -and
    @(Compare-Object $keys @('code', 'stage', 'status')).Count -eq 0 -and
    [string]$value.code -cmatch '^[A-Z][A-Z0-9_]{0,99}$'
  ) {
    return $value
  }
  if (
    $value.status -ceq 'ok' -and
    $value.stage -ceq 'shutdown' -and
    @(Compare-Object $keys @('electronVersion', 'stage', 'status')).Count `
      -eq 0 -and
    [string]$value.electronVersion -match '^\d+\.\d+\.\d+$'
  ) {
    return $value
  }
  throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
}

function Initialize-W6bSourceSmokeResult {
  $resultDirectory = Split-Path -Parent $sourceSmokeResultPath
  New-Item -ItemType Directory -Path $resultDirectory -Force | Out-Null
  $json = [ordered]@{
    stage = 'startup'
    status = 'started'
  } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText(
    $sourceSmokeResultPath,
    "$json`n",
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Update-W6bSourceSmokeObservations {
  param([Parameter(Mandatory = $true)]$Result)

  $script:SourceFailurePhase = [string]$Result.stage
  $stageIndex = $script:AllowedSourceSmokeStages.IndexOf(
    [string]$Result.stage
  )
  if (
    !$script:SourceBackendHealthObserved -and
    $stageIndex -ge $script:AllowedSourceSmokeStages.IndexOf('diagnostics')
  ) {
    $script:SourceBackendHealthObserved = $true
    Write-W6bLegacyReadinessObservation -Signal backendHealthReady
  }
  if (
    !$script:SourceRuntimeSessionObserved -and
    $stageIndex -ge
      $script:AllowedSourceSmokeStages.IndexOf('restoredSessionValidated')
  ) {
    $script:SourceRuntimeSessionObserved = $true
    Write-W6bLegacyReadinessObservation -Signal runtimeSessionValidated
  }
}

function Invoke-W6bSourcePackagedSmoke {
  New-Item -ItemType Directory -Path $sourceSmokeTempRoot -Force | Out-Null
  Initialize-W6bSourceSmokeResult
  $chain = Invoke-HistoricalPackagedSmokeProcessChain `
    -ExpectedExecutablePath (Join-Path $installRoot 'Eky.exe') `
    -StartPhase {
      param([string]$Phase)
      $arguments = if ($Phase -ceq 'initial') {
        @('--desktop-smoke')
      }
      elseif ($Phase -ceq 'restored') {
        @('--desktop-smoke', '--desktop-smoke-restored')
      }
      else {
        throw 'W6B_LEGACY_SOURCE_PROCESS_PHASE_INVALID'
      }
      Start-W6bEkyProcess -Arguments $arguments `
        -EnvironmentOverrides @{
          APPDATA = $isolatedAppDataRoot
          ELECTRON_ENABLE_SECURITY_WARNINGS = 'true'
          ELECTRON_RUN_AS_NODE = $null
          EKY_DESKTOP_SMOKE_TOKEN = $sourceSmokeToken
          TEMP = $sourceSmokeTempRoot
          TMP = $sourceSmokeTempRoot
        }
    } `
    -ReadResult { Read-W6bSourceSmokeResult -AllowMissing } `
    -ObserveResult {
      param($Result)
      Update-W6bSourceSmokeObservations -Result $Result
    } `
    -ObserveProcess {
      param($Process)
      if (!$script:SourceUtilityObserved) {
        $script:SourceUtilityObserved = Test-W6bUtilityDescendant `
          -RootProcessId $Process.Id
        if ($script:SourceUtilityObserved) {
          Write-W6bLegacyReadinessObservation -Signal backendUtilityReady
        }
      }
    } `
    -ValidateResult {
      param($Process, $Result, [string]$ExpectedStage, [string]$ExpectedStatus)
      if (
        $Process.ExitCode -ne 0 -or
        $Result.stage -cne $ExpectedStage -or
        $Result.status -cne $ExpectedStatus
      ) {
        throw 'W6B_LEGACY_SOURCE_SMOKE_FAILED'
      }
      if (
        $ExpectedStatus -ceq 'ok' -and
        [string]$Result.electronVersion -notmatch '^\d+\.\d+\.\d+$'
      ) {
        throw 'W6B_LEGACY_SOURCE_SMOKE_RESULT_INVALID'
      }
    }
  if (
    $chain.contract -cne 'explicitTwoPhase' -or
    $chain.initialGenerationCount -ne 1 -or
    $chain.restoredGenerationCount -ne 1 -or
    $chain.remainingOwnedProcessCount -ne 0
  ) {
    throw 'W6B_LEGACY_SOURCE_PROCESS_CHAIN_INVALID'
  }
  if (
    !$script:SourceUtilityObserved -or
    !$script:SourceBackendHealthObserved -or
    !$script:SourceRuntimeSessionObserved
  ) {
    throw 'W6B_LEGACY_SOURCE_SMOKE_READINESS_MISSING'
  }
}

function Wait-W6bEkyAccepted {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][string]$ExpectedRevision
  )

  if ($null -eq $userDataRoot) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }
  $databasePath = Join-Path $userDataRoot 'runtime\data\eky.sqlite'
  $accepted = $null
  $acceptedBuildObserved = $false
  $backendUtilityObserved = $false
  $databaseObserved = $false
  $readinessFailureCode = 'W6B_LEGACY_ACCEPTED_BUILD_MISSING'
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 250
    $Process.Refresh()
    if ($Process.HasExited) {
      throw 'W6B_LEGACY_APPLICATION_EXITED_EARLY'
    }
    if (!$databaseObserved -and (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
      $databaseObserved = $true
      Write-W6bLegacyReadinessObservation -Signal databaseReady
    }
    if (!$backendUtilityObserved) {
      $backendUtilityObserved = Test-W6bUtilityDescendant `
        -RootProcessId $Process.Id
      if ($backendUtilityObserved) {
        Write-W6bLegacyReadinessObservation -Signal backendUtilityReady
      }
    }
    $accepted = Read-W6bAcceptedBuild -UserDataPath $userDataRoot
    if ($null -eq $accepted) {
      $readinessFailureCode = 'W6B_LEGACY_ACCEPTED_BUILD_MISSING'
      continue
    }
    if (!$acceptedBuildObserved) {
      $acceptedBuildObserved = $true
      Write-W6bLegacyReadinessObservation -Signal acceptedBuildReady
    }
    if (
      $accepted.appVersion -ne $ExpectedVersion -or
      $accepted.buildRevision -ne $ExpectedRevision
    ) {
      $readinessFailureCode = 'W6B_LEGACY_ACCEPTED_BUILD_IDENTITY_MISMATCH'
      continue
    }
    if (!$backendUtilityObserved) {
      $readinessFailureCode = 'W6B_LEGACY_BACKEND_UTILITY_MISSING'
      continue
    }
    if (
      $script:CurrentStage -in @(
        'targetFirstStartup',
        'targetSecondStartup'
      )
    ) {
      Write-W6bLegacyReadinessObservation -Signal backendHealthReady
      Write-W6bLegacyReadinessObservation -Signal runtimeSessionValidated
    }
    return
  } while ([DateTime]::UtcNow -lt $deadline)
  if (!$databaseObserved) {
    throw 'W6B_LEGACY_DATABASE_MISSING_AT_STARTUP'
  }
  if (
    $null -ne $accepted -and
    $readinessFailureCode -eq 'W6B_LEGACY_ACCEPTED_BUILD_IDENTITY_MISMATCH'
  ) {
    throw $readinessFailureCode
  }
  if (!$backendUtilityObserved) {
    throw 'W6B_LEGACY_BACKEND_UTILITY_MISSING'
  }
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
    [string]$workspace.lineageIdentity.profileId `
      -cnotmatch $LineageProfileIdPattern
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
    $SourceBuildRevision -cnotmatch '^[0-9a-f]{40}$' -or
    $TargetBuildRevision -cnotmatch '^[0-9a-f]{7,40}$' -or
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
  Invoke-W6bSourcePackagedSmoke
  $sourceUserData = Resolve-W6bLegacySourceUserData `
    -SourceSmokeTempRoot $sourceSmokeTempRoot `
    -SourceSmokeToken $sourceSmokeToken `
    -ExpectedVersion $SourceAppVersion `
    -ExpectedRevision $SourceBuildRevision `
    -ReadAcceptedBuild {
      param([string]$Path)
      Read-W6bAcceptedBuildFile -Path $Path
    }
  $userDataRoot = $sourceUserData.Root
  Write-W6bLegacyReadinessObservation -Signal sourceUserDataReady
  $runningProcess = Start-W6bIsolatedEkyProcess
  Wait-W6bEkyAccepted -Process $runningProcess `
    -ExpectedVersion $SourceAppVersion `
    -ExpectedRevision $SourceBuildRevision
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
  $legacyDataInventory = Get-EkyDirectoryInventory -Root $legacyDataRoot
  $legacyStorageInventory = Get-EkyDirectoryInventory -Root $legacyStorageRoot
  if (
    $legacyDataInventory.Count -lt 1 -or
    $legacyStorageInventory.Count -lt 1
  ) {
    throw 'W6B_LEGACY_BUSINESS_FIXTURE_INVALID'
  }
  $legacyDatabaseHash = Get-EkyFileSha256 -Path $legacyDatabasePath
  $legacyPdfHash = Get-EkyFileSha256 -Path $legacyPdfPath
  $script:SourceBusinessFixtureObserved = $true
  Write-W6bLegacyReadinessObservation -Signal legacyBusinessFixtureReady
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
    $legacyPdfRelativePath
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
  orphanProcessCount = 0
} | ConvertTo-Json -Compress

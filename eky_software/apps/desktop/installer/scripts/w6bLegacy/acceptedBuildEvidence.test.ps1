Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'evidence.ps1')

$sourceVersion = '0.2.6'
$sourceRevision = '6ed99f5319c3'
$targetVersion = '0.2.7'
$targetRevision = '147ba4c29d79'
$root = Join-Path $env:TEMP (
  'eky-w6b-accepted-evidence-' + [guid]::NewGuid().ToString('N')
)

function Assert-TestEqual {
  param(
    [Parameter(Mandatory = $true)]$Actual,
    [Parameter(Mandatory = $true)]$Expected,
    [Parameter(Mandatory = $true)][string]$Code
  )
  if ($Actual -cne $Expected) { throw $Code }
}

function Write-TestAcceptedBuild {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$Revision
  )
  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) `
    -Force | Out-Null
  $value = [ordered]@{
    acceptedAt = '2026-08-24T00:00:00.000Z'
    appVersion = $Version
    buildRevision = $Revision
    formatVersion = 1
    releaseChannel = 'pilot'
  } | ConvertTo-Json
  [System.IO.File]::WriteAllText(
    $Path,
    $value,
    (New-Object System.Text.UTF8Encoding($false))
  )
}

function Read-TestSlots {
  return Read-W6bAcceptedBuildIdentitySlots -UserDataPath $root `
    -SourceVersion $sourceVersion -SourceRevision $sourceRevision `
    -TargetVersion $targetVersion -TargetRevision $targetRevision
}

try {
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  $currentPath = Join-Path $root 'update-state\accepted-build-v1.json'
  $legacyPath = Join-Path $root `
    'runtime\update-state\accepted-build-v1.json'

  $slots = Read-TestSlots
  Assert-TestEqual $slots.Current 'missing' 'W6B_TEST_CURRENT_MISSING_FAILED'
  Assert-TestEqual $slots.Legacy 'missing' 'W6B_TEST_LEGACY_MISSING_FAILED'

  Write-TestAcceptedBuild -Path $currentPath -Version $targetVersion `
    -Revision $targetRevision
  Write-TestAcceptedBuild -Path $legacyPath -Version $sourceVersion `
    -Revision $sourceRevision
  $slots = Read-TestSlots
  Assert-TestEqual $slots.Current 'targetIdentity' `
    'W6B_TEST_CURRENT_TARGET_FAILED'
  Assert-TestEqual $slots.Legacy 'sourceIdentity' `
    'W6B_TEST_LEGACY_SOURCE_FAILED'

  Write-TestAcceptedBuild -Path $currentPath -Version $targetVersion `
    -Revision 'aaaaaaaaaaaa'
  $slots = Read-TestSlots
  Assert-TestEqual $slots.Current 'targetVersionDifferentRevision' `
    'W6B_TEST_TARGET_REVISION_CLASS_FAILED'

  [System.IO.File]::WriteAllText(
    $currentPath,
    '{invalid',
    (New-Object System.Text.UTF8Encoding($false))
  )
  $slots = Read-TestSlots
  Assert-TestEqual $slots.Current 'invalid' 'W6B_TEST_INVALID_CLASS_FAILED'

  [ordered]@{
    status = 'succeeded'
    currentAndLegacyClassifiedSeparately = $true
    targetRevisionMismatchDistinguished = $true
    invalidMetadataRejected = $true
  } | ConvertTo-Json -Compress
}
finally {
  Remove-Item -LiteralPath $root -Force -Recurse -ErrorAction SilentlyContinue
}

Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'nativeWindowsPath.ps1')

function Test-W6bCanonicalPathContained {
  param(
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $normalizedRoot = $Root.TrimEnd('\')
  return (
    $Candidate.Equals(
      $normalizedRoot,
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    $Candidate.StartsWith(
      "$normalizedRoot\",
      [StringComparison]::OrdinalIgnoreCase
    )
  )
}

function Assert-W6bPathSegmentsAreRegular {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$Code
  )

  if (!(Test-W6bCanonicalPathContained -Candidate $Candidate -Root $Root)) {
    throw $Code
  }
  $relative = $Candidate.Substring($Root.TrimEnd('\').Length).TrimStart('\')
  $segments = @($relative.Split('\') | Where-Object { $_ -ne '' })
  $current = $Root.TrimEnd('\')
  $paths = @($current)
  foreach ($segment in $segments) {
    $current = Join-Path $current $segment
    $paths += $current
  }
  foreach ($path in $paths) {
    $metadata = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if ($metadata.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw $Code
    }
  }
}

function Resolve-W6bLegacySourceUserData {
  param(
    [Parameter(Mandatory = $true)][string]$SourceSmokeTempRoot,
    [Parameter(Mandatory = $true)][string]$SourceSmokeToken,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][string]$ExpectedRevision,
    [Parameter(Mandatory = $true)][scriptblock]$ReadAcceptedBuild
  )

  if (
    $SourceSmokeToken -cnotmatch '^[0-9a-f]{32}$' -or
    $ExpectedVersion -cnotmatch '^\d+\.\d+\.\d+$' -or
    $ExpectedRevision -cnotmatch '^[0-9a-f]{7,40}$'
  ) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INPUT_INVALID'
  }

  try {
    $smokeTempMetadata = Get-Item -LiteralPath $SourceSmokeTempRoot `
      -Force -ErrorAction Stop
  }
  catch {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }
  if (
    !$smokeTempMetadata.PSIsContainer -or
    ($smokeTempMetadata.Attributes -band [IO.FileAttributes]::ReparsePoint)
  ) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }
  $canonicalSmokeTempRoot = Resolve-W6bCanonicalExistingPath `
    -Path $SourceSmokeTempRoot `
    -Code 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  $expectedUserDataPath = Join-Path `
    (Join-Path `
      (Join-Path $canonicalSmokeTempRoot 'eky-desktop-smoke') `
      $SourceSmokeToken) `
    'user-data'
  Assert-W6bPathSegmentsAreRegular `
    -Root $canonicalSmokeTempRoot `
    -Candidate ([IO.Path]::GetFullPath($expectedUserDataPath)) `
    -Code 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  $canonicalUserDataPath = Resolve-W6bCanonicalExistingPath `
    -Path $expectedUserDataPath `
    -Code 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  if (
    !(Test-W6bCanonicalPathContained `
      -Candidate $canonicalUserDataPath `
      -Root $canonicalSmokeTempRoot)
  ) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }

  $relativeUserDataPath = $canonicalUserDataPath.Substring(
    $canonicalSmokeTempRoot.TrimEnd('\').Length
  ).TrimStart('\')
  $expectedRelativePath = Join-Path `
    (Join-Path 'eky-desktop-smoke' $SourceSmokeToken) `
    'user-data'
  if ($relativeUserDataPath -cne $expectedRelativePath) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }

  $acceptedLocations = @(
    [pscustomobject]@{
      Classification = 'current'
      Path = Join-Path $canonicalUserDataPath `
        'update-state\accepted-build-v1.json'
    },
    [pscustomobject]@{
      Classification = 'legacy'
      Path = Join-Path $canonicalUserDataPath `
        'runtime\update-state\accepted-build-v1.json'
    }
  )
  $presentLocations = @(
    $acceptedLocations | Where-Object {
      Test-Path -LiteralPath $_.Path
    }
  )
  if ($presentLocations.Count -ne 1) {
    throw 'W6B_LEGACY_ACCEPTED_BUILD_COUNT_INVALID'
  }
  $acceptedLocation = $presentLocations[0]
  Assert-W6bPathSegmentsAreRegular `
    -Root $canonicalUserDataPath `
    -Candidate ([IO.Path]::GetFullPath($acceptedLocation.Path)) `
    -Code 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
  $acceptedPath = Resolve-W6bCanonicalExistingPath `
    -Path $acceptedLocation.Path `
    -Code 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
  if (
    !(Test-W6bCanonicalPathContained `
      -Candidate $acceptedPath `
      -Root $canonicalUserDataPath)
  ) {
    throw 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
  }
  $acceptedMetadata = Get-Item -LiteralPath $acceptedPath -Force
  if ($acceptedMetadata.PSIsContainer) {
    throw 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
  }

  $accepted = & $ReadAcceptedBuild $acceptedPath
  if (
    $null -eq $accepted -or
    [string]$accepted.appVersion -cne $ExpectedVersion -or
    [string]$accepted.buildRevision -cne $ExpectedRevision
  ) {
    throw 'W6B_LEGACY_ACCEPTED_BUILD_IDENTITY_MISMATCH'
  }

  return [pscustomobject]@{
    AcceptedBuild = $accepted
    AcceptedBuildLocation = $acceptedLocation.Classification
    Root = $canonicalUserDataPath
  }
}

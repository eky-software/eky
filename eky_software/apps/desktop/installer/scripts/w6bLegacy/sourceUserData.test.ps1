Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'sourceUserData.ps1')

function Assert-EkyW6bEqual {
  param(
    [Parameter(Mandatory = $true)]$Actual,
    [Parameter(Mandatory = $true)]$Expected,
    [Parameter(Mandatory = $true)][string]$Code
  )

  if ($Actual -cne $Expected) {
    throw $Code
  }
}

function Assert-EkyW6bThrows {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$ExpectedCode
  )

  try {
    & $Action
  }
  catch {
    if ([string]$_.Exception.Message -cne $ExpectedCode) {
      throw 'W6B_SOURCE_USER_DATA_TEST_WRONG_ERROR'
    }
    return
  }
  throw 'W6B_SOURCE_USER_DATA_TEST_ERROR_MISSING'
}

function New-EkyW6bAcceptedBuild {
  param(
    [Parameter(Mandatory = $true)][string]$UserDataRoot,
    [Parameter(Mandatory = $true)][ValidateSet('current', 'legacy')]
    [string]$Location,
    [string]$Version = '0.2.6',
    [string]$Revision = '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032'
  )

  $relativePath = if ($Location -ceq 'current') {
    'update-state\accepted-build-v1.json'
  }
  else {
    'runtime\update-state\accepted-build-v1.json'
  }
  $path = Join-Path $UserDataRoot $relativePath
  [IO.Directory]::CreateDirectory((Split-Path -Parent $path)) | Out-Null
  $value = [ordered]@{
    appVersion = $Version
    buildRevision = $Revision
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText(
    $path,
    "$value`n",
    [Text.UTF8Encoding]::new($false)
  )
  return $path
}

function Read-EkyW6bAcceptedBuildFixture {
  param([Parameter(Mandatory = $true)][string]$Path)

  return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
    ConvertFrom-Json
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) `
  ('eky-w6b-user-data-' + [Guid]::NewGuid().ToString('N'))
$smokeTempRoot = Join-Path $testRoot 'source smoke temp'
$token = 'a' * 32
$userDataRoot = Join-Path `
  (Join-Path (Join-Path $smokeTempRoot 'eky-desktop-smoke') $token) `
  'user-data'
$outsideRoot = Join-Path $testRoot 'outside'

try {
  [IO.Directory]::CreateDirectory($userDataRoot) | Out-Null
  [IO.Directory]::CreateDirectory($outsideRoot) | Out-Null
  New-EkyW6bAcceptedBuild -UserDataRoot $userDataRoot -Location current |
    Out-Null

  $resolved = Resolve-W6bLegacySourceUserData `
    -SourceSmokeTempRoot $smokeTempRoot `
    -SourceSmokeToken $token `
    -ExpectedVersion '0.2.6' `
    -ExpectedRevision '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032' `
    -ReadAcceptedBuild ${function:Read-EkyW6bAcceptedBuildFixture}
  Assert-EkyW6bEqual -Actual $resolved.Root `
    -Expected (Resolve-W6bCanonicalExistingPath `
      -Path $userDataRoot -Code 'W6B_SOURCE_USER_DATA_TEST_FAILED') `
    -Code 'W6B_SOURCE_USER_DATA_TEST_DETERMINISTIC_ROOT_FAILED'
  Assert-EkyW6bEqual -Actual $resolved.AcceptedBuildLocation `
    -Expected current `
    -Code 'W6B_SOURCE_USER_DATA_TEST_CURRENT_LOCATION_FAILED'

  $aliasedSmokeRoot = Join-Path $smokeTempRoot '..\source smoke temp'
  $aliased = Resolve-W6bLegacySourceUserData `
    -SourceSmokeTempRoot $aliasedSmokeRoot `
    -SourceSmokeToken $token `
    -ExpectedVersion '0.2.6' `
    -ExpectedRevision '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032' `
    -ReadAcceptedBuild ${function:Read-EkyW6bAcceptedBuildFixture}
  Assert-EkyW6bEqual -Actual $aliased.Root -Expected $resolved.Root `
    -Code 'W6B_SOURCE_USER_DATA_TEST_ALIAS_FAILED'

  foreach ($invalidToken in @(
    ('A' * 32),
    ('a' * 31),
    ('a' * 33),
    '../escape'
  )) {
    Assert-EkyW6bThrows -ExpectedCode `
      'W6B_LEGACY_SOURCE_USER_DATA_INPUT_INVALID' -Action {
        Resolve-W6bLegacySourceUserData `
          -SourceSmokeTempRoot $smokeTempRoot `
          -SourceSmokeToken $invalidToken `
          -ExpectedVersion '0.2.6' `
          -ExpectedRevision '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032' `
          -ReadAcceptedBuild ${function:Read-EkyW6bAcceptedBuildFixture}
      }
  }

  $wrongIdentityRoot = Join-Path $testRoot 'wrong-identity-smoke'
  $wrongIdentityUserData = Join-Path `
    (Join-Path (Join-Path $wrongIdentityRoot 'eky-desktop-smoke') $token) `
    'user-data'
  [IO.Directory]::CreateDirectory($wrongIdentityUserData) | Out-Null
  New-EkyW6bAcceptedBuild -UserDataRoot $wrongIdentityUserData `
    -Location current -Revision ('b' * 40) | Out-Null
  Assert-EkyW6bThrows -ExpectedCode `
    'W6B_LEGACY_ACCEPTED_BUILD_IDENTITY_MISMATCH' -Action {
      Resolve-W6bLegacySourceUserData `
        -SourceSmokeTempRoot $wrongIdentityRoot `
        -SourceSmokeToken $token `
        -ExpectedVersion '0.2.6' `
        -ExpectedRevision '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032' `
        -ReadAcceptedBuild ${function:Read-EkyW6bAcceptedBuildFixture}
    }

  $wrongLocationRoot = Join-Path $testRoot 'wrong-location-smoke'
  $wrongLocationUserData = Join-Path `
    (Join-Path (Join-Path $wrongLocationRoot 'eky-desktop-smoke') $token) `
    'user-data'
  [IO.Directory]::CreateDirectory($wrongLocationUserData) | Out-Null
  $wrongPath = Join-Path $wrongLocationUserData `
    'other\accepted-build-v1.json'
  [IO.Directory]::CreateDirectory((Split-Path -Parent $wrongPath)) |
    Out-Null
  [IO.File]::WriteAllText($wrongPath, '{}')
  Assert-EkyW6bThrows -ExpectedCode `
    'W6B_LEGACY_ACCEPTED_BUILD_COUNT_INVALID' -Action {
      Resolve-W6bLegacySourceUserData `
        -SourceSmokeTempRoot $wrongLocationRoot `
        -SourceSmokeToken $token `
        -ExpectedVersion '0.2.6' `
        -ExpectedRevision '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032' `
        -ReadAcceptedBuild ${function:Read-EkyW6bAcceptedBuildFixture}
    }

  $duplicateRoot = Join-Path $testRoot 'duplicate-smoke'
  $duplicateUserData = Join-Path `
    (Join-Path (Join-Path $duplicateRoot 'eky-desktop-smoke') $token) `
    'user-data'
  [IO.Directory]::CreateDirectory($duplicateUserData) | Out-Null
  New-EkyW6bAcceptedBuild -UserDataRoot $duplicateUserData `
    -Location current | Out-Null
  New-EkyW6bAcceptedBuild -UserDataRoot $duplicateUserData `
    -Location legacy | Out-Null
  Assert-EkyW6bThrows -ExpectedCode `
    'W6B_LEGACY_ACCEPTED_BUILD_COUNT_INVALID' -Action {
      Resolve-W6bLegacySourceUserData `
        -SourceSmokeTempRoot $duplicateRoot `
        -SourceSmokeToken $token `
        -ExpectedVersion '0.2.6' `
        -ExpectedRevision '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032' `
        -ReadAcceptedBuild ${function:Read-EkyW6bAcceptedBuildFixture}
    }

  $legacyRoot = Join-Path $testRoot 'legacy-smoke'
  $legacyUserData = Join-Path `
    (Join-Path (Join-Path $legacyRoot 'eky-desktop-smoke') $token) `
    'user-data'
  [IO.Directory]::CreateDirectory($legacyUserData) | Out-Null
  New-EkyW6bAcceptedBuild -UserDataRoot $legacyUserData -Location legacy |
    Out-Null
  $legacy = Resolve-W6bLegacySourceUserData `
    -SourceSmokeTempRoot $legacyRoot `
    -SourceSmokeToken $token `
    -ExpectedVersion '0.2.6' `
    -ExpectedRevision '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032' `
    -ReadAcceptedBuild ${function:Read-EkyW6bAcceptedBuildFixture}
  Assert-EkyW6bEqual -Actual $legacy.AcceptedBuildLocation `
    -Expected legacy `
    -Code 'W6B_SOURCE_USER_DATA_TEST_LEGACY_LOCATION_FAILED'

  $reparseRoot = Join-Path $testRoot 'reparse-smoke'
  [IO.Directory]::CreateDirectory($reparseRoot) | Out-Null
  $junction = Join-Path $reparseRoot 'eky-desktop-smoke'
  New-Item -ItemType Junction -Path $junction -Target $outsideRoot |
    Out-Null
  $outsideUserData = Join-Path (Join-Path $outsideRoot $token) 'user-data'
  [IO.Directory]::CreateDirectory($outsideUserData) | Out-Null
  New-EkyW6bAcceptedBuild -UserDataRoot $outsideUserData -Location current |
    Out-Null
  Assert-EkyW6bThrows -ExpectedCode `
    'W6B_LEGACY_SOURCE_USER_DATA_INVALID' -Action {
      Resolve-W6bLegacySourceUserData `
        -SourceSmokeTempRoot $reparseRoot `
        -SourceSmokeToken $token `
        -ExpectedVersion '0.2.6' `
        -ExpectedRevision '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032' `
        -ReadAcceptedBuild ${function:Read-EkyW6bAcceptedBuildFixture}
    }

  $reparseSourceRoot = Join-Path $testRoot 'reparse-source-root'
  New-Item -ItemType Junction -Path $reparseSourceRoot `
    -Target $smokeTempRoot | Out-Null
  Assert-EkyW6bThrows -ExpectedCode `
    'W6B_LEGACY_SOURCE_USER_DATA_INVALID' -Action {
      Resolve-W6bLegacySourceUserData `
        -SourceSmokeTempRoot $reparseSourceRoot `
        -SourceSmokeToken $token `
        -ExpectedVersion '0.2.6' `
        -ExpectedRevision '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032' `
        -ReadAcceptedBuild ${function:Read-EkyW6bAcceptedBuildFixture}
    }

  [ordered]@{
    acceptedBuildLocations = 'currentAndLegacy'
    deterministicUserDataRoot = $true
    pathAliasesCanonicalized = $true
    reparsePointRejected = $true
    status = 'succeeded'
  } | ConvertTo-Json -Compress
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Force -Recurse
  }
}

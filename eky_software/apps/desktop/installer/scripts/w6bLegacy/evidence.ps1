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

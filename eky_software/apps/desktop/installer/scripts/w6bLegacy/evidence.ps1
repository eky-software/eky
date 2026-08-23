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

function ConvertTo-W6bExtendedLengthPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (
    $fullPath -cnotmatch '^[A-Za-z]:\\' -or
    !$fullPath.Equals($Path, [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    throw 'W6B_LEGACY_EVIDENCE_PATH_INVALID'
  }
  return "\\?\$fullPath"
}

function Remove-W6bLegacyAcceptanceTestRoot {
  param([Parameter(Mandatory = $true)][string]$Root)

  $canonicalTempRoot = [System.IO.Path]::GetFullPath(
    [System.IO.Path]::GetTempPath()
  ).TrimEnd('\')
  $canonicalRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  if (
    ![System.IO.Path]::GetDirectoryName($canonicalRoot).Equals(
      $canonicalTempRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    ) -or
    [System.IO.Path]::GetFileName($canonicalRoot) -cnotmatch `
      '^w6-[0-9a-f]{12}$'
  ) {
    throw 'W6B_LEGACY_TEST_ROOT_INVALID'
  }

  $extendedRoot = ConvertTo-W6bExtendedLengthPath -Path $canonicalRoot
  if (![System.IO.Directory]::Exists($extendedRoot)) {
    return
  }
  $rootItem = Get-Item -LiteralPath $extendedRoot -Force
  if (
    !$rootItem.PSIsContainer -or
    ($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
  ) {
    throw 'W6B_LEGACY_TEST_ROOT_INVALID'
  }

  # Validate the complete tree before mutating the harness-owned root.
  [void](Get-W6bEvidenceDirectoryInventory -Root $canonicalRoot)

  $directories = [System.Collections.Generic.List[object]]::new()
  $pendingDirectories = [System.Collections.Generic.Queue[object]]::new()
  $directories.Add($rootItem)
  $pendingDirectories.Enqueue($rootItem)
  while ($pendingDirectories.Count -gt 0) {
    $directory = $pendingDirectories.Dequeue()
    foreach ($item in @(Get-ChildItem -LiteralPath $directory.FullName -Force)) {
      if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw 'W6B_LEGACY_TEST_ROOT_INVALID'
      }
      $canonicalItemPath = if ($item.FullName.StartsWith('\\?\')) {
        $item.FullName.Substring(4)
      }
      else {
        $item.FullName
      }
      if (
        !$canonicalItemPath.StartsWith(
          "$canonicalRoot\",
          [System.StringComparison]::OrdinalIgnoreCase
        )
      ) {
        throw 'W6B_LEGACY_TEST_ROOT_INVALID'
      }
      if ($item.PSIsContainer) {
        $directories.Add($item)
        $pendingDirectories.Enqueue($item)
        continue
      }
      $attributes = [System.IO.File]::GetAttributes($item.FullName)
      if ($attributes -band [System.IO.FileAttributes]::ReadOnly) {
        [System.IO.File]::SetAttributes(
          $item.FullName,
          $attributes -bxor [System.IO.FileAttributes]::ReadOnly
        )
      }
      [System.IO.File]::Delete($item.FullName)
    }
  }

  for ($index = $directories.Count - 1; $index -ge 0; $index -= 1) {
    $directory = $directories[$index]
    $attributes = [System.IO.File]::GetAttributes($directory.FullName)
    if ($attributes -band [System.IO.FileAttributes]::ReadOnly) {
      [System.IO.File]::SetAttributes(
        $directory.FullName,
        $attributes -bxor [System.IO.FileAttributes]::ReadOnly
      )
    }
    [System.IO.Directory]::Delete($directory.FullName, $false)
  }
  if ([System.IO.Directory]::Exists($extendedRoot)) {
    throw 'W6B_LEGACY_TEST_ROOT_CLEANUP_FAILED'
  }
}

function Get-W6bEvidenceDirectoryInventory {
  param([Parameter(Mandatory = $true)][string]$Root)

  $canonicalRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  $extendedRoot = ConvertTo-W6bExtendedLengthPath -Path $canonicalRoot
  if (!(Test-Path -LiteralPath $extendedRoot -PathType Container)) {
    return ,@()
  }
  $rootItem = Get-Item -LiteralPath $extendedRoot -Force
  if ($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw 'W6B_LEGACY_EVIDENCE_PATH_INVALID'
  }

  $directories = [System.Collections.Generic.Queue[object]]::new()
  $directories.Enqueue($rootItem)
  $inventory = @()
  while ($directories.Count -gt 0) {
    $directory = $directories.Dequeue()
    foreach ($item in @(Get-ChildItem -LiteralPath $directory.FullName -Force)) {
      if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw 'W6B_LEGACY_EVIDENCE_PATH_INVALID'
      }
      if ($item.PSIsContainer) {
        $directories.Enqueue($item)
        continue
      }
      $canonicalFilePath = if ($item.FullName.StartsWith('\\?\')) {
        $item.FullName.Substring(4)
      }
      else {
        $item.FullName
      }
      if (
        !$canonicalFilePath.StartsWith(
          "$canonicalRoot\",
          [System.StringComparison]::OrdinalIgnoreCase
        )
      ) {
        throw 'W6B_LEGACY_EVIDENCE_PATH_INVALID'
      }
      $relativePath = $canonicalFilePath.Substring(
        $canonicalRoot.Length
      ).TrimStart('\')
      $hash = Get-W6bEvidenceFileSha256 -Path $canonicalFilePath
      $inventory += "$relativePath|$($item.Length)|$hash"
    }
  }
  return ,@($inventory | Sort-Object)
}

function Get-W6bEvidenceFileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  return Get-EkyFileSha256 -Path (
    ConvertTo-W6bExtendedLengthPath -Path $Path
  )
}

function Get-W6bWorkspaceRegistryInventory {
  param([Parameter(Mandatory = $true)][string]$UserDataRoot)

  $canonicalRoot = [System.IO.Path]::GetFullPath($UserDataRoot).TrimEnd('\')
  $registryPath = Join-Path $canonicalRoot 'workspace-registry-v1.json'
  $extendedRegistryPath = ConvertTo-W6bExtendedLengthPath -Path $registryPath
  if (!(Test-Path -LiteralPath $extendedRegistryPath -PathType Leaf)) {
    throw 'W6B_LEGACY_WORKSPACE_REGISTRY_MISSING'
  }
  $metadata = Get-Item -LiteralPath $extendedRegistryPath -Force
  if (
    $metadata.PSIsContainer -or
    ($metadata.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or
    $metadata.Length -lt 1 -or
    $metadata.Length -gt 1048576
  ) {
    throw 'W6B_LEGACY_WORKSPACE_REGISTRY_INVALID'
  }
  $hash = Get-W6bEvidenceFileSha256 -Path $registryPath
  return ,@("workspace-registry-v1.json|$($metadata.Length)|$hash")
}

function Read-W6bAcceptedBuildSlot {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
    return [pscustomobject]@{ State = 'missing'; Value = $null }
  }
  try {
    $value = Read-W6bAcceptedBuildFile -Path $Path
  }
  catch {
    return [pscustomobject]@{ State = 'invalid'; Value = $null }
  }
  return [pscustomobject]@{ State = 'present'; Value = $value }
}

function Get-W6bAcceptedBuildIdentityClass {
  param(
    [Parameter(Mandatory = $true)]$Slot,
    [Parameter(Mandatory = $true)][string]$SourceVersion,
    [Parameter(Mandatory = $true)][string]$SourceRevision,
    [Parameter(Mandatory = $true)][string]$TargetVersion,
    [Parameter(Mandatory = $true)][string]$TargetRevision
  )

  if ($Slot.State -eq 'missing') { return 'missing' }
  if ($Slot.State -eq 'invalid') { return 'invalid' }
  if ($Slot.State -ne 'present' -or $null -eq $Slot.Value) {
    return 'invalid'
  }
  if (
    $Slot.Value.appVersion -ceq $SourceVersion -and
    $Slot.Value.buildRevision -ceq $SourceRevision
  ) {
    return 'sourceIdentity'
  }
  if (
    $Slot.Value.appVersion -ceq $TargetVersion -and
    $Slot.Value.buildRevision -ceq $TargetRevision
  ) {
    return 'targetIdentity'
  }
  if ($Slot.Value.appVersion -ceq $TargetVersion) {
    return 'targetVersionDifferentRevision'
  }
  return 'otherIdentity'
}

function Read-W6bAcceptedBuildIdentitySlots {
  param(
    [Parameter(Mandatory = $true)][string]$UserDataPath,
    [Parameter(Mandatory = $true)][string]$SourceVersion,
    [Parameter(Mandatory = $true)][string]$SourceRevision,
    [Parameter(Mandatory = $true)][string]$TargetVersion,
    [Parameter(Mandatory = $true)][string]$TargetRevision
  )

  $currentSlot = Read-W6bAcceptedBuildSlot -Path (
    Join-Path $UserDataPath 'update-state\accepted-build-v1.json'
  )
  $legacySlot = Read-W6bAcceptedBuildSlot -Path (
    Join-Path $UserDataPath 'runtime\update-state\accepted-build-v1.json'
  )
  return [pscustomobject]@{
    Current = Get-W6bAcceptedBuildIdentityClass -Slot $currentSlot `
      -SourceVersion $SourceVersion -SourceRevision $SourceRevision `
      -TargetVersion $TargetVersion -TargetRevision $TargetRevision
    Legacy = Get-W6bAcceptedBuildIdentityClass -Slot $legacySlot `
      -SourceVersion $SourceVersion -SourceRevision $SourceRevision `
      -TargetVersion $TargetVersion -TargetRevision $TargetRevision
  }
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

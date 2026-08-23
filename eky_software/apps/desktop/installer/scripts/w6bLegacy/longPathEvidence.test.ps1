Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\windowsInstallerTestSupport.ps1')
. (Join-Path $PSScriptRoot 'evidence.ps1')

$root = Join-Path $env:TEMP (
  'w6-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
)
$workspaceId = '00000000-0000-4000-8000-000000000000'
$companyId = 'local-company-' + ('0' * 32)
$invoiceId = '11111111-1111-4111-8111-111111111111'
$userDataRoot = Join-Path $root (
  "s\eky-desktop-smoke\$('2' * 32)\user-data"
)
$storageRoot = Join-Path $userDataRoot (
  "workspaces\$workspaceId\runtime\storage"
)
$relativePath = Join-Path 'invoices' (
  Join-Path $companyId (Join-Path $invoiceId 'approved-invoice.pdf')
)
$filePath = Join-Path $storageRoot $relativePath
$registryPath = Join-Path $userDataRoot 'workspace-registry-v1.json'
$extendedFilePath = ConvertTo-W6bExtendedLengthPath -Path $filePath
$extendedRegistryPath = ConvertTo-W6bExtendedLengthPath -Path $registryPath
$extendedRoot = ConvertTo-W6bExtendedLengthPath -Path $root
$result = $null

try {
  if ($filePath.Length -le 260) {
    throw 'W6B_LONG_PATH_TEST_FIXTURE_TOO_SHORT'
  }
  [System.IO.Directory]::CreateDirectory(
    [System.IO.Path]::GetDirectoryName($extendedFilePath)
  ) | Out-Null
  [System.IO.File]::WriteAllText(
    $extendedFilePath,
    '%PDF-synthetic-long-path',
    (New-Object System.Text.UTF8Encoding($false))
  )
  [System.IO.File]::WriteAllText(
    $extendedRegistryPath,
    '{"formatVersion":1}',
    (New-Object System.Text.UTF8Encoding($false))
  )

  $inventory = @(Get-W6bEvidenceDirectoryInventory -Root $storageRoot)
  if ($inventory.Count -ne 1) {
    throw 'W6B_LONG_PATH_INVENTORY_COUNT_FAILED'
  }
  if (
    !$inventory[0].StartsWith(
      "$relativePath|",
      [System.StringComparison]::Ordinal
    )
  ) {
    throw 'W6B_LONG_PATH_INVENTORY_RELATIVE_PATH_FAILED'
  }
  $hash = Get-W6bEvidenceFileSha256 -Path $filePath
  if ($hash -cnotmatch '^[0-9A-F]{64}$') {
    throw 'W6B_LONG_PATH_HASH_FAILED'
  }
  $registryInventory = @(
    Get-W6bWorkspaceRegistryInventory -UserDataRoot $userDataRoot
  )
  if (
    $registryInventory.Count -ne 1 -or
    !$registryInventory[0].StartsWith(
      'workspace-registry-v1.json|',
      [System.StringComparison]::Ordinal
    )
  ) {
    throw 'W6B_LONG_PATH_REGISTRY_EVIDENCE_FAILED'
  }

  $invalidCleanupRootRejected = $false
  try {
    Remove-W6bLegacyAcceptanceTestRoot -Root (
      Join-Path $env:TEMP 'eky-w6b-invalid-cleanup-root'
    )
  }
  catch {
    if ($_.Exception.Message -cne 'W6B_LEGACY_TEST_ROOT_INVALID') {
      throw
    }
    $invalidCleanupRootRejected = $true
  }
  if (!$invalidCleanupRootRejected) {
    throw 'W6B_LONG_PATH_INVALID_CLEANUP_ROOT_NOT_REJECTED'
  }

  [System.IO.File]::SetAttributes(
    $extendedFilePath,
    [System.IO.File]::GetAttributes($extendedFilePath) -bor
      [System.IO.FileAttributes]::ReadOnly
  )

  $result = [ordered]@{
    status = 'succeeded'
    longPathInventoryValidated = $true
    longPathHashValidated = $true
    registryEvidenceValidated = $true
    invalidCleanupRootRejected = $true
  }
}
finally {
  if ([System.IO.Directory]::Exists($extendedRoot)) {
    Remove-W6bLegacyAcceptanceTestRoot -Root $root
  }
}

if ([System.IO.Directory]::Exists($extendedRoot)) {
  throw 'W6B_LONG_PATH_CLEANUP_FAILED'
}
$result.longPathCleanupValidated = $true
$result.readOnlyCleanupValidated = $true
$result | ConvertTo-Json -Compress

param(
  [ValidateSet('success', 'safeFailure')]
  [string]$TestCase = 'success'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\windowsInstallerTestSupport.ps1')
. (Join-Path $PSScriptRoot 'evidence.ps1')

function Get-W6bLongPathSafeErrorCode {
  param([Parameter(Mandatory = $true)]$ErrorRecord)

  $allowedCodes = @()
  $exception = $ErrorRecord.Exception
  while ($null -ne $exception) {
    $message = [string]$exception.Message
    if ($message -cmatch '^W6B_[A-Z0-9_]+$') {
      $allowedCodes += $message
    }
    $exception = $exception.InnerException
  }
  if ($allowedCodes.Count -eq 1) {
    return $allowedCodes[0]
  }
  return 'W6B_LONG_PATH_TEST_FAILED'
}

$root = Join-Path $env:TEMP (
  'w6-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
)
$workspaceId = '00000000-0000-4000-8000-000000000000'
$companyId = 'local-company-' + ('0' * 32)
$invoiceId = '11111111-1111-4111-8111-111111111111'
$relativePath = Join-Path 'invoices' (
  Join-Path $companyId (Join-Path $invoiceId 'approved-invoice.pdf')
)
$paddingRoot = $root
do {
  $userDataRoot = Join-Path $paddingRoot (
    "s\eky-desktop-smoke\$('2' * 32)\user-data"
  )
  $storageRoot = Join-Path $userDataRoot (
    "workspaces\$workspaceId\runtime\storage"
  )
  $filePath = Join-Path $storageRoot $relativePath
  if ($filePath.Length -ge 320) {
    break
  }
  $requiredSegmentLength = 320 - $filePath.Length - 1
  $paddingSegmentLength = [Math]::Max(
    8,
    [Math]::Min(48, $requiredSegmentLength)
  )
  $paddingRoot = Join-Path $paddingRoot ('p' * $paddingSegmentLength)
} while ($true)
$registryPath = Join-Path $userDataRoot 'workspace-registry-v1.json'
$extendedFilePath = ConvertTo-W6bExtendedLengthPath -Path $filePath
$extendedRegistryPath = ConvertTo-W6bExtendedLengthPath -Path $registryPath
$extendedRoot = ConvertTo-W6bExtendedLengthPath -Path $root
$result = $null
$terminalError = $null
$reparseProbe = $null

try {
  if ($TestCase -ceq 'safeFailure') {
    throw 'W6B_LONG_PATH_SAFE_FAILURE_FIXTURE'
  }
  if ($filePath.Length -lt 300 -or $filePath.Length -gt 340) {
    throw 'W6B_LONG_PATH_TEST_FIXTURE_LENGTH_INVALID'
  }
  if (@($filePath.Split('\') | Where-Object { $_.Length -gt 64 }).Count -ne 0) {
    throw 'W6B_LONG_PATH_TEST_FIXTURE_SEGMENT_INVALID'
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

  $reparseTarget = Join-Path $root 'reparse-target'
  $reparseProbe = Join-Path $root 'reparse-probe'
  [System.IO.Directory]::CreateDirectory(
    (ConvertTo-W6bExtendedLengthPath -Path $reparseTarget)
  ) | Out-Null
  New-Item -ItemType Junction -Path $reparseProbe -Target $reparseTarget |
    Out-Null
  $reparsePointRejected = $false
  try {
    Get-W6bEvidenceDirectoryInventory -Root $root | Out-Null
  }
  catch {
    if ($_.Exception.Message -cne 'W6B_LEGACY_EVIDENCE_PATH_INVALID') {
      throw
    }
    $reparsePointRejected = $true
  }
  if (!$reparsePointRejected) {
    throw 'W6B_LONG_PATH_REPARSE_POINT_NOT_REJECTED'
  }
  [System.IO.Directory]::Delete(
    (ConvertTo-W6bExtendedLengthPath -Path $reparseProbe),
    $false
  )
  $reparseProbe = $null

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
    reparsePointRejected = $true
  }
}
catch {
  $terminalError = $_
}
finally {
  try {
    if ($null -ne $reparseProbe) {
      $extendedReparseProbe = ConvertTo-W6bExtendedLengthPath `
        -Path $reparseProbe
      if ([System.IO.Directory]::Exists($extendedReparseProbe)) {
        [System.IO.Directory]::Delete($extendedReparseProbe, $false)
      }
    }
    if ([System.IO.Directory]::Exists($extendedRoot)) {
      Remove-W6bLegacyAcceptanceTestRoot -Root $root
    }
  }
  catch {
    if ($null -eq $terminalError) {
      $terminalError = $_
    }
  }
}

if ([System.IO.Directory]::Exists($extendedRoot)) {
  if ($null -eq $terminalError) {
    try {
      throw 'W6B_LONG_PATH_CLEANUP_FAILED'
    }
    catch {
      $terminalError = $_
    }
  }
}
if ($null -ne $terminalError) {
  [ordered]@{
    status = 'failed'
    testCase = 'longPathEvidence'
    errorCode = Get-W6bLongPathSafeErrorCode -ErrorRecord $terminalError
  } | ConvertTo-Json -Compress
  exit 1
}
$result.longPathCleanupValidated = $true
$result.readOnlyCleanupValidated = $true
$result | ConvertTo-Json -Compress

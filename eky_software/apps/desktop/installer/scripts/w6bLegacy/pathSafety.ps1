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

function Assert-W6bLegacyArtifactPathBudget {
  param([Parameter(Mandatory = $true)][string]$SourceSmokeRoot)

  $representativeCompanyDirectory =
    "local-company-$('0' * 32)"
  $representativeInvoiceDirectory =
    '00000000-0000-4000-8000-000000000000'
  $deepestExpectedPath = [System.IO.Path]::GetFullPath((Join-Path `
    $SourceSmokeRoot (Join-Path `
      'user-data\runtime\storage\invoices' (Join-Path `
        $representativeCompanyDirectory (Join-Path `
          $representativeInvoiceDirectory 'approved-invoice.pdf')))))

  # Windows PowerShell 5.1 still uses legacy path handling in cmdlets used by
  # this harness. Keep enough headroom for its directory enumeration.
  if ($deepestExpectedPath.Length -gt 248) {
    throw 'W6B_LEGACY_TEST_PATH_BUDGET_EXCEEDED'
  }
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
  return @($files)
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

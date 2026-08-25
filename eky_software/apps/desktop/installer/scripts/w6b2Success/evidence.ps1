Set-StrictMode -Version Latest

$script:W6b2SuccessPhases = @(
  'sourceHandoff',
  'targetFirstStart',
  'switchToB',
  'verifyBRestart',
  'switchToA',
  'rejectC'
)
$script:W6b2SuccessProfileOperations = @(
  'prepare',
  'targetFirstStart',
  'verifyBRestart',
  'rejectC'
)
$script:W6b2SuccessProofStatuses = @('completed', 'relaunching')

function Resolve-W6b2SuccessProofRoot {
  param(
    [Parameter(Mandatory = $true)][string]$TemporaryRoot,
    [Parameter(Mandatory = $true)][string]$ProofToken
  )

  if ($ProofToken -cnotmatch '^[0-9a-f]{64}$') {
    throw 'W6B2_SUCCESS_PROOF_TOKEN_INVALID'
  }
  $canonicalTemp = [IO.Path]::GetFullPath($TemporaryRoot).TrimEnd('\')
  $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  if (!$canonicalTemp.Equals($systemTemp, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'W6B2_SUCCESS_TEMP_ROOT_INVALID'
  }
  $root = Join-Path $canonicalTemp `
    (Join-Path 'eky-w6b2-packaged-proof' $ProofToken)
  Assert-W6b2SuccessCanonicalDirectory -Path $root
  return $root
}

function Assert-W6b2SuccessCanonicalDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $item = Get-Item -LiteralPath $fullPath -Force
  if (
    !$item.PSIsContainer -or
    ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    !(($item.FullName.TrimEnd('\')).Equals(
      $fullPath,
      [StringComparison]::OrdinalIgnoreCase
    ))
  ) {
    throw 'W6B2_SUCCESS_DIRECTORY_INVALID'
  }
  return $fullPath
}

function Resolve-W6b2SuccessRegularFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Extension,
    [string]$ContainedBy = ''
  )

  $fullPath = [IO.Path]::GetFullPath($Path)
  $item = Get-Item -LiteralPath $fullPath -Force
  if (
    $item.PSIsContainer -or
    ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    [IO.Path]::GetExtension($fullPath) -cne $Extension -or
    !$item.FullName.Equals($fullPath, [StringComparison]::OrdinalIgnoreCase)
  ) {
    throw 'W6B2_SUCCESS_FILE_INVALID'
  }
  if (![string]::IsNullOrEmpty($ContainedBy)) {
    $root = [IO.Path]::GetFullPath($ContainedBy).TrimEnd('\')
    if (!$fullPath.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase)) {
      throw 'W6B2_SUCCESS_FILE_INVALID'
    }
  }
  return $fullPath
}

function Get-W6b2SuccessDirectoryInventory {
  param([Parameter(Mandatory = $true)][string]$Root)

  $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  if (!(Test-Path -LiteralPath $fullRoot -PathType Container)) {
    return ,@()
  }
  [void](Assert-W6b2SuccessCanonicalDirectory -Path $fullRoot)
  $queue = [Collections.Generic.Queue[object]]::new()
  $queue.Enqueue((Get-Item -LiteralPath $fullRoot -Force))
  $inventory = @()
  while ($queue.Count -gt 0) {
    $directory = $queue.Dequeue()
    foreach ($item in @(Get-ChildItem -LiteralPath $directory.FullName -Force)) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'W6B2_SUCCESS_INVENTORY_INVALID'
      }
      if (!$item.FullName.StartsWith(
        "$fullRoot\",
        [StringComparison]::OrdinalIgnoreCase
      )) {
        throw 'W6B2_SUCCESS_INVENTORY_INVALID'
      }
      if ($item.PSIsContainer) {
        $queue.Enqueue($item)
        continue
      }
      $relativePath = $item.FullName.Substring($fullRoot.Length).TrimStart('\')
      $inventory += "$relativePath|$($item.Length)|$(Get-EkyFileSha256 -Path $item.FullName)"
    }
  }
  return ,@($inventory | Sort-Object)
}

function Assert-W6b2SuccessInventoryEqual {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Actual,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Expected
  )

  if ($Actual.Count -ne $Expected.Count) {
    throw 'W6B2_SUCCESS_INVENTORY_CHANGED'
  }
  for ($index = 0; $index -lt $Expected.Count; $index += 1) {
    if ($Actual[$index] -cne $Expected[$index]) {
      throw 'W6B2_SUCCESS_INVENTORY_CHANGED'
    }
  }
}

function Assert-W6b2SuccessPackageHash {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256
  )

  if (
    $ExpectedSha256 -cnotmatch '^[0-9a-f]{64}$' -or
    (Get-EkyFileSha256 -Path $Path).ToLowerInvariant() -cne $ExpectedSha256
  ) {
    throw 'W6B2_SUCCESS_PACKAGE_HASH_MISMATCH'
  }
}

function Set-W6b2SuccessPhase {
  param(
    [Parameter(Mandatory = $true)][string]$ProofRoot,
    [Parameter(Mandatory = $true)][string]$Phase
  )

  if ($script:W6b2SuccessPhases -cnotcontains $Phase) {
    throw 'W6B2_SUCCESS_PHASE_INVALID'
  }
  $controlRoot = Assert-W6b2SuccessCanonicalDirectory `
    -Path (Join-Path $ProofRoot 'control')
  $phasePath = Join-Path $controlRoot 'phase.json'
  $nextPath = Join-Path $controlRoot 'phase.next.json'
  Remove-Item -LiteralPath $nextPath -Force -ErrorAction SilentlyContinue
  try {
    [IO.File]::WriteAllText(
      $nextPath,
      ((ConvertTo-Json -InputObject ([ordered]@{
        formatVersion = 1
        phase = $Phase
      }) -Compress) + "`n"),
      [Text.UTF8Encoding]::new($false)
    )
    if (Test-Path -LiteralPath $phasePath -PathType Leaf) {
      [IO.File]::Replace($nextPath, $phasePath, $null)
    }
    else {
      [IO.File]::Move($nextPath, $phasePath)
    }
  }
  finally {
    Remove-Item -LiteralPath $nextPath -Force -ErrorAction SilentlyContinue
  }
}

function Clear-W6b2SuccessResultFiles {
  param([Parameter(Mandatory = $true)][string]$ProofRoot)

  $resultRoot = Join-Path $ProofRoot 'result'
  if (!(Test-Path -LiteralPath $resultRoot)) {
    [void](New-Item -ItemType Directory -Path $resultRoot)
  }
  [void](Assert-W6b2SuccessCanonicalDirectory -Path $resultRoot)
  foreach ($name in @(
    'w6b2-proof-result.json',
    'w6b2-profile-result.json'
  )) {
    Remove-Item -LiteralPath (Join-Path $resultRoot $name) `
      -Force -ErrorAction SilentlyContinue
  }
}

function Read-W6b2SuccessProofResult {
  param(
    [Parameter(Mandatory = $true)][string]$ProofRoot,
    [Parameter(Mandatory = $true)][string]$ExpectedPhase,
    [Parameter(Mandatory = $true)][string]$ExpectedStatus
  )

  if (
    $script:W6b2SuccessPhases -cnotcontains $ExpectedPhase -or
    $script:W6b2SuccessProofStatuses -cnotcontains $ExpectedStatus
  ) {
    throw 'W6B2_SUCCESS_PROOF_RESULT_INVALID'
  }
  $value = Read-W6b2SuccessBoundedJson `
    -Path (Join-Path $ProofRoot 'result\w6b2-proof-result.json')
  $keys = @($value.PSObject.Properties.Name | Sort-Object)
  $expectedKeys = @('formatVersion', 'phase', 'status')
  if (
    @(Compare-Object $keys $expectedKeys).Count -ne 0 -or
    $value.formatVersion -ne 1 -or
    [string]$value.phase -cne $ExpectedPhase -or
    [string]$value.status -cne $ExpectedStatus
  ) {
    throw 'W6B2_SUCCESS_PROOF_RESULT_INVALID'
  }
  return $value
}

function Read-W6b2SuccessProfileResult {
  param(
    [Parameter(Mandatory = $true)][string]$ProofRoot,
    [Parameter(Mandatory = $true)][string]$ExpectedOperation
  )

  if ($script:W6b2SuccessProfileOperations -cnotcontains $ExpectedOperation) {
    throw 'W6B2_SUCCESS_PROFILE_RESULT_INVALID'
  }
  $value = Read-W6b2SuccessBoundedJson `
    -Path (Join-Path $ProofRoot 'result\w6b2-profile-result.json')
  $keys = @($value.PSObject.Properties.Name | Sort-Object)
  $expectedKeys = @('formatVersion', 'operation', 'status')
  if (
    @(Compare-Object $keys $expectedKeys).Count -ne 0 -or
    $value.formatVersion -ne 1 -or
    [string]$value.operation -cne $ExpectedOperation -or
    [string]$value.status -cne 'completed'
  ) {
    throw 'W6B2_SUCCESS_PROFILE_RESULT_INVALID'
  }
  return $value
}

function Read-W6b2SuccessBoundedJson {
  param([Parameter(Mandatory = $true)][string]$Path)

  try {
    $item = Get-Item -LiteralPath $Path -Force
    if (
      $item.PSIsContainer -or
      ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      $item.Length -lt 1 -or
      $item.Length -gt 4096
    ) {
      throw 'invalid'
    }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
      ConvertFrom-Json
  }
  catch {
    throw 'W6B2_SUCCESS_RESULT_INVALID'
  }
}

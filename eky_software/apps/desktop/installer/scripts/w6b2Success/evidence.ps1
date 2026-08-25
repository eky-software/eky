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
    (Join-Path 'eky-w6b2' $ProofToken)
  [void](Assert-W6b2SuccessCanonicalDirectory -Path $root)
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
  $files = @()
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
      $files += $item
    }
  }
  $inventory = @(
    $files |
      Sort-Object FullName |
      ForEach-Object {
        $relativePath = $_.FullName.Substring($fullRoot.Length).TrimStart('\')
        "$relativePath|$($_.Length)|$(Get-EkyFileSha256 -Path $_.FullName)"
      }
  )
  return ,$inventory
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
  $previousPath = Join-Path $controlRoot 'phase.previous.json'
  Remove-Item -LiteralPath $nextPath,$previousPath `
    -Force -ErrorAction SilentlyContinue
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
      [IO.File]::Replace($nextPath, $phasePath, $previousPath)
    }
    else {
      [IO.File]::Move($nextPath, $phasePath)
    }
  }
  finally {
    Remove-Item -LiteralPath $nextPath,$previousPath `
      -Force -ErrorAction SilentlyContinue
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
    @(Compare-Object $keys $expectedKeys).Count -eq 0 -and
    $value.formatVersion -eq 1 -and
    [string]$value.phase -ceq $ExpectedPhase -and
    [string]$value.status -ceq $ExpectedStatus
  ) {
    return $value
  }
  $failedKeys = @('errorCode', 'formatVersion', 'phase', 'status')
  $failureCodes = @{
    W6B2_PROOF_CANDIDATE_STAGE_FAILED = `
      'W6B2_SUCCESS_PROOF_CANDIDATE_STAGE_FAILED'
    W6B2_PROOF_CONFIGURATION_INVALID = `
      'W6B2_SUCCESS_PROOF_CONFIGURATION_INVALID'
    W6B2_PROOF_HANDOFF_FAILED = 'W6B2_SUCCESS_PROOF_HANDOFF_FAILED'
    W6B2_PROOF_INSTALLER_HANDOFF_FAILED = `
      'W6B2_SUCCESS_PROOF_INSTALLER_HANDOFF_FAILED'
    W6B2_PROOF_PACKAGE_MARKER_INVALID = `
      'W6B2_SUCCESS_PROOF_PACKAGE_MARKER_INVALID'
    W6B2_PROOF_PREPARATION_FAILED = `
      'W6B2_SUCCESS_PROOF_PREPARATION_FAILED'
    W6B2_PROOF_QUIT_REQUEST_MISSING = `
      'W6B2_SUCCESS_PROOF_QUIT_REQUEST_MISSING'
    W6B2_PROOF_REJECTION_FAILED = 'W6B2_SUCCESS_PROOF_REJECTION_FAILED'
    W6B2_PROOF_SHUTDOWN_FAILED = 'W6B2_SUCCESS_PROOF_SHUTDOWN_FAILED'
    W6B2_PROOF_SOURCE_STAGE_FAILED = `
      'W6B2_SUCCESS_PROOF_SOURCE_STAGE_FAILED'
    W6B2_PROOF_SWITCH_FAILED = 'W6B2_SUCCESS_PROOF_SWITCH_FAILED'
    W6B2_PROOF_UNEXPECTED = 'W6B2_SUCCESS_PROOF_UNEXPECTED'
    W6B2_PROOF_WORKSPACE_STATE_INVALID = `
      'W6B2_SUCCESS_PROOF_WORKSPACE_STATE_INVALID'
  }
  if (@(Compare-Object $keys $failedKeys).Count -ne 0) {
    throw 'W6B2_SUCCESS_PROOF_RESULT_INVALID'
  }
  $safeFailure = $failureCodes[[string]$value.errorCode]
  if (
    $value.formatVersion -ne 1 -or
    [string]$value.phase -cne $ExpectedPhase -or
    [string]$value.status -cne 'failed' -or
    [string]::IsNullOrEmpty([string]$safeFailure)
  ) {
    throw 'W6B2_SUCCESS_PROOF_RESULT_INVALID'
  }
  throw [string]$safeFailure
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
  $completedKeys = @('formatVersion', 'operation', 'status')
  if (
    @(Compare-Object $keys $completedKeys).Count -eq 0 -and
    $value.formatVersion -eq 1 -and
    [string]$value.operation -ceq $ExpectedOperation -and
    [string]$value.status -ceq 'completed'
  ) {
    return $value
  }
  $failedKeys = @(
    'errorCode',
    'failureStage',
    'formatVersion',
    'operation',
    'status'
  )
  $failureCodes = @{
    electronReady = 'W6B2_SUCCESS_PROFILE_ELECTRON_READY_FAILED'
    installedApplication = 'W6B2_SUCCESS_PROFILE_INSTALLATION_INVALID'
    proofConfiguration = 'W6B2_SUCCESS_PROFILE_CONFIGURATION_INVALID'
    buildIdentity = 'W6B2_SUCCESS_PROFILE_BUILD_IDENTITY_INVALID'
    profileInput = 'W6B2_SUCCESS_PROFILE_INPUT_INVALID'
    runtimePaths = 'W6B2_SUCCESS_PROFILE_RUNTIME_PATHS_INVALID'
    fixtureA = 'W6B2_SUCCESS_PROFILE_FIXTURE_A_FAILED'
    fixtureB = 'W6B2_SUCCESS_PROFILE_FIXTURE_B_FAILED'
    fixtureC = 'W6B2_SUCCESS_PROFILE_FIXTURE_C_FAILED'
    migrationHistory = 'W6B2_SUCCESS_PROFILE_MIGRATION_HISTORY_FAILED'
    registry = 'W6B2_SUCCESS_PROFILE_REGISTRY_WRITE_FAILED'
    acceptedBuild = 'W6B2_SUCCESS_PROFILE_ACCEPTED_BUILD_WRITE_FAILED'
    evidence = 'W6B2_SUCCESS_PROFILE_EVIDENCE_SNAPSHOT_FAILED'
    profileState = 'W6B2_SUCCESS_PROFILE_STATE_WRITE_FAILED'
    profileOperation = 'W6B2_SUCCESS_PROFILE_OPERATION_FAILED'
  }
  $expectedErrorCode = if ($ExpectedOperation -ceq 'prepare') {
    'W6B2_PROFILE_PREPARATION_FAILED'
  }
  else {
    'W6B2_PROFILE_VERIFICATION_FAILED'
  }
  if (@(Compare-Object $keys $failedKeys).Count -ne 0) {
    throw 'W6B2_SUCCESS_PROFILE_RESULT_INVALID'
  }
  $safeFailure = $failureCodes[[string]$value.failureStage]
  if (
    $value.formatVersion -eq 1 -and
    [string]$value.operation -ceq $ExpectedOperation -and
    [string]$value.status -ceq 'failed' -and
    [string]$value.errorCode -ceq $expectedErrorCode -and
    ![string]::IsNullOrEmpty([string]$safeFailure)
  ) {
    throw [string]$safeFailure
  }
  throw 'W6B2_SUCCESS_PROFILE_RESULT_INVALID'
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

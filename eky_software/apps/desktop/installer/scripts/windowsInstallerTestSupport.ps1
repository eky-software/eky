Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windowsInstallerProcessTree.ps1')

$script:EkyMsiExecHostPath = Join-Path $PSScriptRoot `
  'windowsInstallerMsiExecHost.ps1'

function Get-EkyFileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $algorithm.ComputeHash($stream)
    return [System.BitConverter]::ToString($hash).Replace('-', '')
  }
  finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

function Get-EkyProductState {
  param(
    [Parameter(Mandatory = $true)]$Installer,
    [Parameter(Mandatory = $true)][string]$Code
  )

  try {
    return $Installer.ProductState($Code)
  }
  catch {
    return -1
  }
}

function Get-EkyMsiExecPolicy {
  param([Parameter(Mandatory = $true)][string]$Operation)

  $policy = switch -CaseSensitive ($Operation) {
    'lifecycle_install' { @('INSTALLER_LIFECYCLE_INSTALL', 300000) }
    'lifecycle_uninstall' { @('INSTALLER_LIFECYCLE_UNINSTALL', 180000) }
    'lifecycle_repair' { @('INSTALLER_LIFECYCLE_REPAIR', 300000) }
    'lifecycle_cleanup' { @('INSTALLER_LIFECYCLE_CLEANUP', 180000) }
    'upgrade_install' { @('INSTALLER_UPGRADE_INSTALL', 300000) }
    'upgrade_uninstall' { @('INSTALLER_UPGRADE_UNINSTALL', 180000) }
    'downgrade' { @('INSTALLER_DOWNGRADE', 300000) }
    'rollback_probe' { @('INSTALLER_ROLLBACK_PROBE', 300000) }
    'upgrade_cleanup' { @('INSTALLER_UPGRADE_CLEANUP', 180000) }
    'w6b_source_install' { @('W6B_LEGACY_SOURCE_INSTALL', 300000) }
    'w6b_target_install' { @('W6B_LEGACY_TARGET_INSTALL', 300000) }
    'w6b_uninstall' { @('W6B_LEGACY_UNINSTALL', 180000) }
    'w6b2_source_install' { @('W6B2_SUCCESS_SOURCE_INSTALL', 300000) }
    'w6b2_uninstall' { @('W6B2_SUCCESS_UNINSTALL', 180000) }
    default { throw 'INSTALLER_MSI_OPERATION_INVALID' }
  }
  return [pscustomobject]@{
    errorPrefix = [string]$policy[0]
    timeoutMilliseconds = [int]$policy[1]
  }
}

function New-EkyOwnedMsiProcessIdentity {
  param([Parameter(Mandatory = $true)]$Process)

  try {
    return [pscustomobject]@{
      processId = [int]$Process.Id
      startTimeTicks = [long]$Process.StartTime.ToUniversalTime().Ticks
    }
  }
  catch {
    throw 'INSTALLER_MSI_PROCESS_IDENTITY_INVALID'
  }
}

function ConvertTo-EkyMsiExecArgumentsToken {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]
    $Arguments
  )

  if (
    $Arguments.Count -lt 1 -or
    @($Arguments | Where-Object {
      $_.Length -lt 1 -or $_.Length -gt 32767
    }).Count -ne 0
  ) {
    throw 'INSTALLER_MSI_ARGUMENTS_INVALID'
  }

  $json = ConvertTo-Json -InputObject @($Arguments) -Compress
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
}

function Start-EkyOwnedMsiExecHost {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  if (!(Test-Path -LiteralPath $script:EkyMsiExecHostPath -PathType Leaf)) {
    throw 'INSTALLER_MSI_HOST_MISSING'
  }
  $encodedArguments = ConvertTo-EkyMsiExecArgumentsToken `
    -Arguments $Arguments
  return Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile',
    '-NonInteractive',
    '-File',
    "`"$script:EkyMsiExecHostPath`"",
    '-EncodedArguments',
    $encodedArguments
  ) -WindowStyle Hidden -PassThru
}

function Assert-EkyOwnedMsiProcessIdentity {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)]$Identity
  )

  try {
    if (
      [int]$Process.Id -ne [int]$Identity.processId -or
      [long]$Process.StartTime.ToUniversalTime().Ticks -ne
        [long]$Identity.startTimeTicks
    ) {
      throw 'INSTALLER_MSI_PROCESS_IDENTITY_INVALID'
    }
  }
  catch {
    throw 'INSTALLER_MSI_PROCESS_IDENTITY_INVALID'
  }
}

function Wait-EkyOwnedMsiProcess {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds
  )

  if ($TimeoutMilliseconds -lt 1) {
    throw 'INSTALLER_MSI_PROCESS_WAIT_INVALID'
  }
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $exited = $Process.WaitForExit($TimeoutMilliseconds)
    if (!$exited) {
      return [pscustomobject]@{
        state = 'timedOut'
        exitCode = $null
        durationMs = [long]$stopwatch.ElapsedMilliseconds
      }
    }
    return [pscustomobject]@{
      state = 'exited'
      exitCode = [int]$Process.ExitCode
      durationMs = [long]$stopwatch.ElapsedMilliseconds
    }
  }
  catch {
    throw 'INSTALLER_MSI_PROCESS_WAIT_FAILED'
  }
  finally {
    $stopwatch.Stop()
  }
}

function Stop-EkyOwnedMsiProcess {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)]$Identity,
    [int]$TimeoutMilliseconds = 10000
  )

  if ($TimeoutMilliseconds -lt 1) {
    throw 'INSTALLER_MSI_PROCESS_CLEANUP_WAIT_INVALID'
  }
  Assert-EkyOwnedMsiProcessIdentity -Process $Process -Identity $Identity
  try {
    $Process.Refresh()
    if ($Process.HasExited) {
      return
    }
    Stop-EkyProcessTree -Process $Process `
      -TimeoutMilliseconds $TimeoutMilliseconds
  }
  catch {
    if ($_.Exception.Message -eq 'INSTALLER_MSI_PROCESS_CLEANUP_TIMEOUT') {
      throw
    }
    throw 'INSTALLER_MSI_PROCESS_CLEANUP_FAILED'
  }
}

function Invoke-EkyMsiExecProcess {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Operation
  )

  $policy = Get-EkyMsiExecPolicy -Operation $Operation
  try {
    $process = Start-EkyOwnedMsiExecHost -Arguments $Arguments
  }
  catch {
    throw "$($policy.errorPrefix)_START_FAILED"
  }
  try {
    $identity = New-EkyOwnedMsiProcessIdentity -Process $process
    $result = Wait-EkyOwnedMsiProcess -Process $process `
      -TimeoutMilliseconds $policy.timeoutMilliseconds
    if ($result.state -eq 'timedOut') {
      try {
        Stop-EkyOwnedMsiProcess -Process $process -Identity $identity
      }
      catch {
        throw "$($policy.errorPrefix)_CLEANUP_FAILED"
      }
      throw "$($policy.errorPrefix)_TIMEOUT"
    }
    return [int]$result.exitCode
  }
  finally {
    $process.Dispose()
  }
}

function Assert-EkyMsiExecExitCode {
  param(
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $true)][string]$Operation,
    [int[]]$AllowedExitCodes = @(0)
  )

  $policy = Get-EkyMsiExecPolicy -Operation $Operation
  if ($ExitCode -notin $AllowedExitCodes) {
    throw "$($policy.errorPrefix)_FAILED:$ExitCode"
  }
}

function Assert-EkyMsiExecExpectedFailureExitCode {
  param(
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $true)][string]$Operation
  )

  $policy = Get-EkyMsiExecPolicy -Operation $Operation
  if ($ExitCode -in @(0, 1641, 3010)) {
    throw "$($policy.errorPrefix)_EXPECTED_FAILURE_MISSING"
  }
}

function Invoke-EkyMsiExec {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Operation,
    [int[]]$AllowedExitCodes = @(0)
  )

  $exitCode = Invoke-EkyMsiExecProcess -Arguments $Arguments `
    -Operation $Operation
  Assert-EkyMsiExecExitCode -ExitCode $exitCode -Operation $Operation `
    -AllowedExitCodes $AllowedExitCodes
  return $exitCode
}

function Invoke-EkyMsiExecExpectedFailure {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Operation
  )

  $exitCode = Invoke-EkyMsiExecProcess -Arguments $Arguments `
    -Operation $Operation
  Assert-EkyMsiExecExpectedFailureExitCode -ExitCode $exitCode `
    -Operation $Operation
  return $exitCode
}

function Remove-EkyInstallerTestDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)

  try {
    $normalizedPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $normalizedTempRoot = [IO.Path]::GetFullPath(
      [IO.Path]::GetTempPath()
    ).TrimEnd('\')
    $parent = [IO.Directory]::GetParent($normalizedPath)
    $leaf = [IO.Path]::GetFileName($normalizedPath)
  }
  catch {
    throw 'INSTALLER_TEST_DIRECTORY_PATH_INVALID'
  }
  if (
    $null -eq $parent -or
    !$parent.FullName.Equals(
      $normalizedTempRoot,
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    $leaf -notmatch '^eky-installer-(?:lifecycle|upgrade)-[0-9a-f]{32}$'
  ) {
    throw 'INSTALLER_TEST_DIRECTORY_PATH_INVALID'
  }
  if (!(Test-Path -LiteralPath $normalizedPath)) {
    return
  }

  $cleanupProcess = $null
  try {
    $rootItem = Get-Item -LiteralPath $normalizedPath -Force
    if (
      !$rootItem.PSIsContainer -or
      ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    ) {
      throw 'INSTALLER_TEST_DIRECTORY_PATH_INVALID'
    }
    $extendedPath = if ($normalizedPath.StartsWith('\\')) {
      '\\?\UNC\' + $normalizedPath.Substring(2)
    }
    elseif ($normalizedPath -match '^[A-Za-z]:\\') {
      '\\?\' + $normalizedPath
    }
    else {
      throw 'INSTALLER_TEST_DIRECTORY_PATH_INVALID'
    }

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $startInfo.Arguments = '/d /v:off /s /c "rd /s /q ' +
      '""%EKY_INSTALLER_TEST_DELETE_ROOT%"""'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables['EKY_INSTALLER_TEST_DELETE_ROOT'] = `
      $extendedPath
    $cleanupProcess = [Diagnostics.Process]::Start($startInfo)
    if ($null -eq $cleanupProcess) {
      throw 'INSTALLER_TEST_DIRECTORY_CLEANUP_START_FAILED'
    }
    $cleanupIdentity = New-EkyOwnedMsiProcessIdentity `
      -Process $cleanupProcess
    $cleanupResult = Wait-EkyOwnedMsiProcess -Process $cleanupProcess `
      -TimeoutMilliseconds 30000
    if ($cleanupResult.state -eq 'timedOut') {
      try {
        Stop-EkyOwnedMsiProcess -Process $cleanupProcess `
          -Identity $cleanupIdentity -TimeoutMilliseconds 5000
      }
      catch {
        throw 'INSTALLER_TEST_DIRECTORY_CLEANUP_STOP_FAILED'
      }
      throw 'INSTALLER_TEST_DIRECTORY_CLEANUP_TIMEOUT'
    }
    if ([int]$cleanupResult.exitCode -ne 0) {
      throw 'INSTALLER_TEST_DIRECTORY_CLEANUP_FAILED'
    }
  }
  catch {
    $safeCleanupCodes = @(
      'INSTALLER_TEST_DIRECTORY_PATH_INVALID',
      'INSTALLER_TEST_DIRECTORY_CLEANUP_START_FAILED',
      'INSTALLER_TEST_DIRECTORY_CLEANUP_STOP_FAILED',
      'INSTALLER_TEST_DIRECTORY_CLEANUP_TIMEOUT',
      'INSTALLER_TEST_DIRECTORY_CLEANUP_FAILED'
    )
    if ($safeCleanupCodes -contains $_.Exception.Message) {
      throw
    }
    throw 'INSTALLER_TEST_DIRECTORY_CLEANUP_FAILED'
  }
  finally {
    if ($null -ne $cleanupProcess) {
      $cleanupProcess.Dispose()
    }
  }
  if (Test-Path -LiteralPath $normalizedPath) {
    throw 'INSTALLER_TEST_DIRECTORY_CLEANUP_REMAINS'
  }
}

function Get-EkyDirectoryInventory {
  param([Parameter(Mandatory = $true)][string]$Root)

  if (!(Test-Path -LiteralPath $Root -PathType Container)) {
    return ,@()
  }
  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
  $inventory = @(
    Get-ChildItem -LiteralPath $resolvedRoot -File -Recurse -Force |
      Sort-Object FullName |
      ForEach-Object {
        $relativePath = $_.FullName.Substring($resolvedRoot.Length).TrimStart('\')
        $hash = Get-EkyFileSha256 -Path $_.FullName
        "$relativePath|$($_.Length)|$hash"
      }
  )
  return ,$inventory
}

function Assert-EkyInventoryEqual {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Actual,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Expected,
    [Parameter(Mandatory = $true)][string]$Code
  )

  if ($Actual.Count -ne $Expected.Count) {
    throw "$Code`: file count mismatch"
  }
  for ($index = 0; $index -lt $Expected.Count; $index += 1) {
    if ($Actual[$index] -ne $Expected[$index]) {
      throw "$Code`: content mismatch"
    }
  }
}

function Assert-EkyInstalledPayload {
  param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][object[]]$PayloadInventory,
    [Parameter(Mandatory = $true)][string]$ShortcutPath
  )

  $installedInventory = Get-EkyDirectoryInventory -Root $InstallRoot
  Assert-EkyInventoryEqual $installedInventory $PayloadInventory `
    'INSTALLER_PAYLOAD_MISMATCH'
  if (!(Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) {
    throw 'INSTALLER_SHORTCUT_MISSING'
  }
}

function Assert-EkyPathEventuallyAbsent {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Code,
    [int]$TimeoutMilliseconds = 5000
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  while (Test-Path -LiteralPath $Path) {
    if ([DateTime]::UtcNow -ge $deadline) {
      throw $Code
    }
    Start-Sleep -Milliseconds 100
  }
}

function Get-EkyProductRegistrations {
  param([string[]]$ProductCodes = @())

  $installer = $null
  $registrations = @()
  try {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    foreach ($productCode in $ProductCodes) {
      $normalizedCode = "{$($productCode.Trim('{}').ToUpperInvariant())}"
      if ((Get-EkyProductState -Installer $installer -Code $normalizedCode) -lt 1) {
        continue
      }
      try {
        $registrations += [pscustomobject]@{
          LocalPackage = $installer.ProductInfo($normalizedCode, 'LocalPackage')
          ProductCode = $normalizedCode
          ProductName = $installer.ProductInfo($normalizedCode, 'ProductName')
          ProductVersion = $installer.ProductInfo($normalizedCode, 'VersionString')
        }
      }
      catch {
        throw 'INSTALLER_PRODUCT_REGISTRATION_UNREADABLE'
      }
    }
  }
  finally {
    if ($null -ne $installer) {
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
    }
  }
  return @($registrations)
}

function Assert-EkyInstallerRegistrationPresent {
  param([Parameter(Mandatory = $true)][string]$ProductCode)

  $installerRegistryRoot = 'HKCU:\Software\Eky\Installer'
  if (!(Test-Path -LiteralPath $installerRegistryRoot -PathType Container)) {
    throw 'INSTALLER_OWNED_REGISTRY_MISSING'
  }
  $entries = @(Get-EkyProductRegistrations -ProductCodes @($ProductCode))
  $normalizedCode = "{$($ProductCode.Trim('{}').ToUpperInvariant())}"
  if (
    $entries.Count -ne 1 -or
    $entries[0].ProductCode -ne $normalizedCode -or
    $entries[0].ProductName -ne 'Eky' -or
    [string]::IsNullOrWhiteSpace($entries[0].ProductVersion) -or
    !(Test-Path -LiteralPath $entries[0].LocalPackage -PathType Leaf)
  ) {
    throw 'INSTALLER_ARP_REGISTRATION_MISSING_OR_AMBIGUOUS'
  }
}

function Assert-EkyInstallerRegistrationAbsent {
  param([string[]]$ProductCodes = @())

  if (Test-Path -LiteralPath 'HKCU:\Software\Eky\Installer') {
    throw 'INSTALLER_OWNED_REGISTRY_REMAINS'
  }
  if (@(Get-EkyProductRegistrations -ProductCodes $ProductCodes).Count -ne 0) {
    throw 'INSTALLER_ARP_REGISTRATION_REMAINS'
  }
}

Set-StrictMode -Version Latest

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

function Invoke-EkyMsiExec {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Operation,
    [int[]]$AllowedExitCodes = @(0)
  )

  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $Arguments `
    -NoNewWindow -Wait -PassThru
  if ($process.ExitCode -notin $AllowedExitCodes) {
    throw "INSTALLER_$($Operation.ToUpperInvariant())_FAILED:$($process.ExitCode)"
  }
  return $process.ExitCode
}

function Invoke-EkyMsiExecExpectedFailure {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Operation
  )

  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $Arguments `
    -NoNewWindow -Wait -PassThru
  if ($process.ExitCode -in @(0, 1641, 3010)) {
    throw "INSTALLER_$($Operation.ToUpperInvariant())_EXPECTED_FAILURE_MISSING"
  }
  return $process.ExitCode
}

function Get-EkyDirectoryInventory {
  param([Parameter(Mandatory = $true)][string]$Root)

  if (!(Test-Path -LiteralPath $Root -PathType Container)) {
    return @()
  }
  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
  return @(
    Get-ChildItem -LiteralPath $resolvedRoot -File -Recurse -Force |
      Sort-Object FullName |
      ForEach-Object {
        $relativePath = $_.FullName.Substring($resolvedRoot.Length).TrimStart('\')
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        "$relativePath|$($_.Length)|$hash"
      }
  )
}

function Assert-EkyInventoryEqual {
  param(
    [Parameter(Mandatory = $true)][object[]]$Actual,
    [Parameter(Mandatory = $true)][object[]]$Expected,
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

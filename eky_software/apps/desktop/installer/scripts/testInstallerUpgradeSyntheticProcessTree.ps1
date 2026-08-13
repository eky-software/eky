Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'installerUpgradeProcessTreeTestSupport.ps1')

$assertionCount = 0
$ownedProcessTree = $null
$rootProcess = $null
$rootIdentity = $null
$unrelatedProcess = $null
$unrelatedIdentity = $null

function Assert-EkySyntheticProcessTreeCondition {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Code
  )

  $script:assertionCount += 1
  if (!$Condition) {
    throw $Code
  }
}

function ConvertTo-EkySyntheticEncodedCommand {
  param([Parameter(Mandatory = $true)][string]$Command)

  return [Convert]::ToBase64String(
    [Text.Encoding]::Unicode.GetBytes($Command)
  )
}

function Start-EkySyntheticPowerShellProcess {
  param([Parameter(Mandatory = $true)][string]$Command)

  $powershellPath = Join-Path $env:SystemRoot `
    'System32\WindowsPowerShell\v1.0\powershell.exe'
  return Start-Process -FilePath $powershellPath -ArgumentList @(
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    (ConvertTo-EkySyntheticEncodedCommand -Command $Command)
  ) -WindowStyle Hidden -PassThru
}

function Wait-EkySyntheticProcessIdentity {
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [int]$TimeoutMilliseconds = 10000
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    $identity = Get-EkyInstallerProcessIdentityById -ProcessId $ProcessId
    if ($null -ne $identity) {
      return $identity
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'INSTALLER_SYNTHETIC_PROCESS_IDENTITY_TIMEOUT'
}

function Stop-EkySyntheticOwnedIdentity {
  param($Identity)

  if (
    $null -eq $Identity -or
    !(Test-EkyInstallerProcessIdentityAlive -Identity $Identity)
  ) {
    return
  }
  [void](Invoke-EkyInstallerTaskkill -RootProcessId $Identity.ProcessId)
}

try {
  $unrelatedProcess = Start-EkySyntheticPowerShellProcess `
    -Command 'Start-Sleep -Seconds 120'
  $unrelatedIdentity = Wait-EkySyntheticProcessIdentity `
    -ProcessId $unrelatedProcess.Id

  $powershellPath = Join-Path $env:SystemRoot `
    'System32\WindowsPowerShell\v1.0\powershell.exe'
  $longChildCommand = ConvertTo-EkySyntheticEncodedCommand `
    -Command 'Start-Sleep -Seconds 120'
  $quickChildCommand = ConvertTo-EkySyntheticEncodedCommand `
    -Command 'Start-Sleep -Milliseconds 750'
  $rootCommand = @"
Start-Process -FilePath '$powershellPath' -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand','$longChildCommand') -WindowStyle Hidden | Out-Null
Start-Process -FilePath '$powershellPath' -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand','$quickChildCommand') -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 120
"@
  $rootProcess = Start-EkySyntheticPowerShellProcess -Command $rootCommand
  $rootIdentity = Wait-EkySyntheticProcessIdentity -ProcessId $rootProcess.Id

  $discoveryDeadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $ownedIdentities = @(Get-EkyInstallerOwnedProcessTree `
      -RootIdentity $rootIdentity -SeedIdentities @($rootIdentity))
    if ($ownedIdentities.Count -ge 3) {
      break
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $discoveryDeadline)

  Assert-EkySyntheticProcessTreeCondition `
    -Condition ($ownedIdentities.Count -ge 3) `
    -Code 'INSTALLER_SYNTHETIC_PROCESS_TREE_DISCOVERY_FAILED'
  Assert-EkySyntheticProcessTreeCondition -Condition (
    @($ownedIdentities | Where-Object {
      Test-EkyInstallerProcessIdentityEqual `
        -Left $_ -Right $unrelatedIdentity
    }).Count -eq 0
  ) -Code 'INSTALLER_SYNTHETIC_UNRELATED_PROCESS_TRACKED'

  $ownedProcessTree = [pscustomobject]@{
    RootIdentity = $rootIdentity
    TrackedIdentities = $ownedIdentities
  }
  $initialTrackedProcessCount = $ownedIdentities.Count
  $quickExitDeadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $aliveOwnedIdentities = @($ownedIdentities | Where-Object {
      Test-EkyInstallerProcessIdentityAlive -Identity $_
    })
    $rootStillAlive = @($aliveOwnedIdentities | Where-Object {
      Test-EkyInstallerProcessIdentityEqual -Left $_ -Right $rootIdentity
    }).Count -eq 1
    if (
      $aliveOwnedIdentities.Count -lt $initialTrackedProcessCount -and
      $aliveOwnedIdentities.Count -ge 2 -and
      $rootStillAlive
    ) {
      break
    }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $quickExitDeadline)

  Assert-EkySyntheticProcessTreeCondition `
    -Condition (
      $aliveOwnedIdentities.Count -lt $initialTrackedProcessCount
    ) `
    -Code 'INSTALLER_SYNTHETIC_FAST_CHILD_DID_NOT_EXIT'
  Assert-EkySyntheticProcessTreeCondition `
    -Condition ($aliveOwnedIdentities.Count -ge 2 -and $rootStillAlive) `
    -Code 'INSTALLER_SYNTHETIC_LONG_LIVED_TREE_EXITED_EARLY'

  $cleanup = Stop-EkyInstallerOwnedProcessTree `
    -ProcessTree $ownedProcessTree -TimeoutMilliseconds 10000
  $ownedProcessTree = $null
  Assert-EkySyntheticProcessTreeCondition `
    -Condition ($cleanup.Decision -eq 'success') `
    -Code 'INSTALLER_SYNTHETIC_PROCESS_TREE_CLEANUP_FAILED'
  Assert-EkySyntheticProcessTreeCondition `
    -Condition ($cleanup.RemainingProcessCount -eq 0) `
    -Code 'INSTALLER_SYNTHETIC_PROCESS_TREE_REMAINS'
  Assert-EkySyntheticProcessTreeCondition `
    -Condition (Test-EkyInstallerProcessIdentityAlive `
      -Identity $unrelatedIdentity) `
    -Code 'INSTALLER_SYNTHETIC_UNRELATED_PROCESS_TERMINATED'

  [ordered]@{
    assertionCount = $assertionCount
    status = 'ok'
  } | ConvertTo-Json -Compress
}
finally {
  if ($null -ne $ownedProcessTree) {
    foreach ($identity in @($ownedProcessTree.TrackedIdentities)) {
      try {
        Stop-EkySyntheticOwnedIdentity -Identity $identity
      }
      catch {
        # Cleanup is limited to identities created and tracked by this test.
      }
    }
  }
  elseif ($null -ne $rootIdentity) {
    try {
      Stop-EkySyntheticOwnedIdentity -Identity $rootIdentity
    }
    catch {
      # The exact test root owns any descendants started by this fixture.
    }
  }
  elseif ($null -ne $rootProcess -and !$rootProcess.HasExited) {
    try {
      [void](Invoke-EkyInstallerTaskkill -RootProcessId $rootProcess.Id)
    }
    catch {
      # The process object is the exact root started by this fixture.
    }
  }
  if ($null -ne $unrelatedProcess) {
    try {
      if ($null -ne $unrelatedIdentity) {
        Stop-EkySyntheticOwnedIdentity -Identity $unrelatedIdentity
      }
      elseif (!$unrelatedProcess.HasExited) {
        [void](Invoke-EkyInstallerTaskkill `
          -RootProcessId $unrelatedProcess.Id)
      }
    }
    catch {
      # Cleanup is limited to the exact unrelated test process identity.
    }
  }
}

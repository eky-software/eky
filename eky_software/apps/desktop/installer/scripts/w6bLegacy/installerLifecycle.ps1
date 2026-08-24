function Assert-W6bProductInstalled {
  param([Parameter(Mandatory = $true)][string]$ProductCode)

  if ((Get-EkyProductState -Installer $installer -Code $ProductCode) -lt 1) {
    throw 'W6B_LEGACY_EXPECTED_PRODUCT_MISSING'
  }
}

function Assert-W6bProductAbsent {
  param([Parameter(Mandatory = $true)][string]$ProductCode)

  if ((Get-EkyProductState -Installer $installer -Code $ProductCode) -ge 1) {
    throw 'W6B_LEGACY_UNEXPECTED_PRODUCT_PRESENT'
  }
}

function Install-W6bPackage {
  param(
    [Parameter(Mandatory = $true)][string]$MsiPath,
    [Parameter(Mandatory = $true)][string]$LogName,
    [Parameter(Mandatory = $true)]
    [ValidateSet('w6b_source_install', 'w6b_target_install')]
    [string]$Operation
  )

  Invoke-EkyMsiExec -Operation $Operation -Arguments @(
    '/i',
    "`"$MsiPath`"",
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot $LogName)`""
  ) | Out-Null
}

function Uninstall-W6bProduct {
  param(
    [Parameter(Mandatory = $true)][string]$ProductCode,
    [Parameter(Mandatory = $true)][string]$LogName
  )

  Invoke-EkyMsiExec -Operation 'w6b_uninstall' -Arguments @(
    '/x',
    $ProductCode,
    '/qn',
    '/norestart',
    '/l*v',
    "`"$(Join-Path $logRoot $LogName)`""
  ) | Out-Null
}

function Test-W6bUtilityDescendant {
  param([Parameter(Mandatory = $true)][int]$RootProcessId)

  $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $descendantIds = @($RootProcessId)
  do {
    $previousCount = $descendantIds.Count
    foreach ($candidate in $processes) {
      if (
        $descendantIds -contains [int]$candidate.ParentProcessId -and
        $descendantIds -notcontains [int]$candidate.ProcessId
      ) {
        $descendantIds += [int]$candidate.ProcessId
      }
    }
  } while ($descendantIds.Count -ne $previousCount)
  return @(
    $processes | Where-Object {
      $descendantIds -contains [int]$_.ProcessId -and
      $_.Name -eq 'Eky.exe' -and
      $_.CommandLine -match '--type=utility'
    }
  ).Count -gt 0
}

function Start-W6bEkyProcess {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments,
    [Parameter(Mandatory = $true)][hashtable]$EnvironmentOverrides
  )

  $executablePath = Join-Path $installRoot 'Eky.exe'
  if (!(Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw 'W6B_LEGACY_EXECUTABLE_MISSING'
  }
  $previousValues = @{}
  try {
    foreach ($name in $EnvironmentOverrides.Keys) {
      $previousValues[$name] = [Environment]::GetEnvironmentVariable(
        $name,
        [EnvironmentVariableTarget]::Process
      )
      [Environment]::SetEnvironmentVariable(
        $name,
        $EnvironmentOverrides[$name],
        [EnvironmentVariableTarget]::Process
      )
    }
    return Start-Process -FilePath $executablePath `
      -ArgumentList $Arguments -PassThru
  }
  finally {
    foreach ($name in $EnvironmentOverrides.Keys) {
      [Environment]::SetEnvironmentVariable(
        $name,
        $previousValues[$name],
        [EnvironmentVariableTarget]::Process
      )
    }
  }
}

function Start-W6bIsolatedEkyProcess {
  if ($null -eq $userDataRoot) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }
  return Start-W6bEkyProcess -Arguments @(
    "--user-data-dir=`"$userDataRoot`""
  ) -EnvironmentOverrides @{
    APPDATA = $isolatedAppDataRoot
    ELECTRON_RUN_AS_NODE = $null
  }
}

function Wait-W6bEkyAccepted {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][ValidateSet('source', 'target')]
    [string]$ExpectedIdentity,
    [Parameter(Mandatory = $true)][string]$SourceVersion,
    [Parameter(Mandatory = $true)][string]$SourceRevision,
    [Parameter(Mandatory = $true)][string]$TargetVersion,
    [Parameter(Mandatory = $true)][string]$TargetRevision
  )

  if ($null -eq $userDataRoot) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }
  $databasePath = Join-Path $userDataRoot 'runtime\data\eky.sqlite'
  $acceptedSlots = $null
  $acceptedBuildObserved = $false
  $backendUtilityObserved = $false
  $databaseObserved = $false
  $readinessFailureCode = 'W6B_LEGACY_ACCEPTED_BUILD_MISSING'
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 250
    $Process.Refresh()
    if ($Process.HasExited) {
      throw 'W6B_LEGACY_APPLICATION_EXITED_EARLY'
    }
    if (!$databaseObserved -and (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
      $databaseObserved = $true
      Write-W6bLegacyReadinessObservation -Signal databaseReady
    }
    if (!$backendUtilityObserved) {
      $backendUtilityObserved = Test-W6bUtilityDescendant `
        -RootProcessId $Process.Id
      if ($backendUtilityObserved) {
        Write-W6bLegacyReadinessObservation -Signal backendUtilityReady
      }
    }
    $acceptedSlots = Read-W6bAcceptedBuildIdentitySlots `
      -UserDataPath $userDataRoot `
      -SourceVersion $SourceVersion -SourceRevision $SourceRevision `
      -TargetVersion $TargetVersion -TargetRevision $TargetRevision
    if (
      $acceptedSlots.Current -eq 'invalid' -or
      $acceptedSlots.Legacy -eq 'invalid'
    ) {
      throw 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
    }
    if (
      $acceptedSlots.Current -eq 'missing' -and
      $acceptedSlots.Legacy -eq 'missing'
    ) {
      $readinessFailureCode = 'W6B_LEGACY_ACCEPTED_BUILD_MISSING'
      continue
    }
    if (!$acceptedBuildObserved) {
      $acceptedBuildObserved = $true
      Write-W6bLegacyReadinessObservation -Signal acceptedBuildReady
    }
    if ($ExpectedIdentity -eq 'source') {
      $sourceClass = if ($acceptedSlots.Current -ne 'missing') {
        $acceptedSlots.Current
      }
      else {
        $acceptedSlots.Legacy
      }
      if ($sourceClass -ne 'sourceIdentity') {
        $readinessFailureCode = 'W6B_LEGACY_ACCEPTED_BUILD_IDENTITY_MISMATCH'
        continue
      }
    }
    elseif ($acceptedSlots.Current -ne 'targetIdentity') {
      $readinessFailureCode = if (
        $acceptedSlots.Current -eq 'targetVersionDifferentRevision'
      ) {
        'W6B_LEGACY_TARGET_ACCEPTED_BUILD_REVISION_MISMATCH'
      }
      else {
        'W6B_LEGACY_ACCEPTED_BUILD_IDENTITY_MISMATCH'
      }
      continue
    }
    elseif (
      $acceptedSlots.Legacy -notin @('missing', 'sourceIdentity')
    ) {
      $readinessFailureCode = 'W6B_LEGACY_ACCEPTED_BUILD_DUPLICATE_INVALID'
      continue
    }
    if (
      $ExpectedIdentity -eq 'target' -and
      $acceptedSlots.Current -eq 'targetIdentity'
    ) {
      $script:TargetCurrentAcceptedBuildClass = $acceptedSlots.Current
      $script:TargetLegacyAcceptedBuildClass = $acceptedSlots.Legacy
    }
    if (!$backendUtilityObserved) {
      $readinessFailureCode = 'W6B_LEGACY_BACKEND_UTILITY_MISSING'
      continue
    }
    if (
      $script:CurrentStage -in @(
        'targetFirstStartup',
        'targetSecondStartup'
      )
    ) {
      Write-W6bLegacyReadinessObservation -Signal backendHealthReady
      Write-W6bLegacyReadinessObservation -Signal runtimeSessionValidated
    }
    return
  } while ([DateTime]::UtcNow -lt $deadline)
  if (!$databaseObserved) {
    throw 'W6B_LEGACY_DATABASE_MISSING_AT_STARTUP'
  }
  if (
    $null -ne $acceptedSlots -and
    $readinessFailureCode -eq 'W6B_LEGACY_ACCEPTED_BUILD_IDENTITY_MISMATCH'
  ) {
    throw $readinessFailureCode
  }
  if (!$backendUtilityObserved) {
    throw 'W6B_LEGACY_BACKEND_UTILITY_MISSING'
  }
  throw $readinessFailureCode
}

function Assert-W6bNoEkyProcesses {
  if (@(Get-Process -Name 'Eky' -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'W6B_LEGACY_ORPHAN_PROCESS_REMAINS'
  }
}

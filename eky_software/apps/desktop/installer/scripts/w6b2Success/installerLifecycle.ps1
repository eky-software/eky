Set-StrictMode -Version Latest

function Normalize-W6b2SuccessProductCode {
  param([Parameter(Mandatory = $true)][string]$Code)

  if ($Code -cnotmatch '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$') {
    throw 'W6B2_SUCCESS_PRODUCT_CODE_INVALID'
  }
  return "{$Code}"
}

function Assert-W6b2SuccessProductAbsent {
  param(
    [Parameter(Mandatory = $true)]$Installer,
    [Parameter(Mandatory = $true)][string]$ProductCode
  )

  if ((Get-EkyProductState -Installer $Installer -Code $ProductCode) -ge 1) {
    throw 'W6B2_SUCCESS_PRODUCT_UNEXPECTED'
  }
}

function Assert-W6b2SuccessProductInstalled {
  param(
    [Parameter(Mandatory = $true)]$Installer,
    [Parameter(Mandatory = $true)][string]$ProductCode
  )

  if ((Get-EkyProductState -Installer $Installer -Code $ProductCode) -lt 1) {
    throw 'W6B2_SUCCESS_PRODUCT_MISSING'
  }
}

function Invoke-W6b2SuccessMsiExec {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Operation
  )

  $policy = Get-EkyMsiExecPolicy -Operation $Operation
  $process = $null
  $identity = $null
  try {
    $process = Start-EkyOwnedMsiExecHost -Arguments $Arguments
    $identity = New-EkyOwnedMsiProcessIdentity -Process $process
    $deadline = [DateTime]::UtcNow.AddMilliseconds(
      $policy.timeoutMilliseconds
    )
    do {
      $process.Refresh()
      if ($process.HasExited) {
        Assert-EkyMsiExecExitCode -ExitCode ([int]$process.ExitCode) `
          -Operation $Operation
        return
      }
      if ([DateTime]::UtcNow -ge $deadline) {
        Stop-EkyOwnedMsiProcess -Process $process -Identity $identity
        throw "$($policy.errorPrefix)_TIMEOUT"
      }
      Write-W6b2SuccessHeartbeat
      Start-Sleep -Milliseconds 250
    } while ($true)
  }
  catch {
    if ($null -ne $process) {
      try {
        $process.Refresh()
        if (!$process.HasExited -and $null -ne $identity) {
          Stop-EkyOwnedMsiProcess -Process $process -Identity $identity
        }
      }
      catch {}
    }
    throw
  }
  finally {
    if ($null -ne $process) {
      $process.Dispose()
    }
  }
}

function Install-W6b2SuccessSourcePackage {
  param(
    [Parameter(Mandatory = $true)][string]$MsiPath,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  Invoke-W6b2SuccessMsiExec -Operation w6b2_source_install -Arguments @(
    '/i',
    $MsiPath,
    '/qn',
    '/norestart',
    '/L*v',
    $LogPath
  )
}

function Uninstall-W6b2SuccessPackage {
  param(
    [Parameter(Mandatory = $true)][string]$ProductCode,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  Invoke-W6b2SuccessMsiExec -Operation w6b2_uninstall -Arguments @(
    '/x',
    $ProductCode,
    '/qn',
    '/norestart',
    '/L*v',
    $LogPath
  )
}

function Wait-W6b2SuccessTargetInstallation {
  param(
    [Parameter(Mandatory = $true)]$Installer,
    [Parameter(Mandatory = $true)][string]$SourceProductCode,
    [Parameter(Mandatory = $true)][string]$TargetProductCode,
    [int]$TimeoutMilliseconds = 300000
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    $sourceState = Get-EkyProductState -Installer $Installer `
      -Code $SourceProductCode
    $targetState = Get-EkyProductState -Installer $Installer `
      -Code $TargetProductCode
    $msiProcesses = @(Get-W6b2SuccessCurrentSessionMsiProcesses)
    if ($sourceState -lt 1 -and $targetState -ge 1 -and $msiProcesses.Count -eq 0) {
      return
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw 'W6B2_SUCCESS_TARGET_INSTALL_TIMEOUT'
    }
    Write-W6b2SuccessHeartbeat
    Start-Sleep -Milliseconds 250
  } while ($true)
}

function Get-W6b2SuccessCurrentSessionMsiProcesses {
  $currentSessionId = (Get-Process -Id $PID -ErrorAction Stop).SessionId
  return @(
    Get-Process -Name msiexec -ErrorAction SilentlyContinue |
      Where-Object { $_.SessionId -eq $currentSessionId }
  )
}

function Assert-W6b2SuccessNoApplicationOrMsiProcesses {
  if (
    @(Get-Process -Name Eky -ErrorAction SilentlyContinue).Count -ne 0 -or
    @(Get-W6b2SuccessCurrentSessionMsiProcesses).Count -ne 0
  ) {
    throw 'W6B2_SUCCESS_FOREIGN_PROCESS_PRESENT'
  }
}

Set-StrictMode -Version Latest

function Resolve-EkyRunningUpgradeOutcome {
  param(
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $true)]$State
  )

  if ($ExitCode -in @(1641, 3010)) {
    throw 'INSTALLER_UPGRADE_RESTART_REQUIRED_FORBIDDEN'
  }
  if ($ExitCode -ne 0 -and $ExitCode -ne 1603) {
    throw 'INSTALLER_UPGRADE_RUNNING_PROCESS_OUTCOME_UNKNOWN'
  }
  if (!$State.BusinessDataUnchanged -or !$State.ShortcutPresent) {
    throw 'INSTALLER_UPGRADE_MIXED_VERSION_STATE'
  }

  if ($ExitCode -eq 0) {
    if (
      $State.CurrentProductInstalled -or
      $State.CurrentPayloadMatches -or
      !$State.CandidateProductInstalled -or
      !$State.CandidatePayloadMatches -or
      !$State.CandidateRegistrationMatches -or
      $State.CurrentRegistrationPresent
    ) {
      throw 'INSTALLER_UPGRADE_MIXED_VERSION_STATE'
    }
    return 'succeeded'
  }

  if (
    !$State.CurrentProductInstalled -or
    $State.CandidateProductInstalled -or
    $State.CandidatePayloadMatches -or
    !$State.CurrentPayloadMatches -or
    !$State.CurrentRegistrationMatches -or
    $State.CandidateRegistrationPresent
  ) {
    throw 'INSTALLER_UPGRADE_MIXED_VERSION_STATE'
  }
  return 'blocked-cleanly'
}

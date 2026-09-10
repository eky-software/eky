function failure(code) { throw new Error(code); }

// Coordinates only this scenario's graceful handoff. The existing Job owns all forced cleanup.
export async function coordinateRunningApplicationUpgrade({
  startApplication, startUpgrade, verifyBlockedSource, resumeUpgrade,
}) {
  let application, installer;
  let applicationClosed = false, applicationCloseAttempted = false, installerClosed = false;
  let errorCode = null, cleanupResultCode = 'completed', exitCode = null;
  let boundary = null, initialExitCode = null;
  const closeApplication = async () => {
    if (application && !applicationClosed) {
      if (applicationCloseAttempted) failure('runningUpgradeShutdownFailed');
      applicationCloseAttempted = true;
      try { await application.close(); }
      catch { failure('runningUpgradeShutdownFailed'); }
      applicationClosed = true;
    }
  };
  try {
    application = await startApplication();
    await application.ready;
    if (!application.isRunning()) failure('runningUpgradeApplicationExitedEarly');
    installer = await startUpgrade();
    const first = await Promise.race([
      installer.validation.then(() => 'validationObserved'),
      installer.completion.then(() => 'installerExited'),
      application.completion.then(() => 'applicationExited'),
    ]);
    boundary = first;
    if (first === 'applicationExited') failure('runningUpgradeApplicationExitedEarly');
    if (first === 'validationObserved' && !application.isRunning()) failure('runningUpgradeApplicationExitedEarly');
    await closeApplication();
    await application.verifyShutdown();
    const initial = await installer.completion;
    initialExitCode = initial.exitCode;
    installerClosed = true;
    if (!initial.protocolValid || !initial.validationObserved || !initial.callbackValid)
      failure('runningUpgradeValidationInvalid');
    if (initial.exitCode === 1603) {
      // An explicit blocked-Setup continuation, not a retry of an unexplained failure.
      await verifyBlockedSource();
      boundary = 'blockedSourcePreserved';
      exitCode = await resumeUpgrade();
    } else {
      exitCode = initial.exitCode;
    }
    if (exitCode !== 0) failure('runningUpgradeMsiFailed');
  } catch (error) {
    errorCode = ['installerStateInspectionFailed', 'runningUpgradeApplicationExitedEarly', 'runningUpgradeApplicationFailed',
      'runningUpgradeShutdownFailed', 'runningUpgradeMsiFailed', 'runningUpgradeValidationInvalid',
      'runningUpgradeBlockedSourceChanged'].includes(error?.message) ? error.message : 'runningUpgradeFailed';
  } finally {
    try { await closeApplication(); } catch { cleanupResultCode = 'cleanupUnverified'; }
    if (installer && !installerClosed) {
      try { initialExitCode = (await installer.completion).exitCode; }
      catch { cleanupResultCode = 'cleanupUnverified'; }
    }
  }
  return Object.freeze({ status: errorCode === null ? 'completed' : 'failed', errorCode,
    cleanupResultCode, exitCode, initialExitCode, boundary });
}

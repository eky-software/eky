function failure(code) { throw new Error(code); }

// Coordinates only this scenario's graceful handoff. The existing Job owns all forced cleanup.
export async function coordinateRunningApplicationUpgrade({
  startApplication, createValidationObserver, startUpgrade, verifyBlockedSource, resumeUpgrade,
}) {
  let application, installer, observer;
  let applicationClosed = false, applicationCloseAttempted = false, installerClosed = false;
  let errorCode = null, cleanupResultCode = 'completed', exitCode = null;
  let boundary = null;
  const closeApplication = async () => {
    if (application && !applicationClosed) {
      if (applicationCloseAttempted) failure('runningUpgradeShutdownFailed');
      applicationCloseAttempted = true;
      await application.close();
      applicationClosed = true;
    }
  };
  try {
    application = await startApplication();
    await application.ready;
    if (!application.isRunning()) failure('runningUpgradeApplicationExitedEarly');
    observer = await createValidationObserver();
    if (!application.isRunning()) failure('runningUpgradeApplicationExitedEarly');
    installer = await startUpgrade();
    const first = await Promise.race([
      observer.completion.then(() => 'validationObserved'),
      installer.completion.then(() => 'installerExited'),
      application.completion.then(() => 'applicationExited'),
    ]);
    boundary = first;
    await closeApplication();
    await application.verifyShutdown();
    const initial = await installer.completion;
    installerClosed = true;
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
    try { await observer?.close(); } catch { errorCode ??= 'runningUpgradeValidationInvalid'; }
    try { await closeApplication(); } catch { cleanupResultCode = 'cleanupUnverified'; }
    if (installer && !installerClosed) {
      try { await installer.completion; } catch { cleanupResultCode = 'cleanupUnverified'; }
    }
  }
  return Object.freeze({ status: errorCode === null ? 'completed' : 'failed', errorCode,
    cleanupResultCode, exitCode, boundary });
}

'use strict';

// This closed marker is emitted by the reviewed playwright-core launch patch.
const CLEANUP_UNVERIFIED_MARKER = 'electronLaunchCleanupUnverified';

function isExpectedElectronLaunchFailure(error, TimeoutError) {
  return error instanceof Error &&
    !(error instanceof TimeoutError) &&
    !error.message.includes(CLEANUP_UNVERIFIED_MARKER);
}

module.exports = { CLEANUP_UNVERIFIED_MARKER, isExpectedElectronLaunchFailure };

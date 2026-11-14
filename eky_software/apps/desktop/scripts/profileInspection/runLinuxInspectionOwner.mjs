import { setTimeout as delay } from 'node:timers/promises';
import { assertInspectionProofResult, requireInspectionProof } from './linuxProfileInspectionContract.mjs';

// One finite host uses the existing service owner. A root exit, host receipt and
// complete owner stop are separate requirements; none substitutes for another.
export async function runLinuxInspectionOwner({ config, paths, repository, lifetime, startupDeadline }, {
  start, readResult, wait = delay, observeException,
}) {
  let session;
  let output;
  let result;
  let phase = 'ownerStart';
  let originalFailure = false;
  let cleanupFailure = false;
  let tree = 'unverified';
  try {
    session = await start('profileInspection', { repositoryRoot: repository, runRoot: paths.runRoot,
      inspectionConfigPath: paths.config, redactedValues: [], lifetime, startupDeadline });
    output = session;
    phase = 'hostExit';
    for (;;) {
      requireInspectionProof(lifetime.readRemainingWorkMilliseconds() > 0);
      const state = await session.workload.readState();
      if (state === 'exited') break;
      requireInspectionProof(state === 'running');
      await wait(Math.min(25, lifetime.readRemainingWorkMilliseconds()));
    }
    phase = 'hostResult';
    result = await readResult(paths.result);
    assertInspectionProofResult(result, config);
  } catch (error) {
    try { observeException?.(error, phase); } catch { /* Reporting cannot replace the failure. */ }
    originalFailure = true;
    if (!session && error?.evidence?.processTree === 'stopped') tree = 'stopped';
    if (!session && typeof error?.readStdout === 'function' && typeof error?.readStderr === 'function') output = error;
  } finally {
    if (session) {
      try { await session.stop(); tree = 'stopped'; }
      catch (error) {
        try { observeException?.(error, 'ownerCleanup'); } catch { /* Keep cleanup separate. */ }
        cleanupFailure = true;
        if (error?.evidence?.processTree === 'stopped') tree = 'stopped';
      }
    }
  }
  // Capture only the already bounded/redacted output after owned cleanup.
  let streams;
  try { if (output) streams = { stdout: output.readStdout(), stderr: output.readStderr() }; } catch { /* Mark unavailable. */ }
  return { status: originalFailure || cleanupFailure ? 'failed' : 'passed', phase,
    originalFailure, cleanupFailure,
    processTree: tree, result: result ?? null, output: streams ?? null };
}

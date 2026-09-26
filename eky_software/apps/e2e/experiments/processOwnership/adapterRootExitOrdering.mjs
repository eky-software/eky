import assert from 'node:assert/strict';
import { validateRootBeforeStop, validateState } from './adapterContract.mjs';

// Capture the original launch, not a deadline/error race that may settle first.
export function captureLaunchOutcome(startLaunch) {
  let launch;
  try { launch = Promise.resolve(startLaunch()); }
  catch (error) { launch = Promise.reject(error); }
  return launch.then(application => ({ status: 'fulfilled', application }),
    error => ({ status: 'rejected', error }));
}

export async function stopRootBeforeBridge({ observeRoot, stopOwner, settleBridge,
  expectedExitCode, deadline, now = () => performance.now() }) {
  const checkDeadline = () => assert.ok(Number.isFinite(deadline) && now() < deadline, 'adapterDeadlineExceeded');
  checkDeadline();
  // Control requests own their bounded waits: never race one against a second stop.
  const observed = await observeRoot();
  checkDeadline();
  const rootBeforeStop = Object.freeze({ ...validateRootBeforeStop(observed, expectedExitCode) });
  const terminal = await stopOwner();
  checkDeadline();
  validateState(terminal, true);
  assert.equal(terminal.rootExitCode, expectedExitCode);
  assert.equal(terminal.descendantsAfterRoot, true);
  // A live descendant can hold the bridge's inherited stdout/stderr open.
  const bridgeOutcome = await settleBridge();
  checkDeadline();
  return { rootBeforeStop, bridgeOutcome };
}

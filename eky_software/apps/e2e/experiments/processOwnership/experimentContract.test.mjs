import assert from 'node:assert/strict';
import { test } from 'node:test';
import { experimentEnvironment, validateTerminal } from './experimentContract.mjs';

const nonce = 'a'.repeat(64);
const terminal = {
  schemaVersion: 1, nonce, scenario: 'nodeRootFirst', reason: 'stopRequested',
  cleanup: 'processTreeAbsent', processTreeAbsent: true, creationCompleted: true,
  rootExitObserved: true, descendantsAfterRoot: true, childExitCode: 0,
};

test('feasibility result requires exact generation and tree absence, not just root exit', () => {
  assert.equal(validateTerminal(terminal, 'nodeRootFirst', nonce), terminal);
  for (const patch of [
    { nonce: 'b'.repeat(64) }, { processTreeAbsent: false }, { creationCompleted: false },
    { cleanup: 'cleanupUnverified' }, { reason: 'deadlineExceeded' }, { reason: 'controlLost' },
    { rootExitObserved: false }, { descendantsAfterRoot: false }, { childExitCode: 1 },
    { unexpected: 'field' }, { scenario: 'electronNormal' },
  ]) assert.throws(() => validateTerminal({ ...terminal, ...patch }, 'nodeRootFirst', nonce));
});

test('expected failing workload is a feasibility observation, not a passing production test', () => {
  const failure = { ...terminal, scenario: 'nodeRootFailure', childExitCode: 23 };
  assert.equal(validateTerminal(failure, 'nodeRootFailure', nonce), failure);
  assert.throws(() => validateTerminal({ ...failure, childExitCode: 0 }, 'nodeRootFailure', nonce));
});

test('stopping a running tree preserves the termination exit code', () => {
  const stopped = { ...terminal, scenario: 'nodeStop', rootExitObserved: false,
    descendantsAfterRoot: false, childExitCode: 1 };
  assert.equal(validateTerminal(stopped, 'nodeStop', nonce), stopped);
  assert.throws(() => validateTerminal({ ...stopped, childExitCode: 0 }, 'nodeStop', nonce));
});

test('normal Electron close still needs whole-tree absence after driver exit', () => {
  const normal = { ...terminal, scenario: 'electronNormal', reason: 'naturalExit' };
  for (const descendantsAfterRoot of [true, false]) {
    const value = { ...normal, descendantsAfterRoot };
    assert.equal(validateTerminal(value, 'electronNormal', nonce), value);
  }
  assert.throws(() => validateTerminal({ ...normal, processTreeAbsent: false }, 'electronNormal', nonce));
});

test('an unexpected launch-fixture failure cannot be relabeled as expected rejection', () => {
  const failure = { ...terminal, scenario: 'electronLaunchFailure', childExitCode: 1 };
  assert.throws(() => validateTerminal(failure, 'electronLaunchFailure', nonce));
  const expected = { ...failure, childExitCode: 0 };
  assert.equal(validateTerminal(expected, 'electronLaunchFailure', nonce), expected);
});

test('child environment is allowlisted and excludes inherited execution hooks and secrets', () => {
  const environment = experimentEnvironment({
    SystemRoot: 'synthetic-system', NODE_OPTIONS: '--require hostile',
    ELECTRON_RUN_AS_NODE: '1', SECRET: 'not-for-child', APPDATA: 'real-profile',
  }, { root: 'synthetic-root', scenario: 'nodeStop', node: 'node', electron: 'electron', e2ePackage: 'package', profile: 'synthetic-profile' });
  assert.equal(environment.SystemRoot, 'synthetic-system');
  assert.equal(environment.APPDATA, 'synthetic-profile');
  assert.equal(environment.EKY_E2E, '1');
  for (const key of ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'SECRET']) assert.equal(key in environment, false);
});

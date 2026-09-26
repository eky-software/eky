import assert from 'node:assert/strict';

export const adapterCases = Object.freeze(['normal', 'beforeReady', 'rootFirst', 'bridgeExit']);
export const controlLimit = 4096;
export const streamLimit = 64 * 1024;
export const adapterWorkBudget = 20_000;
export const outerObservationBudget = 35_000;
export const bridgeDrainFile = 'adapter-bridge-drain.private.json';
export const bridgeDrainLimit = 1024;
export const bridgeFailureFile = 'adapter-bridge-failure.private.json';
export const workloadOutcomes = Object.freeze({ normal: 'completed', beforeReady: 'expectedLaunchFailure',
  rootFirst: 'expectedRootExit', bridgeExit: 'expectedBridgeFailure' });
const tokenPattern = /^[a-f0-9]{64}$/;
const stateKeys = ['launched', 'creationCompleted', 'rootExited', 'rootExitCode', 'activeProcesses',
  'assignedBeforeResume', 'descendantsAfterRoot', 'bridgeLost', 'cleanup', 'failure'];

export function exactKeys(value, keys) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'invalidObject');
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'unexpectedFields');
}

export function requireToken(value) {
  assert.ok(typeof value === 'string' && tokenPattern.test(value), 'invalidGeneration');
  return value;
}

export function encodeFrame(value) {
  const frame = Buffer.from(JSON.stringify(value) + '\n');
  assert.ok(frame.length <= controlLimit, 'controlFrameOverflow');
  return frame;
}

export function createFrameReader(accept) {
  let pending = Buffer.alloc(0);
  let failed = false;
  return {
    push(chunk) {
      assert.equal(failed, false, 'controlAlreadyFailed');
      try {
        // Process one frame at a time so a burst cannot allocate an unbounded buffer.
        for (const byte of chunk) {
          assert.ok(pending.length < controlLimit, 'controlFrameOverflow');
          if (byte === 10) {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(pending);
            pending = Buffer.alloc(0);
            accept(JSON.parse(text));
          } else pending = Buffer.concat([pending, Buffer.from([byte])]);
        }
      } catch (error) { failed = true; throw error; }
    },
    end() { assert.equal(pending.length, 0, 'truncatedControlFrame'); },
  };
}

export function validateState(state, terminal = false) {
  exactKeys(state, stateKeys);
  for (const name of ['launched', 'creationCompleted', 'rootExited', 'assignedBeforeResume',
    'descendantsAfterRoot', 'bridgeLost']) assert.equal(typeof state[name], 'boolean');
  assert.ok(state.rootExitCode === null || Number.isInteger(state.rootExitCode));
  assert.ok(Number.isInteger(state.activeProcesses) && state.activeProcesses >= 0);
  assert.ok(['pending', 'processTreeAbsent', 'cleanupUnverified'].includes(state.cleanup));
  assert.ok(state.failure === null || (typeof state.failure === 'string' && /^[a-z][A-Za-z]{0,63}$/.test(state.failure)));
  if (state.rootExited) assert.ok(Number.isInteger(state.rootExitCode));
  else assert.equal(state.rootExitCode, null);
  if (state.assignedBeforeResume) assert.equal(state.launched, true);
  if (terminal) {
    assert.equal(state.launched, true);
    assert.equal(state.assignedBeforeResume, true);
    assert.equal(state.creationCompleted, true);
    assert.equal(state.rootExited, true);
    assert.equal(state.activeProcesses, 0);
    assert.equal(state.cleanup, 'processTreeAbsent');
    assert.equal(state.failure, null);
  }
  return state;
}

export function validateResponse(value, generation, sequence, kind) {
  exactKeys(value, ['schemaVersion', 'generation', 'sequence', 'kind', 'state']);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.generation, requireToken(generation));
  assert.ok(Number.isSafeInteger(sequence) && sequence > 0);
  assert.equal(value.sequence, sequence, 'staleControlResponse');
  assert.equal(value.kind, kind);
  return validateState(value.state, kind === 'terminal');
}

export function validateAdapterTerminal(value, generation) {
  exactKeys(value, ['schemaVersion', 'generation', 'state']);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.generation, requireToken(generation));
  return validateState(value.state, true);
}

export function validateRootBeforeStop(state, expectedExitCode) {
  validateState(state);
  assert.ok(expectedExitCode === 0 || expectedExitCode === 29);
  for (const name of ['launched', 'creationCompleted', 'assignedBeforeResume', 'rootExited', 'descendantsAfterRoot'])
    assert.equal(state[name], true);
  assert.equal(state.rootExitCode, expectedExitCode);
  assert.ok(state.activeProcesses > 0, 'descendantMissingBeforeStop');
  assert.equal(state.cleanup, 'pending');
  assert.equal(state.bridgeLost, false);
  assert.equal(state.failure, null);
  return state;
}

// This is pre-exit drain proof, never an observed bridge process exit.
export function parseBridgeDrainCompletion(bytes, generation, expectedExitCode) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= bridgeDrainLimit, 'bridgeDrainOverflow');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return validateBridgeDrainCompletion(JSON.parse(text), generation, expectedExitCode);
}

export function validateBridgeDrainCompletion(value, generation, expectedExitCode) {
  exactKeys(value, ['schemaVersion', 'generation', 'kind', 'intendedExitCode']);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.generation, requireToken(generation));
  assert.equal(value.kind, 'drainCompleted');
  assert.ok([0, 29, 41].includes(expectedExitCode));
  assert.equal(value.intendedExitCode, expectedExitCode);
  return value;
}

export function validateCaseEvidence(value, scenario, generation) {
  exactKeys(value, ['schemaVersion', 'generation', 'scenario', 'workloadOutcome', 'bridgeExitCode',
    'rootBeforeStop', 'bridgeDrainCompletion', 'checks', 'terminal']);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.generation, generation);
  assert.equal(value.scenario, scenario);
  assert.ok(adapterCases.includes(scenario));
  assert.equal(value.workloadOutcome, workloadOutcomes[scenario]);
  assert.equal(value.bridgeExitCode, scenario === 'beforeReady' ? null : scenario === 'bridgeExit' ? 41 : 0);
  const common = ['ownerExited', 'terminalAccepted', 'outerInterventionAbsent'];
  const normal = ['pageApi', 'arguments', 'environment', 'cwd', 'sandbox', 'stdio', 'normalClose'];
  const names = scenario === 'normal' ? [...common, ...normal]
    : scenario === 'beforeReady' ? [...common, 'launchRejected', 'beforeReady', 'leafAcknowledged', 'notTimeout', 'descendantsAfterRoot', 'bridgeFailureAbsent']
      : scenario === 'rootFirst' ? [...common, 'pageApi', 'rootExitObserved', 'descendantsAfterRoot']
        : [...common, 'pageApi', 'bridgeExitObserved', 'rootStillAlive', 'ownerStillAlive'];
  exactKeys(value.checks, names);
  for (const check of names) assert.equal(value.checks[check], true, `missingCheck:${check}`);
  if (scenario === 'beforeReady' || scenario === 'rootFirst')
    validateRootBeforeStop(value.rootBeforeStop, scenario === 'beforeReady' ? 29 : 0);
  else assert.equal(value.rootBeforeStop, null);
  if (scenario === 'beforeReady') validateBridgeDrainCompletion(value.bridgeDrainCompletion, generation, 29);
  else assert.equal(value.bridgeDrainCompletion, null);
  validateState(value.terminal, true);
  if (scenario === 'normal') assert.equal(value.terminal.rootExitCode, 0);
  if (scenario === 'beforeReady') assert.equal(value.terminal.rootExitCode, 29);
  if (scenario === 'rootFirst') assert.equal(value.terminal.rootExitCode, 0);
  if (scenario === 'beforeReady' || scenario === 'rootFirst') assert.equal(value.terminal.descendantsAfterRoot, true);
  if (scenario === 'bridgeExit') assert.equal(value.terminal.bridgeLost, true);
  return value;
}

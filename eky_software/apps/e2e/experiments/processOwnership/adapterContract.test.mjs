import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adapterCases, bridgeDrainLimit, controlLimit, createFrameReader, encodeFrame, parseBridgeDrainCompletion, validateAdapterTerminal,
  validateBridgeDrainCompletion, validateCaseEvidence, validateResponse, validateState } from './adapterContract.mjs';

const generation = 'a'.repeat(64);
const state = () => ({ launched: true, creationCompleted: true, rootExited: true, rootExitCode: 0,
  activeProcesses: 0, assignedBeforeResume: true, descendantsAfterRoot: false, bridgeLost: false,
  cleanup: 'processTreeAbsent', failure: null });
const response = () => ({ schemaVersion: 1, generation, sequence: 1, kind: 'terminal', state: state() });
const drainReceipt = (intendedExitCode = 29) => ({ schemaVersion: 1, generation, kind: 'drainCompleted', intendedExitCode });

test('drain receipt enforces its byte bound before parsing, including whitespace padding', () => {
  const json = Buffer.from(JSON.stringify(drainReceipt()));
  const exact = Buffer.concat([json, Buffer.alloc(bridgeDrainLimit - json.length, 32)]);
  assert.deepEqual(parseBridgeDrainCompletion(exact, generation, 29), drainReceipt());
  assert.throws(() => parseBridgeDrainCompletion(Buffer.concat([exact, Buffer.from(' ')]), generation, 29), /bridgeDrainOverflow/);
  assert.throws(() => parseBridgeDrainCompletion(Buffer.alloc(bridgeDrainLimit + 1, 0xff), generation, 29), /bridgeDrainOverflow/);
  assert.throws(() => parseBridgeDrainCompletion(Buffer.from([0xff]), generation, 29));
});

test('adapter control accepts fragmented UTF-8 and multiple bounded frames', () => {
  const result = [];
  const reader = createFrameReader(value => result.push(value));
  const frame = encodeFrame({ marker: 'synthetic' });
  for (const byte of frame) reader.push(Buffer.from([byte]));
  reader.push(Buffer.concat([frame, frame]));
  reader.end();
  assert.equal(result.length, 3);
});

for (const [name, bytes] of [
  ['overflow', Buffer.alloc(controlLimit + 1, 65)], ['invalidUtf8', Buffer.from([0xff, 10])],
  ['invalidJson', Buffer.from('not-json\n')], ['empty', Buffer.from('\n')],
]) test(`adapter control rejects ${name}`, () => {
  const reader = createFrameReader(() => {});
  assert.throws(() => reader.push(bytes));
  assert.throws(() => reader.push(encodeFrame({})), /controlAlreadyFailed/);
});

test('adapter frame limits are symmetric including the delimiter', () => {
  assert.throws(() => encodeFrame({ text: 'x'.repeat(controlLimit) }), /controlFrameOverflow/);
  const reader = createFrameReader(() => {});
  reader.push(Buffer.from('{'));
  assert.throws(() => reader.end(), /truncatedControlFrame/);
});

test('terminal binds the exact generation, sequence, kind and closed schema', () => {
  validateResponse(response(), generation, 1, 'terminal');
  for (const change of [{ generation: 'b'.repeat(64) }, { sequence: 0 }, { sequence: 2 },
    { kind: 'snapshot' }, { schemaVersion: 2 }, { rawPath: 'private' }]) {
    assert.throws(() => validateResponse({ ...response(), ...change }, generation, 1, 'terminal'));
  }
  assert.throws(() => validateResponse(response(), 'invalid', 1, 'terminal'));
});

for (const [field, value] of [['launched', false], ['creationCompleted', false], ['rootExited', false],
  ['assignedBeforeResume', false], ['activeProcesses', 1], ['cleanup', 'cleanupUnverified'],
  ['failure', 'deadlineExceeded'], ['rootExitCode', null], ['unexpected', true]]) {
  test(`terminal does not accept missing or uncertain ${field}`, () => {
    assert.throws(() => validateState({ ...state(), [field]: value }, true));
  });
}

test('root exit and empty tree are independent observations', () => {
  validateState({ ...state(), activeProcesses: 2, descendantsAfterRoot: true, cleanup: 'pending' });
  assert.throws(() => validateState({ ...state(), rootExited: false }));
  assert.throws(() => validateState({ ...state(), activeProcesses: -1 }));
});

test('disk terminal is not interchangeable with a control response', () => {
  validateAdapterTerminal({ schemaVersion: 1, generation, state: state() }, generation);
  assert.throws(() => validateAdapterTerminal(response(), generation));
});

test('four experiment cases require their own explicit evidence; root-only success fails', () => {
  assert.deepEqual(adapterCases, ['normal', 'beforeReady', 'rootFirst', 'bridgeExit']);
  const checks = { ownerExited: true, terminalAccepted: true, outerInterventionAbsent: true,
    pageApi: true, arguments: true, environment: true, cwd: true, sandbox: true, stdio: true, normalClose: true };
  const value = { schemaVersion: 1, generation, scenario: 'normal', workloadOutcome: 'completed', bridgeExitCode: 0,
    rootBeforeStop: null, bridgeDrainCompletion: null, checks, terminal: state() };
  validateCaseEvidence(value, 'normal', generation);
  for (const name of Object.keys(checks)) {
    assert.throws(() => validateCaseEvidence({ ...value, checks: { ...checks, [name]: false } }, 'normal', generation));
  }
  for (const scenario of adapterCases.slice(1)) assert.throws(() => validateCaseEvidence(value, scenario, generation));
  assert.throws(() => validateCaseEvidence({ ...value, rawError: 'private' }, 'normal', generation));
});

for (const [scenario, workloadOutcome, specific, exitCode] of [
  ['beforeReady', 'expectedLaunchFailure', ['launchRejected', 'beforeReady', 'leafAcknowledged', 'notTimeout', 'descendantsAfterRoot', 'bridgeFailureAbsent'], 29],
  ['rootFirst', 'expectedRootExit', ['pageApi', 'rootExitObserved', 'descendantsAfterRoot'], 0],
  ['bridgeExit', 'expectedBridgeFailure', ['pageApi', 'bridgeExitObserved', 'rootStillAlive', 'ownerStillAlive'], 1],
]) test(`${scenario} cannot relabel its failure or omit a required proof`, () => {
  const checks = Object.fromEntries([...specific, 'ownerExited', 'terminalAccepted', 'outerInterventionAbsent'].map(name => [name, true]));
  const terminal = { ...state(), rootExitCode: exitCode, descendantsAfterRoot: scenario !== 'bridgeExit', bridgeLost: scenario === 'bridgeExit' };
  const bridgeExitCode = scenario === 'beforeReady' ? null : scenario === 'bridgeExit' ? 41 : 0;
  const rootBeforeStop = scenario === 'bridgeExit' ? null : { ...terminal, activeProcesses: 1, cleanup: 'pending' };
  const bridgeDrainCompletion = scenario === 'beforeReady' ? drainReceipt() : null;
  const value = { schemaVersion: 1, generation, scenario, workloadOutcome, bridgeExitCode,
    rootBeforeStop, bridgeDrainCompletion, checks, terminal };
  validateCaseEvidence(value, scenario, generation);
  assert.throws(() => validateCaseEvidence({ ...value, workloadOutcome: 'completed' }, scenario, generation));
  assert.throws(() => validateCaseEvidence({ ...value, bridgeExitCode: 2 }, scenario, generation));
  for (const name of Object.keys(checks)) {
    const missing = { ...checks };
    delete missing[name];
    assert.throws(() => validateCaseEvidence({ ...value, checks: missing }, scenario, generation));
  }
  assert.throws(() => validateCaseEvidence({ ...value, terminal: { ...terminal, activeProcesses: 1 } }, scenario, generation));
  if (scenario !== 'bridgeExit') {
    assert.throws(() => validateCaseEvidence({ ...value, rootBeforeStop: null }, scenario, generation));
    assert.throws(() => validateCaseEvidence({ ...value, rootBeforeStop: terminal }, scenario, generation));
  }
  if (scenario === 'beforeReady') {
    assert.throws(() => validateCaseEvidence({ ...value, bridgeDrainCompletion: null }, scenario, generation));
    assert.throws(() => validateCaseEvidence({ ...value, bridgeDrainCompletion: drainReceipt(1) }, scenario, generation));
    assert.throws(() => validateCaseEvidence({ ...value, bridgeExitCode: 29 }, scenario, generation));
  } else {
    assert.throws(() => validateCaseEvidence({ ...value, bridgeExitCode: null, bridgeDrainCompletion: drainReceipt(0) }, scenario, generation));
  }
});

test('drain completion requires the closed generation-bound pre-exit schema', () => {
  for (const code of [0, 29, 41]) validateBridgeDrainCompletion(drainReceipt(code), generation, code);
  for (const change of [{ schemaVersion: 2 }, { generation: 'b'.repeat(64) }, { kind: 'exitObserved' },
    { intendedExitCode: 0 }, { intendedExitCode: '29' }, { actualExitCode: 29 }, { exitObserved: true }]) {
    assert.throws(() => validateBridgeDrainCompletion({ ...drainReceipt(), ...change }, generation, 29));
  }
  assert.throws(() => validateBridgeDrainCompletion(drainReceipt(1), generation, 1));
  for (const name of Object.keys(drainReceipt())) {
    const missing = drainReceipt();
    delete missing[name];
    assert.throws(() => validateBridgeDrainCompletion(missing, generation, 29));
  }
});

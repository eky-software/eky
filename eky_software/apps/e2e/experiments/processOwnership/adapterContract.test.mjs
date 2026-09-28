import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compileFunction } from 'node:vm';
import * as contract from './adapterContract.mjs';
import { adapterCases, bridgeDrainLimit, controlLimit, createFrameReader, encodeFrame, parseBridgeDrainCompletion, validateAdapterTerminal,
  validateBridgeDrainCompletion, validateCaseEvidence, validateResponse, validateState, createLateForkPermission,
  lateForkFiles, lateForkLimit, lateForkRole, rootFirstEvidenceVersion, validateLateForkEvidence,
  validateLateForkPermission, validateLateForkReceipt } from './adapterContract.mjs';

const generation = 'a'.repeat(64);
const state = () => ({ launched: true, creationCompleted: true, rootExited: true, rootExitCode: 0,
  activeProcesses: 0, assignedBeforeResume: true, descendantsAfterRoot: false, bridgeLost: false,
  cleanup: 'processTreeAbsent', failure: null });
const response = () => ({ schemaVersion: 1, generation, sequence: 1, kind: 'terminal', state: state() });
const drainReceipt = (intendedExitCode = 29) => ({ schemaVersion: 1, generation, kind: 'drainCompleted', intendedExitCode });
const liveDescendants = (activeProcesses = 1) => ({ ...state(), activeProcesses,
  descendantsAfterRoot: true, cleanup: 'pending' });
const challenge = 'b'.repeat(64);
const lateForkProof = () => ({ rootBeforePermission: liveDescendants(),
  permission: createLateForkPermission(generation, challenge, liveDescendants()),
  receipt: { schemaVersion: 1, generation, challenge, kind: 'grandchildReady' } });

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
  ['rootFirst', 'expectedRootExit', ['pageApi', 'rootExitObserved', 'descendantsAfterRoot', 'lateForkAcknowledged'], 0],
  ['bridgeExit', 'expectedBridgeFailure', ['pageApi', 'bridgeExitObserved', 'rootStillAlive', 'ownerStillAlive'], 1],
]) test(`${scenario} cannot relabel its failure or omit a required proof`, () => {
  const checks = Object.fromEntries([...specific, 'ownerExited', 'terminalAccepted', 'outerInterventionAbsent'].map(name => [name, true]));
  const terminal = { ...state(), rootExitCode: exitCode, descendantsAfterRoot: scenario !== 'bridgeExit', bridgeLost: scenario === 'bridgeExit' };
  const bridgeExitCode = scenario === 'beforeReady' ? null : scenario === 'bridgeExit' ? 41 : 0;
  const rootBeforeStop = scenario === 'bridgeExit' ? null : { ...terminal,
    activeProcesses: scenario === 'rootFirst' ? 2 : 1, cleanup: 'pending' };
  const bridgeDrainCompletion = scenario === 'beforeReady' ? drainReceipt() : null;
  const value = { schemaVersion: scenario === 'rootFirst' ? rootFirstEvidenceVersion : 1,
    ...(scenario === 'rootFirst' ? { lateFork: lateForkProof() } : {}), generation, scenario, workloadOutcome, bridgeExitCode,
    rootBeforeStop, bridgeDrainCompletion, checks, terminal };
  validateCaseEvidence(value, scenario, generation);
  if (scenario === 'rootFirst') {
    assert.throws(() => validateCaseEvidence({ ...value, schemaVersion: 1 }, scenario, generation));
    const historical = { ...value, schemaVersion: 1 };
    delete historical.lateFork;
    assert.throws(() => validateCaseEvidence(historical, scenario, generation));
    assert.throws(() => validateCaseEvidence({ ...value, lateFork: null }, scenario, generation));
    assert.throws(() => validateCaseEvidence({ ...value, rootBeforeStop: liveDescendants(1) }, scenario, generation));
  }
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

test('late fork permission requires an observed root exit and a distinct fresh challenge', () => {
  const permission = createLateForkPermission(generation, challenge, liveDescendants());
  for (const change of [{ rootExited: false, rootExitCode: null }, { activeProcesses: 0 },
    { assignedBeforeResume: false }, { cleanup: 'processTreeAbsent' }, { failure: 'ownerFailed' }]) {
    assert.throws(() => createLateForkPermission(generation, challenge, { ...liveDescendants(), ...change }));
  }
  for (const change of [{ generation: 'c'.repeat(64) }, { challenge: generation }, { challenge: 'invalid' },
    { schemaVersion: 2 }, { kind: 'grandchildReady' }, { rawPath: 'private' }]) {
    assert.throws(() => validateLateForkPermission({ ...permission, ...change }, generation));
  }
});

test('late fork evidence rejects a stale or parent-only receipt and requires both live descendants', () => {
  const proof = lateForkProof();
  validateLateForkEvidence(proof, generation, liveDescendants(2));
  for (const change of [{ generation: 'c'.repeat(64) }, { challenge: 'd'.repeat(64) }, { schemaVersion: 2 },
    { kind: 'leafSpawned' }, { parentClaim: true }]) {
    assert.throws(() => validateLateForkReceipt({ ...proof.receipt, ...change }, proof.permission));
  }
  for (const name of ['rootBeforePermission', 'permission', 'receipt']) {
    const missing = { ...proof };
    delete missing[name];
    assert.throws(() => validateLateForkEvidence(missing, generation, liveDescendants(2)));
  }
  assert.throws(() => validateLateForkEvidence(proof, generation, liveDescendants(1)));
  assert.throws(() => validateLateForkEvidence({ ...proof, rootBeforePermission: state() }, generation, liveDescendants(2)));
});

const leafSource = readFileSync(new URL('./fixtures/adapterLeaf.cjs', import.meta.url), 'utf8');
function inertLeafFixture() {
  const files = new Map();
  const spawns = [];
  const timers = [];
  const exits = [];
  const metadata = {};
  const cwd = path.resolve('synthetic-adapter');
  const missing = () => Object.assign(new Error('synthetic missing receipt'), { code: 'ENOENT' });
  const fs = {
    existsSync: filename => files.has(path.basename(filename)),
    lstatSync(filename) {
      const bytes = files.get(path.basename(filename));
      if (!bytes) throw missing();
      return { isFile: () => true, isSymbolicLink: () => false, nlink: 1, size: bytes.length, ...metadata };
    },
    readFileSync(filename) {
      const bytes = files.get(path.basename(filename));
      if (!bytes) throw missing();
      return bytes;
    },
    renameSync(from, to) {
      assert.ok(files.has(path.basename(from)));
      assert.equal(files.has(path.basename(to)), false);
      files.set(path.basename(to), files.get(path.basename(from)));
      files.delete(path.basename(from));
    },
  };
  const writeOnce = (name, value) => {
    assert.equal(files.has(name), false, 'syntheticDuplicatePublication');
    files.set(name, Buffer.from(JSON.stringify(value)));
  };
  function run(args = [], scenario = 'rootFirst') {
    const filename = path.join(cwd, 'adapterLeaf.cjs');
    const inputs = {
      __filename: filename,
      process: { argv: ['node', filename, ...args], execPath: 'synthetic-node', env: {},
        on: () => {}, exit: code => { exits.push(code); } },
      setTimeout: (callback, milliseconds) => { assert.equal(milliseconds, 24_000); },
      setInterval: callback => { timers.push(callback); return callback; },
      clearInterval: () => {},
      require(name) {
        if (name === 'node:assert/strict') return assert;
        if (name === 'node:fs') return fs;
        if (name === 'node:path') return path;
        if (name === './adapterContract.mjs') return contract;
        if (name === './adapterFixture.cjs') return { workspace: () => ({ cwd, generation, scenario }), writeOnce };
        assert.equal(name, 'node:child_process');
        return { spawn(executable, argv, options) {
          spawns.push({ executable, argv, options });
          return { on: () => {}, unref: () => {} };
        } };
      },
    };
    compileFunction(leafSource, Object.keys(inputs), { filename })(...Object.values(inputs));
  }
  return { files, spawns, timers, exits, metadata, writeOnce, run };
}

test('actual leaf consumes one permission, spawns once, and only the grandchild publishes readiness', () => {
  const f = inertLeafFixture();
  const proof = lateForkProof();
  f.run();
  f.timers[0]();
  assert.equal(f.spawns.length, 0);
  f.writeOnce(lateForkFiles.permission, proof.permission);
  f.timers[0]();
  f.timers[0]();
  assert.equal(f.spawns.length, 1);
  assert.equal(f.files.has(lateForkFiles.permission), false);
  assert.equal(f.files.has(lateForkFiles.consumed), true);
  assert.equal(f.files.has(lateForkFiles.receipt), false);
  const spawned = f.spawns[0];
  assert.equal(spawned.executable, 'synthetic-node');
  assert.equal(spawned.options.detached, true);
  assert.equal(spawned.options.shell, false);
  assert.equal(spawned.options.stdio, 'ignore');
  assert.deepEqual([...spawned.argv.slice(1)], [lateForkRole, challenge]);
  f.run([...spawned.argv.slice(1)]);
  assert.deepEqual(JSON.parse(f.files.get(lateForkFiles.receipt)), proof.receipt);
  assert.equal(f.spawns.length, 1);
  assert.deepEqual(f.exits, []);
  assert.throws(() => f.run([lateForkRole, challenge]), /syntheticDuplicatePublication/);
});

test('actual leaf fails closed on malformed, linked, oversized and replayed fork permission', () => {
  for (const fault of ['malformed', 'linked', 'symlink', 'oversized', 'replayed', 'staleGeneration']) {
    const f = inertLeafFixture();
    const permission = lateForkProof().permission;
    f.run();
    f.writeOnce(lateForkFiles.permission, fault === 'staleGeneration' ? { ...permission, generation: 'c'.repeat(64) } : permission);
    if (fault === 'malformed') f.files.set(lateForkFiles.permission, Buffer.from('{'));
    if (fault === 'linked') f.metadata.nlink = 2;
    if (fault === 'symlink') f.metadata.isSymbolicLink = () => true;
    if (fault === 'oversized') f.files.set(lateForkFiles.permission, Buffer.alloc(lateForkLimit + 1, 32));
    if (fault === 'replayed') f.writeOnce(lateForkFiles.consumed, permission);
    f.timers[0]();
    assert.equal(f.spawns.length, 0, fault);
    assert.deepEqual(f.exits, [72], fault);
    assert.equal(f.files.has(lateForkFiles.receipt), false, fault);
  }
});

test('grandchild requires consumed permission and exact challenge; beforeReady retains its original leaf', () => {
  const f = inertLeafFixture();
  assert.throws(() => f.run([lateForkRole, challenge]), /synthetic missing receipt/);
  f.writeOnce(lateForkFiles.consumed, lateForkProof().permission);
  assert.throws(() => f.run([lateForkRole, 'c'.repeat(64)]));
  assert.equal(f.files.has(lateForkFiles.receipt), false);
  const early = inertLeafFixture();
  early.run([], 'beforeReady');
  assert.deepEqual(JSON.parse(early.files.get('adapter-leaf.json')), { schemaVersion: 1, generation, ready: true });
  assert.equal(early.spawns.length, 0);
  assert.equal(early.timers.length, 0);
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  actorArguments, budgets, childEnvironment, classifyBootstrap, createDeadline,
  createFrames, createInitProtocol, descriptors, encodeMessage, expectedEofExit,
  experimentContext, limits, message, parseActorArguments, responseChannel,
  resultFor, resultSchemaVersion, serializeResult, unshareArguments, validateIdentity, validateInitStatus,
  validateMessage, writeMessage,
} from './pidNamespaceContract.mjs';
import {
  captureBootstrapDiagnostic, createInitFailureReporter, initDiagnosticLimit,
  initDiagnosticPrefix, parseInitDiagnostic, validateBootstrapDiagnostic,
} from './pidNamespaceDiagnostics.mjs';

const generation = 'a'.repeat(32);
const challenge = 'b'.repeat(32);
const config = { generation, started: '1000000', uid: 1001, gid: 1002 };
const binding = { consumer: 'system-api', checkoutSha: 'c'.repeat(40), runId: '123', runAttempt: '1' };
const environment = { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
const args = ['--consumer=system-api', `--checkout-sha=${binding.checkoutSha}`];
const status = 'Pid:\t1\nUid:\t1001\t1001\t1001\t1001\nGid:\t1002\t1002\t1002\t1002\n' +
  'CapEff:\t0000000000000000\nCapPrm:\t0000000000000000\nCapInh:\t0000000000000000\nCapAmb:\t0000000000000000\nCapBnd:\t000001ffffffffff\n';

function clock() {
  let milliseconds = 0;
  return { set: value => { milliseconds = value; },
    deadline: createDeadline(config.started, () => BigInt(config.started) + BigInt(milliseconds) * 1000000n) };
}

test('exact budgets, unshare flags and fd ownership remain fixed', () => {
  assert.deepEqual(budgets, { ready: 5000, workload: 8000, init: 10000, leaf: 12000,
    wrapper: 14000, sentinel: 16000, report: 20000 });
  assert.equal(unshareArguments.join(' '), '--user --map-current-user --setgroups=deny --mount --propagation=private --mount-proc=/proc --pid --fork --kill-child=SIGKILL --');
  assert.deepEqual(descriptors.wrapper, ['pipe', 'ignore', 'pipe', 'pipe']);
  assert.deepEqual(descriptors.root, ['ignore', 'ignore', 'ignore', 'ipc', 'pipe']);
  assert.deepEqual(descriptors.leaf, ['ignore', 'ignore', 'ignore', 'ignore', 4]);
  assert.deepEqual(descriptors.sentinel, ['pipe', 'ignore', 'ignore', 'pipe']);
  assert.ok(Object.isFrozen(unshareArguments));
});

test('CI binding and EKY guard precede runtime access; reject unknown, duplicate and unbound arguments', () => {
  assert.deepEqual(experimentContext(args, environment), binding);
  for (const key of ['EKY_E2E', 'CI', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) {
    assert.equal(experimentContext(args, { ...environment, [key]: undefined }), null);
  }
  for (const argv of [[], [...args, '--extra=true'], [args[0], args[0]],
    ['--consumer=electron', args[1]], [args[0], '--checkout-sha=HEAD'],
    [args[0], `${args[1]}\n`]]) assert.equal(experimentContext(argv, environment), null);
});

test('children receive only fixed execution-hook-free environment and bounded argument schema', () => {
  assert.deepEqual(childEnvironment({ NODE_OPTIONS: '--require=attack', LD_PRELOAD: 'attack' }), {
    EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true', PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
  });
  assert.deepEqual(parseActorArguments(actorArguments(config)), config);
  for (const role of ['root', 'leaf', 'sentinel']) {
    assert.deepEqual(parseActorArguments(actorArguments(config, role), true), { ...config, role });
  }
  for (const bad of [
    [...actorArguments(config), '--role=root'],
    actorArguments(config).map(value => value.startsWith('--uid=') ? '--uid=0' : value),
    actorArguments(config).map(value => value.startsWith('--gid=') ? '--gid=01' : value),
    actorArguments(config).map(value => value.startsWith('--started=') ? '--started=Infinity' : value),
    actorArguments(config).map(value => value.startsWith('--generation=') ? '--generation=wrong' : value),
    [...actorArguments(config).slice(0, 3), '--uid=1001'],
    actorArguments(config).map(value => `${value}\n`),
  ]) assert.throws(() => parseActorArguments(bad));
});

test('init requires PID one, unchanged real/effective/saved/fs nonroot IDs and four zero capability sets', () => {
  validateIdentity({ uid: 1001, euid: 1001, gid: 1002, egid: 1002 }, config);
  validateInitStatus(status, config);
  for (const key of ['uid', 'euid', 'gid', 'egid']) {
    assert.throws(() => validateIdentity({ uid: 1001, euid: 1001, gid: 1002, egid: 1002, [key]: 0 }, config));
  }
  for (const altered of [status.replace('Pid:\t1', 'Pid:\t2'), status.replace('1001\t1001', '1001\t1003'),
    status + 'CapEff:\t0000000000000000\n', status.replace('CapAmb:', 'Other:'), 'x'.repeat(limits.status)]) {
    assert.throws(() => validateInitStatus(altered, config));
  }
  for (const name of ['CapEff', 'CapPrm', 'CapInh', 'CapAmb']) {
    assert.throws(() => validateInitStatus(status.replace(`${name}:\t0000000000000000`, `${name}:\t0000000000000001`), config));
  }
});

test('cross-process monotonic start is not reset; each boundary is exclusive', () => {
  const { deadline, set } = clock();
  for (const [phase, milliseconds] of Object.entries(budgets)) {
    set(milliseconds - 1);
    deadline.check(phase);
    assert.equal(deadline.remaining(phase), 1);
    set(milliseconds);
    assert.throws(() => deadline.check(phase));
  }
  assert.throws(() => createDeadline('100', () => 99n).check('ready'));
  for (const start of ['0', '-1', '1.1', '1e5', 'x', '1'.repeat(25), '100\n']) assert.throws(() => createDeadline(start));
});

test('messages reject unknown/accessor/symbol fields, wrong generation/type and invalid challenges', () => {
  const good = message('ALIVE', generation, challenge);
  validateMessage(good, generation, 'ALIVE', challenge);
  for (const bad of [{ ...good, extra: 'secret' }, { ...good, version: 2 }, { ...good, type: 'GO' },
    { ...good, generation: challenge }, { ...good, challenge: `${challenge}\n` },
    { ...good, challenge: generation }, { ...good, [Symbol('extra')]: 1 }]) {
    assert.throws(() => validateMessage(bad, generation, 'ALIVE', challenge));
  }
  const accessor = { ...good };
  Object.defineProperty(accessor, 'type', { get() { throw Error('ACCESSOR_EXECUTED'); }, enumerable: true });
  assert.throws(() => validateMessage(accessor, generation, 'ALIVE', challenge), /experiment incomplete/u);
  assert.throws(() => message('UNKNOWN', generation));
});

test('bounded framing rejects duplicate keys, noncanonical/invalid UTF-8, truncation and floods', () => {
  const received = [];
  const frames = createFrames(value => received.push(value));
  const bytes = encodeMessage(message('READY', generation));
  frames.push(bytes.subarray(0, 3));
  frames.push(bytes.subarray(3));
  frames.end();
  assert.deepEqual(received, [message('READY', generation)]);
  for (const input of [Buffer.from('{"version":1,"version":1}\n'), Buffer.from(' {"a":1}\n'),
    Buffer.from('\n'), Buffer.from('{broken}\n'), Buffer.from([255, 10]), Buffer.alloc(limits.frame, 65),
    Buffer.alloc(limits.channel + 1, 65)]) assert.throws(() => createFrames(() => {}).push(input));
  const truncated = createFrames(() => {});
  truncated.push(Buffer.from('{'));
  assert.throws(() => truncated.end());
  assert.throws(() => frames.push(bytes));
});

function running() {
  const time = clock();
  const protocol = createInitProtocol(generation, time.deadline);
  protocol.ready();
  protocol.go(message('GO', generation));
  return { protocol, ...time };
}

test('root exit, never close, opens the fresh fd4 challenge; only complete proof permits exit 41', () => {
  const { protocol } = running();
  assert.throws(() => protocol.leafBytes());
  assert.throws(() => protocol.challenge(challenge));
  protocol.handoff(message('HANDOFF', generation));
  protocol.rootExit(0, null);
  assert.deepEqual(protocol.challenge(challenge), message('CHALLENGE', generation, challenge));
  protocol.leafBytes();
  protocol.leaf(message('ALIVE', generation, challenge));
  assert.throws(() => protocol.eof());
  protocol.evidenceWritten();
  assert.equal(protocol.eof(), expectedEofExit);
  assert.throws(() => protocol.eof());
});

test('replayed GO/leaf receipts, early EOF, missing handoff and abnormal root exits fail closed', () => {
  for (const invoke of [p => p.go(message('GO', generation)), p => p.eof(),
    p => p.rootExit(1, null), p => p.rootExit(0, 'SIGTERM')]) assert.throws(() => invoke(running().protocol));
  const { protocol } = running();
  protocol.rootExit(0, null);
  assert.equal(protocol.canChallenge, false);
  assert.throws(() => protocol.challenge(challenge));
  assert.throws(() => protocol.eof());
  protocol.handoff(message('HANDOFF', generation));
  protocol.challenge(challenge);
  assert.throws(() => protocol.leaf(message('ALIVE', generation, generation)));
  protocol.leaf(message('ALIVE', generation, challenge));
  assert.throws(() => protocol.leaf(message('ALIVE', generation, challenge)));
  assert.throws(() => protocol.leafBytes());
});

test('independent HANDOFF and exit latches open exactly one challenge in either order', () => {
  for (const exitFirst of [false, true]) {
    const { protocol } = running();
    const handoff = () => protocol.handoff(message('HANDOFF', generation));
    const exit = () => protocol.rootExit(0, null);
    (exitFirst ? exit : handoff)();
    assert.equal(protocol.canChallenge, false);
    assert.throws(() => protocol.challenge(challenge));
    assert.throws(() => protocol.leafBytes());
    (exitFirst ? handoff : exit)();
    assert.equal(protocol.canChallenge, true);
    protocol.challenge(challenge);
    assert.equal(protocol.canChallenge, false);
    assert.throws(handoff);
    assert.throws(exit);
    assert.throws(() => protocol.challenge(challenge));
  }
});

test('HANDOFF must be valid, unique and within the original workload budget in either order', () => {
  for (const exitFirst of [false, true]) {
    for (const receipt of [message('HANDOFF', challenge), message('GO', generation),
      { ...message('HANDOFF', generation), extra: true }]) {
      const { protocol } = running();
      if (exitFirst) protocol.rootExit(0, null);
      assert.throws(() => protocol.handoff(receipt));
      assert.equal(protocol.canChallenge, false);
    }
    const { protocol, set } = running();
    if (exitFirst) protocol.rootExit(0, null);
    else protocol.handoff(message('HANDOFF', generation));
    set(budgets.workload);
    assert.throws(() => exitFirst ? protocol.handoff(message('HANDOFF', generation)) : protocol.rootExit(0, null));
    assert.equal(protocol.canChallenge, false);
    assert.throws(() => protocol.challenge(challenge));
    assert.throws(() => protocol.eof());
  }
  const { protocol } = running();
  protocol.handoff(message('HANDOFF', generation));
  assert.throws(() => protocol.handoff(message('HANDOFF', generation)));
});

test('late GO, root exit, leaf response, evidence-write callback and EOF never grant success', () => {
  const fresh = clock();
  const awaitingGo = createInitProtocol(generation, fresh.deadline);
  awaitingGo.ready(); fresh.set(budgets.ready);
  assert.throws(() => awaitingGo.go(message('GO', generation)));
  const root = running(); root.set(budgets.workload);
  assert.throws(() => root.protocol.rootExit(0, null));
  const leaf = running(); leaf.protocol.handoff(message('HANDOFF', generation));
  leaf.protocol.rootExit(0, null); leaf.protocol.challenge(challenge);
  leaf.set(budgets.workload);
  assert.throws(() => leaf.protocol.leaf(message('ALIVE', generation, challenge)));
  const eof = running(); eof.protocol.handoff(message('HANDOFF', generation));
  eof.protocol.rootExit(0, null); eof.protocol.challenge(challenge);
  eof.protocol.leaf(message('ALIVE', generation, challenge));
  eof.set(budgets.workload);
  assert.throws(() => eof.protocol.evidenceWritten());
  eof.set(7000); eof.protocol.evidenceWritten(); eof.set(budgets.init);
  assert.throws(() => eof.protocol.eof());
});

test('response channels reject unsolicited bytes, duplicates, errors, EOF and late replies permanently', async () => {
  for (const trigger of [s => s.emit('end'), s => s.emit('error', Error('PRIVATE')),
    s => s.emit('close'), s => s.emit('data', encodeMessage(message('GO', generation)))]) {
    const stream = new EventEmitter();
    const channel = responseChannel(stream, clock().deadline);
    const pending = channel.expect('READY', generation, 'ready');
    trigger(stream);
    await assert.rejects(pending);
    assert.throws(() => channel.check());
  }
  const stream = new EventEmitter();
  const c = clock();
  const channel = responseChannel(stream, c.deadline);
  stream.emit('data', Buffer.from('{'));
  await assert.rejects(channel.expect('READY', generation, 'ready'));
  const lateStream = new EventEmitter();
  const late = responseChannel(lateStream, c.deadline);
  const pending = late.expect('READY', generation, 'ready');
  c.set(budgets.ready);
  lateStream.emit('data', encodeMessage(message('READY', generation)));
  await assert.rejects(pending);
});

for (const [type, phase, token, nonce] of [
  ['READY', 'ready', generation],
  ['WORKLOAD', 'workload', generation],
  ['ALIVE', 'sentinel', 'c'.repeat(32), challenge],
]) {
  test(`response channel latches same-chunk partial tail after ${type} before the next action`, async () => {
    const stream = new EventEmitter();
    const channel = responseChannel(stream, clock().deadline);
    const value = message(type, token, nonce);
    const pending = channel.expect(type, token, phase, nonce);
    stream.emit('data', Buffer.concat([encodeMessage(value), Buffer.from('{')]));
    assert.throws(() => channel.check(), { reason: 'invalidMessage' });
    assert.equal(channel.ended, false);
    assert.deepEqual(await pending, value);
    assert.throws(() => channel.check(), { reason: 'invalidMessage' });
    await assert.rejects(channel.expect(type, token, phase, nonce), { reason: 'invalidMessage' });
    stream.emit('end');
    assert.throws(() => channel.closed(), { reason: 'invalidMessage' });
  });

  test(`response channel still accepts a fragmented expected ${type} without a trailing frame`, async () => {
    const stream = new EventEmitter();
    const channel = responseChannel(stream, clock().deadline);
    const value = message(type, token, nonce);
    const bytes = encodeMessage(value);
    const pending = channel.expect(type, token, phase, nonce);
    stream.emit('data', bytes.subarray(0, 1));
    assert.doesNotThrow(() => channel.check());
    stream.emit('data', bytes.subarray(1));
    assert.deepEqual(await pending, value);
    assert.doesNotThrow(() => channel.check());
    stream.emit('end');
    assert.doesNotThrow(() => channel.closed());
  });
}

test('write callbacks must still be within the same deadline', async () => {
  const c = clock();
  let callback;
  const writing = writeMessage({ write(_bytes, done) { callback = done; } }, message('GO', generation), c.deadline, 'ready');
  c.set(budgets.ready);
  callback();
  await assert.rejects(writing);
});

test('only exact pre-GO missing-tool or denial evidence is a negative prerequisite observation', () => {
  const facts = { spawnCode: null, code: 1, signal: null,
    stderr: 'unshare: unshare failed: Operation not permitted\n', ready: false, go: false,
    streamsClosed: true, responseBytes: 0, toolAbsent: true };
  assert.equal(classifyBootstrap(facts), 'namespaceDenied');
  assert.equal(classifyBootstrap({ ...facts, spawnCode: 'ENOENT', stderr: '' }), 'unshareMissing');
  for (const change of [{ ready: true }, { go: true }, { streamsClosed: false }, { signal: 'SIGKILL' },
    { stderr: 'some Operation not permitted' }, { code: 2 }, { spawnCode: 'EACCES' }, { responseBytes: 1 }]) {
    assert.equal(classifyBootstrap({ ...facts, ...change }), 'bootstrapUnknown');
  }
  assert.equal(classifyBootstrap({ ...facts, spawnCode: 'ENOENT', stderr: '', toolAbsent: false }), 'bootstrapUnknown');
});

test('public result is closed, CI-bound, redacted and separates workload/cleanup/evidence', () => {
  const facts = { reason: 'observed', workload: true, destroyed: true, sentinel: true, go: true,
    launched: true, rootCreated: true, removed: true, raw: 'PRIVATE', pid: 1234, path: '/private' };
  const result = resultFor(binding, facts);
  const line = serializeResult(result, binding);
  assert.doesNotMatch(line, /PRIVATE|pid"|path"|generation|started/u);
  assert.equal(result.evidenceOutcome, 'complete');
  assert.throws(() => serializeResult({ ...result, extra: 'PRIVATE' }, binding));
  assert.throws(() => serializeResult(result, { ...binding, runAttempt: '2' }));
  for (const change of [{ cleanupOutcome: 'unverified' }, { workloadOutcome: 'failed' },
    { sentinelOutcome: 'unverified' }, { reason: '/private' }, { testRoot: 'retained' }]) {
    assert.throws(() => serializeResult({ ...result, ...change }, binding));
  }
  const failed = resultFor(binding, { ...facts, reason: 'workloadFailed', removed: false });
  assert.equal(failed.observation, 'failed');
  assert.equal(failed.cleanupOutcome, 'namespaceDestroyed');
  assert.equal(failed.evidenceOutcome, 'incomplete');
  serializeResult(failed, binding);
});

const diagnosticPhases = [
  'context', 'arguments', 'deadline', 'pid', 'identity', 'statusRead',
  'statusValidation', 'responseOpen', 'controlSetup', 'readyWrite', 'awaitGo',
];
const diagnosticCauses = [
  'invalidContext', 'invalidArguments', 'deadlineExceeded', 'invalidIdentity',
  'invalidStatus', 'invalidMessage', 'channelFailed', 'channelLimit',
  'unexpectedEof', 'experimentFailed', 'statusReadFailed', 'statusMalformed',
  'statusPidMismatch', 'statusIdentityMismatch', 'statusCapabilities',
];
const diagnosticFlags = [
  'wrapperClosed', 'stderrEnded', 'stderrFailed', 'responseEnded', 'readyAccepted',
  'goAttempted', 'emergencyUsed', 'readyBudgetExpired', 'classificationAttempted',
];
const diagnosticChoices = {
  wrapperTerminal: ['notObserved', 'spawnFailed', 'exit0', 'exit1', 'exit41', 'exit42', 'otherExit', 'signaled'],
  stderrClass: ['empty', 'exactUnshareDenied', 'other', 'unreadableOrOverLimit'],
  responseBytes: ['none', 'present'],
  spawnClass: ['none', 'enoent', 'other'],
  toolAbsence: ['notChecked', 'provenAbsent', 'notProven'],
  initDiagnostic: ['absent', 'valid', 'invalid', 'unavailable'],
};
const diagnosticMarker = `${initDiagnosticPrefix} statusValidation statusCapabilities\n`;
const isDiagnosticReason = reason => reason === 'bootstrapUnknown' || reason === 'invalidIdentity';

function diagnosticSnapshot(changes = {}) {
  return {
    bootstrapCause: 'bootstrapUnknown', wrapper: null, stderr: '', stderrFailed: false,
    stderrEnded: false, replies: null, toolAbsence: 'notChecked', readyAccepted: false,
    goAttempted: false, emergencyUsed: false, readyBudgetExpired: false,
    classificationAttempted: false, ...changes,
  };
}

test('init diagnostics use the exact closed eleven-phase ASCII grammar within 128 bytes', () => {
  assert.equal(initDiagnosticLimit, 128);
  assert.equal(initDiagnosticPrefix, 'EKY_T3CL_INIT_FAILURE_V1');
  assert.equal(diagnosticPhases.length, 11);
  for (const phase of diagnosticPhases) {
    for (const cause of diagnosticCauses) {
      const lines = [];
      const report = createInitFailureReporter((line, callback) => { lines.push(line); callback(); });
      assert.equal(report(phase, cause), undefined);
      assert.deepEqual(lines, [`${initDiagnosticPrefix} ${phase} ${cause}\n`]);
      assert.match(lines[0], /^[\x00-\x7f]+$/u);
      assert.ok(Buffer.byteLength(lines[0]) <= initDiagnosticLimit);
      assert.deepEqual(parseInitDiagnostic(lines[0]), { state: 'valid', phase, cause });
    }
  }
});

test('init diagnostics latch the first attempt before writing, callbacks, throws or reentrancy', () => {
  for (const outcome of ['success', 'callbackError', 'throw', 'noCallback', 'reentrant']) {
    const lines = [];
    let callback;
    const report = createInitFailureReporter((line, done) => {
      lines.push(line);
      callback = done;
      if (outcome === 'throw') throw Error('PRIVATE_WRITER_ERROR');
      if (outcome === 'noCallback') return false;
      if (outcome === 'reentrant') report('awaitGo', 'unexpectedEof');
      done(outcome === 'callbackError' ? Error('PRIVATE_CALLBACK_ERROR') : undefined);
    });
    assert.equal(report('statusRead', 'statusReadFailed'), undefined);
    assert.doesNotThrow(() => report('awaitGo', 'unexpectedEof'));
    assert.doesNotThrow(() => callback(Error('PRIVATE_LATE_ERROR')));
    assert.doesNotThrow(() => report('deadline', 'deadlineExceeded'));
    assert.deepEqual(lines, [`${initDiagnosticPrefix} statusRead statusReadFailed\n`]);
  }
  for (const writer of [undefined, null, false, {}]) {
    const report = createInitFailureReporter(writer);
    assert.equal(report('context', 'invalidContext'), undefined);
    assert.equal(report('awaitGo', 'unexpectedEof'), undefined);
  }
});

test('invalid init phase or cause publishes nothing and still consumes the first attempt', () => {
  const hostile = { toString() { throw Error('COERCION_EXECUTED'); } };
  const invalid = ['', 'PRIVATE', 'context\n', 'statusRead\r', '\u00e4', null, undefined, 1, true,
    [], hostile, Symbol('PRIVATE'), 'x'.repeat(initDiagnosticLimit + 1)];
  for (const value of invalid) {
    for (const pair of [[value, 'invalidContext'], ['context', value]]) {
      const lines = [];
      const report = createInitFailureReporter(line => lines.push(line));
      assert.doesNotThrow(() => report(...pair));
      report('context', 'invalidContext');
      assert.deepEqual(lines, []);
    }
  }
  for (const cause of ['observed', 'unshareMissing', 'namespaceDenied', 'cleanupUnverified', 'sentinelFailed']) {
    const lines = [];
    createInitFailureReporter(line => lines.push(line))('context', cause);
    assert.deepEqual(lines, []);
  }
});

test('diagnostic parsing distinguishes absence and unavailability without publishing raw text', () => {
  for (const stderr of ['', 'PRIVATE ordinary stderr\n', 'unshare: unshare failed: Operation not permitted\n',
    '\u00e4 PRIVATE', 'x'.repeat(initDiagnosticLimit + 1)]) {
    assert.deepEqual(parseInitDiagnostic(stderr), { state: 'absent', phase: null, cause: null });
  }
  for (const stderr of ['', diagnosticMarker, `${diagnosticMarker}${diagnosticMarker}`, null, undefined,
    1, Buffer.from(diagnosticMarker), { toString() { throw Error('COERCION_EXECUTED'); } }]) {
    assert.deepEqual(parseInitDiagnostic(stderr, true), { state: 'unavailable', phase: null, cause: null });
    if (typeof stderr !== 'string') {
      assert.deepEqual(parseInitDiagnostic(stderr), { state: 'unavailable', phase: null, cause: null });
    }
  }
});

test('untrusted duplicate, trailing, oversized and non-ASCII diagnostic markers are invalid', () => {
  const junk = [
    initDiagnosticPrefix, `${diagnosticMarker}${diagnosticMarker}`, `${diagnosticMarker}PRIVATE`,
    `PRIVATE\n${diagnosticMarker}`, ` ${diagnosticMarker}`, `${diagnosticMarker}\n`,
    diagnosticMarker.slice(0, -1), diagnosticMarker.replace('\n', '\r\n'),
    diagnosticMarker.replace(' statusValidation', '\tstatusValidation'),
    diagnosticMarker.replace(' statusCapabilities', '  statusCapabilities'),
    `${initDiagnosticPrefix} unknown statusCapabilities\n`, `${initDiagnosticPrefix} context observed\n`,
    `${initDiagnosticPrefix} context PRIVATE\n`, `${initDiagnosticPrefix} context invalidContext\nPRIVATE`,
    diagnosticMarker.replace('statusCapabilities', 'statusCapabilities\u00e4'),
    `\uFEFF${diagnosticMarker}`, `${diagnosticMarker}\0`, `${diagnosticMarker}\uFFFD`,
    diagnosticMarker.padEnd(initDiagnosticLimit, 'x'), diagnosticMarker.padEnd(initDiagnosticLimit + 1, 'x'),
    `${'x'.repeat(initDiagnosticLimit)}${diagnosticMarker}`,
  ];
  for (const stderr of junk) {
    assert.deepEqual(parseInitDiagnostic(stderr), { state: 'invalid', phase: null, cause: null });
  }
});

test('bootstrap snapshot is flat, closed, detached from inputs and does not retain raw fields', () => {
  const snapshot = diagnosticSnapshot({
    bootstrapCause: 'invalidIdentity',
    wrapper: { exited: true, closed: false, spawnCode: null, code: 42, signal: null, pid: 1234 },
    stderr: diagnosticMarker, stderrEnded: true, replies: { ended: true, receivedBytes: 12 },
    toolAbsence: 'notProven', readyAccepted: true, goAttempted: true, emergencyUsed: true,
    readyBudgetExpired: true, classificationAttempted: true,
    raw: 'PRIVATE', status: 'PRIVATE', path: '/private', env: { PRIVATE: 'PRIVATE' }, error: Error('PRIVATE'),
  });
  const captured = captureBootstrapDiagnostic(snapshot);
  assert.deepEqual(captured, {
    bootstrapCause: 'invalidIdentity', wrapperTerminal: 'exit42', stderrClass: 'other',
    wrapperClosed: false, stderrEnded: true, stderrFailed: false, responseEnded: true,
    responseBytes: 'present', spawnClass: 'none', toolAbsence: 'notProven', readyAccepted: true,
    goAttempted: true, emergencyUsed: true, readyBudgetExpired: true, classificationAttempted: true,
    initDiagnostic: 'valid', initPhase: 'statusValidation', initCause: 'statusCapabilities',
  });
  const line = JSON.stringify(captured);
  snapshot.wrapper.closed = true;
  snapshot.replies.ended = false;
  snapshot.stderr = 'PRIVATE';
  snapshot.bootstrapCause = 'bootstrapUnknown';
  assert.equal(JSON.stringify(captured), line);
  assert.doesNotMatch(line, /PRIVATE|private|pid|path|env|status"|error"|stderr"|wrapper"|replies"/u);
  assert.equal(validateBootstrapDiagnostic(captured, isDiagnosticReason), true);
  assert.equal(captured.goAttempted, true);
});

test('bootstrap snapshot records every terminal class without inferring init execution or acceptance', () => {
  const pending = { exited: false, closed: false, spawnCode: null, code: null, signal: null };
  const cases = [[null, 'notObserved'], [pending, 'notObserved'],
    [{ ...pending, code: 42 }, 'notObserved'],
    [{ ...pending, spawnCode: 'ENOENT' }, 'spawnFailed'],
    [{ ...pending, spawnCode: 'EACCES', closed: true }, 'spawnFailed'],
    [{ ...pending, exited: true, signal: 'SIGKILL' }, 'signaled'],
    [{ ...pending, closed: true, signal: 'SIGTERM', code: 0 }, 'signaled']];
  for (const [code, expected] of [[0, 'exit0'], [1, 'exit1'], [41, 'exit41'], [42, 'exit42'],
    [7, 'otherExit'], [-1, 'otherExit'], [null, 'otherExit']]) {
    cases.push([{ ...pending, exited: true, code }, expected], [{ ...pending, closed: true, code }, expected]);
  }
  for (const [wrapper, expected] of cases) {
    const captured = captureBootstrapDiagnostic(diagnosticSnapshot({ wrapper }));
    assert.equal(captured.wrapperTerminal, expected);
    assert.equal(captured.wrapperClosed, wrapper?.closed === true);
    assert.equal(captured.initDiagnostic, 'absent');
    assert.equal(captured.bootstrapCause, 'bootstrapUnknown');
    assert.equal(validateBootstrapDiagnostic(captured, isDiagnosticReason), true);
  }
});

test('bootstrap snapshot captures exact stderr, spawn and stream classes without reclassification', () => {
  const denial = 'unshare: unshare failed: Operation not permitted\n';
  for (const [stderr, stderrFailed, stderrClass, initDiagnostic] of [
    ['', false, 'empty', 'absent'], [denial, false, 'exactUnshareDenied', 'absent'],
    [`${denial}PRIVATE`, false, 'other', 'absent'], [diagnosticMarker, false, 'other', 'valid'],
    [`${denial}${diagnosticMarker}`, false, 'other', 'invalid'],
    [diagnosticMarker, true, 'unreadableOrOverLimit', 'unavailable'],
    ['', true, 'unreadableOrOverLimit', 'unavailable'],
    [null, false, 'unreadableOrOverLimit', 'unavailable'],
  ]) {
    const captured = captureBootstrapDiagnostic(diagnosticSnapshot({ stderr, stderrFailed }));
    assert.equal(captured.stderrClass, stderrClass);
    assert.equal(captured.initDiagnostic, initDiagnostic);
    assert.equal(captured.stderrFailed, stderrFailed);
    assert.equal(captured.stderrEnded, false);
    assert.equal(captured.bootstrapCause, 'bootstrapUnknown');
    assert.equal(validateBootstrapDiagnostic(captured, isDiagnosticReason), true);
  }
  for (const [spawnCode, spawnClass] of [[null, 'none'], ['ENOENT', 'enoent'], ['PRIVATE', 'other']]) {
    const captured = captureBootstrapDiagnostic(diagnosticSnapshot({ wrapper: { spawnCode } }));
    assert.equal(captured.spawnClass, spawnClass);
    assert.doesNotMatch(JSON.stringify(captured), /PRIVATE/u);
  }
  for (const replies of [null, { ended: false, receivedBytes: 0 }, { ended: true, receivedBytes: 1 }]) {
    const captured = captureBootstrapDiagnostic(diagnosticSnapshot({ replies }));
    assert.equal(captured.responseEnded, replies?.ended === true);
    assert.equal(captured.responseBytes, replies?.receivedBytes > 0 ? 'present' : 'none');
  }
  for (const toolAbsence of diagnosticChoices.toolAbsence) {
    assert.equal(captureBootstrapDiagnostic(diagnosticSnapshot({ toolAbsence })).toolAbsence, toolAbsence);
  }
});

test('diagnostic validator accepts only exact plain data objects and never invokes accessors', () => {
  const valid = captureBootstrapDiagnostic(diagnosticSnapshot());
  let accessorCalls = 0;
  assert.equal(validateBootstrapDiagnostic(valid, isDiagnosticReason), true);
  assert.equal(validateBootstrapDiagnostic(Object.freeze({ ...valid }), isDiagnosticReason), true);
  assert.equal(validateBootstrapDiagnostic(Object.assign(Object.create(null), valid), isDiagnosticReason), true);
  const invalid = [null, undefined, true, 1, 'PRIVATE', [], Object.create(valid),
    { ...valid, raw: 'PRIVATE' }, { ...valid, [Symbol('PRIVATE')]: true },
    Object.assign(new (class Diagnostic {})(), valid)];
  for (const key of Object.keys(valid)) {
    const missing = { ...valid };
    delete missing[key];
    invalid.push(missing);
    invalid.push(Object.defineProperty({ ...valid }, key, { enumerable: false }));
    invalid.push(Object.defineProperty({ ...valid }, key, {
      get() { accessorCalls += 1; throw Error('ACCESSOR_EXECUTED'); }, enumerable: true,
    }));
    invalid.push(Object.defineProperty({ ...valid }, key, { set() {}, enumerable: true }));
  }
  invalid.push(Object.defineProperty({ ...valid }, 'extra', { value: 'PRIVATE', enumerable: false }));
  let predicateCalls = 0;
  for (const value of invalid) {
    assert.equal(validateBootstrapDiagnostic(value, () => { predicateCalls += 1; return true; }), false);
    assert.equal(validateBootstrapDiagnostic(value, isDiagnosticReason), false);
  }
  assert.equal(accessorCalls, 0);
  assert.equal(predicateCalls, 0);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(validateBootstrapDiagnostic(revoked.proxy, isDiagnosticReason), false);
});

test('diagnostic validator closes enums, booleans, reason predicate and phase/cause state pairing', () => {
  const valid = captureBootstrapDiagnostic(diagnosticSnapshot());
  for (const key of diagnosticFlags) {
    assert.equal(validateBootstrapDiagnostic({ ...valid, [key]: true }, isDiagnosticReason), true);
    for (const value of [0, 1, 'false', null, undefined, {}, []]) {
      assert.equal(validateBootstrapDiagnostic({ ...valid, [key]: value }, isDiagnosticReason), false);
    }
  }
  for (const [key, values] of Object.entries(diagnosticChoices)) {
    for (const value of values) {
      const fields = key === 'initDiagnostic' && value === 'valid'
        ? { initPhase: 'context', initCause: 'invalidContext' } : {};
      assert.equal(validateBootstrapDiagnostic({ ...valid, [key]: value, ...fields }, isDiagnosticReason), true);
    }
    for (const value of ['PRIVATE', '', null, undefined, 0, true, {}, []]) {
      assert.equal(validateBootstrapDiagnostic({ ...valid, [key]: value }, isDiagnosticReason), false);
    }
  }
  for (const bootstrapCause of [null, undefined, 1, false, {}, [], 'PRIVATE']) {
    assert.equal(validateBootstrapDiagnostic({ ...valid, bootstrapCause }, isDiagnosticReason), false);
  }
  for (const isReason of [undefined, null, {}, () => false, () => 'true', () => 1,
    () => { throw Error('PRIVATE'); }]) assert.equal(validateBootstrapDiagnostic(valid, isReason), false);
  for (const phase of diagnosticPhases) {
    for (const cause of diagnosticCauses) {
      const marker = { initDiagnostic: 'valid', initPhase: phase, initCause: cause };
      assert.equal(validateBootstrapDiagnostic({ ...valid, ...marker }, isDiagnosticReason), true);
    }
  }
  for (const initDiagnostic of diagnosticChoices.initDiagnostic) {
    for (const fields of [{ initPhase: 'context' }, { initCause: 'invalidContext' },
      { initPhase: 'PRIVATE', initCause: 'PRIVATE' }, { initPhase: {}, initCause: [] }]) {
      assert.equal(validateBootstrapDiagnostic({ ...valid, initDiagnostic, ...fields }, isDiagnosticReason), false);
    }
  }
  assert.equal(validateBootstrapDiagnostic({ ...valid, initDiagnostic: 'valid' }, isDiagnosticReason), false);
});

test('version-two results strictly validate diagnostics without reinterpreting version one or changing the result cap', () => {
  const diagnostic = captureBootstrapDiagnostic(diagnosticSnapshot({ stderr: diagnosticMarker }));
  const facts = { reason: 'bootstrapUnknown', launched: true, rootCreated: true, sentinel: true };
  const result = resultFor(binding, { ...facts, bootstrapDiagnostic: diagnostic });
  assert.equal(resultSchemaVersion, 2);
  assert.equal(result.schemaVersion, resultSchemaVersion);
  assert.equal(limits.result, 4096);
  const line = serializeResult(result, binding);
  assert.ok(Buffer.byteLength(line) <= limits.result);
  assert.deepEqual(JSON.parse(line).bootstrapDiagnostic, diagnostic);
  const withoutDiagnostic = resultFor(binding, facts);
  assert.equal(withoutDiagnostic.bootstrapDiagnostic, null);
  serializeResult(withoutDiagnostic, binding);
  const old = { ...withoutDiagnostic, schemaVersion: 1 };
  delete old.bootstrapDiagnostic;
  assert.throws(() => serializeResult(old, binding), { reason: 'reportFailed' });
  assert.throws(() => serializeResult({ ...result, schemaVersion: 1 }, binding), { reason: 'reportFailed' });
  assert.throws(() => serializeResult({ ...old, schemaVersion: resultSchemaVersion }, binding), { reason: 'reportFailed' });
  for (const bootstrapDiagnostic of [undefined, [], 'PRIVATE', 1,
    { ...diagnostic, raw: 'PRIVATE' }, { ...diagnostic, bootstrapCause: 'PRIVATE' },
    { ...diagnostic, initCause: 'PRIVATE' }, { ...diagnostic, initDiagnostic: 'absent' },
    { ...diagnostic, goAttempted: 1 }, { ...diagnostic, [Symbol('extra')]: true }]) {
    assert.throws(() => serializeResult({ ...result, bootstrapDiagnostic }, binding), { reason: 'reportFailed' });
  }
  let accessorCalls = 0;
  const accessor = Object.defineProperty({ ...diagnostic }, 'initPhase', {
    get() { accessorCalls += 1; return 'statusValidation'; }, enumerable: true,
  });
  assert.throws(() => serializeResult({ ...result, bootstrapDiagnostic: accessor }, binding), { reason: 'reportFailed' });
  const outerAccessor = Object.defineProperty({ ...result }, 'bootstrapDiagnostic', {
    get() { accessorCalls += 1; return diagnostic; }, enumerable: true,
  });
  assert.throws(() => serializeResult(outerAccessor, binding), { reason: 'reportFailed' });
  assert.equal(accessorCalls, 0);
});

test('diagnostics never authorize acceptance, prerequisite absence or cleanup', () => {
  const bootstrapDiagnostic = captureBootstrapDiagnostic(diagnosticSnapshot({
    wrapper: { exited: true, closed: true, spawnCode: null, code: 41, signal: null },
    stderrEnded: true, replies: { ended: true, receivedBytes: 0 },
    toolAbsence: 'provenAbsent', readyAccepted: true, goAttempted: true, classificationAttempted: true,
  }));
  const facts = { reason: 'bootstrapUnknown', launched: true, rootCreated: true, sentinel: true };
  const failed = resultFor(binding, { ...facts, bootstrapDiagnostic });
  assert.deepEqual({ ...failed, bootstrapDiagnostic: null }, resultFor(binding, facts));
  assert.equal(failed.observation, 'failed');
  assert.equal(failed.cleanupOutcome, 'unverified');
  assert.equal(failed.evidenceOutcome, 'incomplete');
  serializeResult(failed, binding);
  assert.throws(() => serializeResult({ ...failed, observation: 'observed', reason: 'observed',
    evidenceOutcome: 'complete' }, binding), { reason: 'reportFailed' });
  assert.throws(() => serializeResult({ ...failed, observation: 'prerequisiteUnavailable',
    evidenceOutcome: 'complete' }, binding), { reason: 'reportFailed' });
  const successful = resultFor(binding, { reason: 'observed', workload: true, destroyed: true,
    sentinel: true, go: true, launched: true, rootCreated: true, removed: true, bootstrapDiagnostic });
  for (const change of [{ workloadOutcome: 'failed' }, { cleanupOutcome: 'unverified' },
    { sentinelOutcome: 'unverified' }, { evidenceOutcome: 'incomplete' }, { testRoot: 'retained' }]) {
    assert.throws(() => serializeResult({ ...successful, ...change }, binding), { reason: 'reportFailed' });
  }
  const denial = { spawnCode: null, code: 1, signal: null, ready: false, go: false,
    streamsClosed: true, responseBytes: 0, toolAbsent: false,
    stderr: 'unshare: unshare failed: Operation not permitted\n' };
  for (const stderr of [diagnosticMarker, `${denial.stderr}${diagnosticMarker}`]) {
    const snapshot = diagnosticSnapshot({ stderr });
    captureBootstrapDiagnostic(snapshot);
    assert.equal(snapshot.stderr, stderr);
    assert.equal(classifyBootstrap({ ...denial, stderr }), 'bootstrapUnknown');
  }
});

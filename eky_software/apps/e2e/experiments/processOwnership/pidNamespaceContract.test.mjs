import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  actorArguments, budgets, childEnvironment, classifyBootstrap, createDeadline,
  createFrames, createInitProtocol, descriptors, encodeMessage, expectedEofExit,
  experimentContext, limits, message, parseActorArguments, responseChannel,
  resultFor, serializeResult, unshareArguments, validateIdentity, validateInitStatus,
  validateMessage, writeMessage,
} from './pidNamespaceContract.mjs';

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

import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagedResult, managedFailure, managedSessionFailureReasons, parseManagedResult,
  serializeManagedResult, validateManagedSessionResult } from './managedNamespaceResult.mjs';
import { limits, NamespaceFailure, resultFor, resultSchemaVersion, serializeResult } from './pidNamespaceContract.mjs';

const binding = { consumer: 'system-api', checkoutSha: 'c'.repeat(40), runId: '123', runAttempt: '1' };
const phases = ['metadata', 'manager', 'policies', 'launchAttempted', 'launchAccepted',
  'ready', 'owned', 'go', 'workload', 'controlClosed'];
const sentinelFlags = ['started', 'before', 'after', 'closed', 'normalExit'];

function observedSession() {
  return { outcome: 'observed', failure: null, cleanupFailure: null, facts: {
    metadata: true, manager: true, policies: true, launchAttempted: true,
    launchAccepted: true, ready: true, owned: true, go: true, workload: true,
    controlClosed: true, waitingWrapper: 'normalExit', stop: 'notRequested', commandsClosed: true,
  } };
}

function initialState() {
  return { session: null, failure: null, cleanupFailure: null, root: 'notCreated',
    sentinel: { started: false, before: false, after: false, closed: false, normalExit: false } };
}

function completeState() {
  return { session: observedSession(), failure: null, cleanupFailure: null, root: 'removed',
    sentinel: { started: true, before: true, after: true, closed: true, normalExit: true } };
}

function failedState() {
  const state = completeState();
  state.root = 'retained';
  state.session.outcome = 'unverified';
  state.session.failure = { stage: 'workload', reason: 'unexpectedEof' };
  state.session.cleanupFailure = { stage: 'stop', reason: 'exitFailed' };
  Object.assign(state.session.facts, { workload: false, controlClosed: false,
    waitingWrapper: 'unverified', stop: 'unverified' });
  state.failure = { ...state.session.failure };
  state.cleanupFailure = { stage: 'sentinelStop', reason: 'sentinelFailed' };
  state.sentinel.normalExit = false;
  return state;
}

function rejectsSafely(action) {
  assert.throws(action, error => {
    assert.ok(error instanceof NamespaceFailure);
    assert.equal(error.message, 'PID namespace experiment incomplete');
    assert.equal(error.reason, 'reportFailed');
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE/u);
    return true;
  });
}

test('managed result roundtrips both consumer bindings as a bounded canonical immutable snapshot', () => {
  for (const consumer of ['system-api', 'web-chromium']) {
    const context = { ...binding, consumer };
    const state = completeState();
    const value = createManagedResult(context, state);
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.evidence, 'boundedManagedPidNamespaceOnly');
    assert.equal(value.namespaceOutcome, 'destroyed');
    assert.equal(value.evidenceOutcome, 'complete');
    const line = serializeManagedResult(value, context);
    assert.equal(line, `${JSON.stringify(value)}\n`);
    assert.ok(Buffer.byteLength(line) <= limits.result);
    assert.deepEqual(parseManagedResult(line, context), value);
    const reordered = Object.fromEntries(Object.entries(value).reverse());
    reordered.session = Object.fromEntries(Object.entries(value.session).reverse());
    reordered.session.facts = Object.fromEntries(Object.entries(value.session.facts).reverse());
    reordered.sentinel = Object.fromEntries(Object.entries(value.sentinel).reverse());
    assert.equal(serializeManagedResult(reordered, context), line);
    for (const record of [value, value.session, value.session.facts, value.sentinel,
      parseManagedResult(line, context)]) assert.ok(Object.isFrozen(record));
    state.session.facts.go = false; state.sentinel.after = false; context.runId = '456';
    assert.equal(serializeManagedResult(value, { ...binding, consumer }), line);
    assert.notEqual(value.session, state.session);
    assert.notEqual(value.session.facts, state.session.facts);
    assert.notEqual(value.sentinel, state.sentinel);
  }
});

test('every session success flag must be explicitly true and every field must be present', () => {
  for (const key of [...phases, 'commandsClosed']) {
    for (const replacement of [false, undefined, null, 1, 'true']) {
      const session = observedSession(); session.facts[key] = replacement;
      rejectsSafely(() => validateManagedSessionResult(session));
      rejectsSafely(() => createManagedResult(binding, { ...completeState(), session }));
    }
  }
  for (const key of Object.keys(observedSession().facts)) {
    const session = observedSession(); delete session.facts[key];
    rejectsSafely(() => validateManagedSessionResult(session));
  }
  for (const patch of [{ waitingWrapper: 'unverified' }, { stop: 'commandAccepted' }, { stop: 'unverified' }]) {
    const session = observedSession(); Object.assign(session.facts, patch);
    rejectsSafely(() => validateManagedSessionResult(session));
  }
  for (const field of ['failure', 'cleanupFailure']) {
    const session = observedSession();
    session[field] = field === 'failure' ? managedFailure('finalize', { reason: 'channelFailed' }) :
      managedFailure('commandDrain', { reason: 'cleanupUnverified' });
    rejectsSafely(() => validateManagedSessionResult(session));
  }
});

test('failure states cannot skip a phase or claim a wrapper exit without protocol closure', () => {
  for (let index = 1; index < phases.length; index++) {
    const session = failedState().session;
    for (const key of phases) session.facts[key] = false;
    session.facts[phases[index]] = true;
    session.facts.stop = 'notRequested'; session.cleanupFailure = null;
    rejectsSafely(() => validateManagedSessionResult(session));
  }
  const noControl = failedState().session;
  noControl.facts.waitingWrapper = 'normalExit';
  rejectsSafely(() => validateManagedSessionResult(noControl));
  const noFailure = failedState().session; noFailure.failure = null;
  rejectsSafely(() => validateManagedSessionResult(noFailure));
  const noCleanup = failedState().session;
  noCleanup.cleanupFailure = null; noCleanup.facts.stop = 'notRequested'; noCleanup.facts.commandsClosed = false;
  rejectsSafely(() => validateManagedSessionResult(noCleanup));
});

test('normal session observation is independent of sentinel proof and outer evidence completion', () => {
  const state = completeState(); state.root = 'retained';
  state.sentinel = initialState().sentinel;
  const value = createManagedResult(binding, state);
  assert.equal(value.session.outcome, 'observed');
  assert.equal(value.namespaceOutcome, 'destroyed');
  assert.equal(value.evidenceOutcome, 'incomplete');
  assert.deepEqual(parseManagedResult(serializeManagedResult(value, binding), binding), value);
});

test('every absent sentinel success flag prevents completion or root removal', () => {
  for (const key of sentinelFlags) {
    const missing = completeState(); delete missing.sentinel[key];
    rejectsSafely(() => createManagedResult(binding, missing));
    const removed = completeState(); removed.sentinel[key] = false;
    rejectsSafely(() => createManagedResult(binding, removed));
    const retained = completeState(); retained.root = 'retained'; retained.sentinel[key] = false;
    if (key === 'started') retained.sentinel = initialState().sentinel;
    if (key === 'closed') retained.sentinel.normalExit = false;
    assert.equal(createManagedResult(binding, retained).evidenceOutcome, 'incomplete');
    for (const replacement of [undefined, null, 1, 'true']) {
      const state = completeState(); state.sentinel[key] = replacement;
      rejectsSafely(() => createManagedResult(binding, state));
    }
  }
});

test('sentinel observations imply started and normal exit implies actual close', () => {
  for (const key of ['before', 'after', 'closed', 'normalExit']) {
    const state = initialState(); state.sentinel[key] = true;
    rejectsSafely(() => createManagedResult(binding, state));
  }
  const state = initialState(); state.sentinel.started = true; state.sentinel.normalExit = true;
  rejectsSafely(() => createManagedResult(binding, state));
});

test('stop-only acknowledgement and signalled wrapper failure stay unverified', () => {
  for (const reason of ['observationInvalid', 'exitFailed', 'deadlineExceeded']) {
    const state = failedState();
    state.session.failure = managedFailure('wrapper', { reason });
    state.failure = state.session.failure;
    state.session.facts.stop = 'commandAccepted'; state.session.cleanupFailure = null;
    const value = createManagedResult(binding, state);
    assert.equal(value.namespaceOutcome, 'unverified');
    assert.equal(value.evidenceOutcome, 'incomplete');
    assert.deepEqual(parseManagedResult(serializeManagedResult(value, binding), binding), value);
    rejectsSafely(() => serializeManagedResult({ ...value, namespaceOutcome: 'destroyed' }, binding));
    for (const outcome of ['removed', 'removalUnverified']) {
      rejectsSafely(() => createManagedResult(binding, { ...state, root: outcome }));
    }
  }
  const unowned = failedState().session;
  for (const key of ['owned', 'go', 'workload', 'controlClosed']) unowned.facts[key] = false;
  for (const stop of ['commandAccepted', 'unverified']) {
    unowned.facts.stop = stop;
    rejectsSafely(() => validateManagedSessionResult(unowned));
  }
  const lateFailure = completeState(); lateFailure.root = 'retained';
  lateFailure.session.outcome = 'unverified';
  lateFailure.session.failure = managedFailure('finalize', { reason: 'channelFailed' });
  lateFailure.failure = lateFailure.session.failure;
  assert.equal(createManagedResult(binding, lateFailure).namespaceOutcome, 'unverified');
});

test('prior session error, inner cleanup and outer cleanup survive independently', () => {
  const state = failedState();
  const value = createManagedResult(binding, state);
  const read = parseManagedResult(serializeManagedResult(value, binding), binding);
  assert.deepEqual(read.session.failure, { stage: 'workload', reason: 'unexpectedEof' });
  assert.deepEqual(read.failure, read.session.failure);
  assert.deepEqual(read.session.cleanupFailure, { stage: 'stop', reason: 'exitFailed' });
  assert.deepEqual(read.cleanupFailure, { stage: 'sentinelStop', reason: 'sentinelFailed' });
  for (const record of [read.failure, read.cleanupFailure, read.session.failure, read.session.cleanupFailure]) {
    assert.ok(Object.isFrozen(record));
  }
  state.session.failure.reason = 'PRIVATE';
  state.cleanupFailure.reason = 'PRIVATE';
  assert.doesNotMatch(serializeManagedResult(value, binding), /PRIVATE/u);
});

test('a bound report cannot erase or replace the original session failure', () => {
  for (const failure of [null, { stage: 'report', reason: 'reportFailed' },
    { stage: 'workload', reason: 'experimentFailed' }, { stage: 'wrapper', reason: 'unexpectedEof' }]) {
    const state = failedState(); state.failure = failure;
    rejectsSafely(() => createManagedResult(binding, state));
    const result = structuredClone(createManagedResult(binding, failedState())); result.failure = failure;
    rejectsSafely(() => serializeManagedResult(result, binding));
    rejectsSafely(() => parseManagedResult(`${JSON.stringify(result)}\n`, binding));
  }
});

test('notCreated cannot conceal a started sentinel or a returned session', () => {
  const started = initialState(); started.sentinel.started = true;
  const returned = initialState(); returned.session = observedSession();
  for (const state of [started, returned]) rejectsSafely(() => createManagedResult(binding, state));
  const result = createManagedResult(binding, completeState());
  rejectsSafely(() => serializeManagedResult({ ...result, root: 'notCreated', evidenceOutcome: 'incomplete' }, binding));
});

test('root removal requires observed session, complete sentinel proof and no cleanup failure', () => {
  for (const root of ['removed', 'removalUnverified']) {
    for (const mutate of [state => { state.session = null; },
      state => { state.cleanupFailure = managedFailure('sentinelStop', { reason: 'cleanupUnverified' }); }]) {
      const state = completeState(); state.root = root; mutate(state);
      rejectsSafely(() => createManagedResult(binding, state));
    }
    for (const stage of ['rootRemoval', 'report']) {
      const state = completeState(); state.root = root;
      state.failure = managedFailure(stage, { reason: 'deadlineExceeded' });
      const value = createManagedResult(binding, state);
      assert.equal(value.namespaceOutcome, 'destroyed'); assert.equal(value.evidenceOutcome, 'incomplete');
      assert.deepEqual(parseManagedResult(serializeManagedResult(value, binding), binding), value);
    }
  }
  const state = completeState(); state.root = 'removalUnverified';
  assert.equal(createManagedResult(binding, state).evidenceOutcome, 'incomplete');
});

test('not-started evidence is distinct from pending session or ambiguous launch', () => {
  assert.equal(createManagedResult(binding, initialState()).namespaceOutcome, 'notStarted');
  const pending = initialState(); pending.root = 'retained'; pending.sentinel.started = true;
  pending.sentinel.before = true;
  pending.failure = managedFailure('report', { reason: 'deadlineExceeded' });
  const snapshot = createManagedResult(binding, pending);
  assert.equal(snapshot.namespaceOutcome, 'unverified');
  assert.equal(snapshot.evidenceOutcome, 'incomplete');
  assert.deepEqual(parseManagedResult(serializeManagedResult(snapshot, binding), binding), snapshot);
  const state = failedState();
  for (const key of phases) state.session.facts[key] = false;
  state.session.facts.stop = 'notRequested'; state.session.cleanupFailure = null;
  state.session.failure = managedFailure('metadata', { reason: 'metadataReadFailed' });
  state.failure = state.session.failure;
  assert.equal(createManagedResult(binding, state).namespaceOutcome, 'notStarted');
  for (const key of ['metadata', 'manager', 'policies', 'launchAttempted']) state.session.facts[key] = true;
  state.session.failure = managedFailure('launch', { reason: 'exitFailed' });
  state.failure = state.session.failure;
  assert.equal(createManagedResult(binding, state).namespaceOutcome, 'unverified');
});

test('managedFailure preserves only allowlisted stages and reasons without reading getters', () => {
  let accessed = 0;
  assert.ok(Object.isFrozen(managedSessionFailureReasons));
  for (const reason of [...managedSessionFailureReasons, 'notLinux', 'experimentFailed', 'reportFailed',
    'workloadFailed', 'invalidStatus', 'unverified']) {
    const failure = managedFailure('session', Object.assign(Error('PRIVATE'), { reason }));
    assert.deepEqual(failure, { stage: 'session', reason }); assert.ok(Object.isFrozen(failure));
  }
  for (const stage of ['configuration', 'metadata', 'manager', 'policy', 'control', 'launch', 'ready',
    'ownership', 'go', 'workload', 'controlClose', 'wrapper', 'finalize', 'stop', 'commandDrain',
    'context', 'root', 'sentinelStart', 'sentinelBefore', 'sentinelAfter', 'sentinelStop', 'rootRemoval', 'report', 'session']) {
    assert.equal(managedFailure(stage, null).stage, stage);
  }
  for (const error of [null, undefined, 'exitFailed', Error('PRIVATE'), { reason: 'PRIVATE' },
    { get reason() { accessed++; throw Error('PRIVATE'); } }, Object.create({ reason: 'exitFailed' }),
    new Proxy({}, { getOwnPropertyDescriptor() { accessed++; throw Error('PRIVATE'); } })]) {
    assert.deepEqual(managedFailure('PRIVATE', error), { stage: 'session', reason: 'unverified' });
  }
  assert.equal(accessed, 0);
});

test('null or invalid binding produces only incomplete invalidContext with no raw binding values', () => {
  for (const context of [null, undefined, {}, { ...binding, runAttempt: '0' }, { ...binding, consumer: 'PRIVATE' },
    { ...binding, get checkoutSha() { assert.fail('binding getter executed'); } },
    { ...binding, [Symbol('PRIVATE')]: true }]) {
    for (const state of [initialState(), completeState(), failedState()]) {
      const value = createManagedResult(context, state);
      assert.equal(value.evidenceOutcome, 'incomplete');
      assert.deepEqual(value.failure, { stage: 'context', reason: 'invalidContext' });
      for (const key of Object.keys(binding)) assert.equal(value[key], null);
      const line = serializeManagedResult(value, context);
      assert.doesNotMatch(line, /PRIVATE/u);
      assert.deepEqual(parseManagedResult(line, null), value);
      rejectsSafely(() => serializeManagedResult({ ...value, evidenceOutcome: 'complete' }, null));
      rejectsSafely(() => serializeManagedResult({ ...value, failure: null }, null));
    }
  }
});

test('stale consumer, checkout, run and attempt bindings are rejected by writer and reader', () => {
  const value = createManagedResult(binding, completeState()); const line = serializeManagedResult(value, binding);
  for (const context of [{ ...binding, consumer: 'web-chromium' }, { ...binding, checkoutSha: 'd'.repeat(40) },
    { ...binding, runId: '124' }, { ...binding, runAttempt: '2' }, null, {}]) {
    rejectsSafely(() => serializeManagedResult(value, context));
    rejectsSafely(() => parseManagedResult(line, context));
  }
  const empty = createManagedResult(null, initialState());
  rejectsSafely(() => parseManagedResult(serializeManagedResult(empty, null), binding));
});

test('driver state and every nested record reject extra, accessor, symbol and hidden fields', () => {
  let accessed = 0;
  const targets = [state => state, state => state.session, state => state.session.facts,
    state => state.session.failure, state => state.session.cleanupFailure,
    state => state.failure, state => state.cleanupFailure, state => state.sentinel];
  const mutations = [record => { record.private = 'PRIVATE'; },
    record => { record[Symbol('PRIVATE')] = true; },
    record => { Object.defineProperty(record, 'private', { value: 'PRIVATE' }); },
    record => { Object.defineProperty(record, Object.keys(record)[0], {
      enumerable: true, get() { accessed++; throw Error('PRIVATE'); },
    }); },
    record => { Object.defineProperty(record, Object.keys(record)[0], { enumerable: false }); },
    record => { Object.setPrototypeOf(record, { private: 'PRIVATE' }); },
    record => { delete record[Object.keys(record)[0]]; }];
  for (const target of targets) for (const mutate of mutations) {
    const state = failedState(); mutate(target(state));
    rejectsSafely(() => createManagedResult(binding, state));
  }
  for (const target of targets) for (const mutate of mutations) {
    const value = structuredClone(createManagedResult(binding, failedState())); mutate(target(value));
    rejectsSafely(() => serializeManagedResult(value, binding));
  }
  assert.equal(accessed, 0);
});

test('wrong types, raw failures, unsafe stages and unsupported enums cannot be serialized', () => {
  for (const bad of ['PRIVATE', Error('PRIVATE'), [], 0, true, undefined,
    { stage: 'PRIVATE', reason: 'exitFailed' }, { stage: 'launch', reason: 'PRIVATE' }]) {
    for (const target of ['failure', 'cleanupFailure']) {
      const state = failedState(); state[target] = bad;
      rejectsSafely(() => createManagedResult(binding, state));
      const inner = failedState(); inner.session[target] = bad;
      rejectsSafely(() => createManagedResult(binding, inner));
    }
  }
  for (const mutate of [state => { state.root = 'PRIVATE'; }, state => { state.session = 'observed'; },
    state => { state.session.outcome = 'destroyed'; }, state => { state.session.facts.waitingWrapper = 'SIGKILL'; },
    state => { state.session.facts.stop = 'stopped'; }, state => { state.sentinel = []; },
    state => { state.session.failure.stage = 'sentinelStart'; },
    state => { state.session.cleanupFailure.stage = 'workload'; }]) {
    const state = failedState(); mutate(state);
    rejectsSafely(() => createManagedResult(binding, state));
  }
  const value = createManagedResult(binding, completeState());
  for (const patch of [{ namespaceOutcome: 'PRIVATE' }, { evidenceOutcome: 'accepted' },
    { schemaVersion: '1' }, { evidence: 'boundedPidNamespaceOnly' }, { consumer: null }]) {
    rejectsSafely(() => serializeManagedResult({ ...value, ...patch }, binding));
  }
});

test('reader rejects duplicates, reordered fields, tails, alternate encodings and multiline input', () => {
  const value = createManagedResult(binding, completeState());
  const line = serializeManagedResult(value, binding);
  for (const invalid of [line.slice(0, -1), ` ${line}`, `${line}\n`, `${line}{}`, `${line}{`, `${line}PRIVATE\n`,
    line.replace('\n', '\r\n'), line.replace('\n', '\0\n'), line.replace('\n', '\uFFFD\n'),
    `${JSON.stringify(value, null, 2)}\n`, line.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    line.replace('"metadata":true', '"metadata":false,"metadata":true'),
    line.replace('"normalExit":true', '"normalExit":true,"normalExit":true'),
    line.replace('"schemaVersion":1', '"schemaVersion":1.0'), line.replace('system-api', '\\u0073ystem-api'),
    `${JSON.stringify(Object.fromEntries(Object.entries(value).reverse()))}\n`,
    '\n', '{}\n', 'PRIVATE\n', '', null, Buffer.from(line)]) {
    rejectsSafely(() => parseManagedResult(invalid, binding));
  }
});

test('oversized, cyclic and proxy inputs fail safely without executing caller code', () => {
  const line = serializeManagedResult(createManagedResult(binding, completeState()), binding);
  for (const invalid of [' '.repeat(limits.result) + '\n', `${'\u00e4'.repeat(limits.result / 2)}\n`,
    line.replace('"runId":"123"', `"runId":"${'1'.repeat(limits.result)}"`)]) {
    rejectsSafely(() => parseManagedResult(invalid, binding));
  }
  const huge = completeState(); huge.failure = { stage: 'report', reason: 'P'.repeat(limits.result) };
  rejectsSafely(() => createManagedResult(binding, huge));
  const cyclic = completeState(); cyclic.session.facts = cyclic.session;
  rejectsSafely(() => createManagedResult(binding, cyclic));
  let accessed = 0;
  const proxy = new Proxy({}, { getPrototypeOf() { accessed++; throw Error('PRIVATE'); } });
  rejectsSafely(() => validateManagedSessionResult(proxy));
  rejectsSafely(() => createManagedResult(binding, proxy));
  rejectsSafely(() => serializeManagedResult(proxy, binding));
  assert.equal(accessed, 0);
});

test('legacy schema 3 results stay separate and cannot be upgraded by either reader or writer', () => {
  assert.equal(resultSchemaVersion, 3);
  const legacy = resultFor(binding, { reason: 'observed', workload: true, destroyed: true,
    sentinel: true, removed: true });
  const line = serializeResult(legacy, binding);
  assert.equal(legacy.evidence, 'boundedPidNamespaceOnly');
  rejectsSafely(() => parseManagedResult(line, binding));
  rejectsSafely(() => serializeManagedResult(legacy, binding));
  assert.throws(() => serializeResult(createManagedResult(binding, completeState()), binding), NamespaceFailure);
});

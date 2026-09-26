import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { budgets, childEnvironment, descriptors, encodeMessage, message } from './pidNamespaceContract.mjs';
import { parseManagedResult, serializeManagedResult } from './managedNamespaceResult.mjs';
import { runManagedExperiment, runManagedNamespaceCli } from './runManagedNamespaceExperiment.mjs';

const binding = { consumer: 'system-api', checkoutSha: 'c'.repeat(40), runId: '123', runAttempt: '1' };
const environment = { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: binding.runId, GITHUB_RUN_ATTEMPT: binding.runAttempt };
const started = '1000000';
const root = '/synthetic-temp/eky-managed-ns-ABC123';

function sessionResult() {
  return { outcome: 'observed', failure: null, cleanupFailure: null, facts: {
    metadata: true, manager: true, policies: true, launchAttempted: true, launchAccepted: true,
    ready: true, owned: true, go: true, workload: true, controlClosed: true,
    waitingWrapper: 'normalExit', stop: 'notRequested', commandsClosed: true,
  } };
}

function clock() {
  let elapsed = 0;
  let id = 0;
  const timers = new Map();
  return { now: () => BigInt(started) + BigInt(elapsed) * 1000000n,
    time: { setTimeout(fn, delay) { timers.set(++id, { fn, at: elapsed + delay }); return id; },
      clearTimeout(key) { timers.delete(key); } },
    timers,
    set(ms) { elapsed = ms; },
    advance(ms) {
      elapsed = ms;
      for (const [key, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= elapsed && timers.delete(key)) timer.fn();
      }
    },
  };
}

function fixture(options = {}) {
  const c = clock();
  const calls = [];
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdio = [child.stdin, null, null, new EventEmitter()];
  child.kills = [];
  child.finish = (code = 0, signal = null) => {
    child.emit('exit', code, signal);
    if (!options.missingEof) child.stdio[3].emit('end');
    child.stdio[3].emit('close');
    if (!options.missingClose) child.emit('close', code, signal);
  };
  child.kill = signal => {
    child.kills.push(signal);
    if (!options.stuckSentinel) child.finish(null, signal);
    return true;
  };
  let challengeCount = 0;
  child.stdin.write = (bytes, done) => {
    const value = JSON.parse(bytes);
    calls.push(value.type);
    if (value.type === 'STOP') {
      if (options.stopWriteError) { done(Error('PRIVATE_WRITE')); return; }
      done();
      queueMicrotask(() => {
        if (options.stopTail) child.stdio[3].emit('data', Buffer.from('{'));
        if (options.stopLate) c.set(budgets.sentinel);
        if (!options.stuckSentinel) child.finish(options.stopCode ?? 0, options.stopSignal ?? null);
      });
      return;
    }
    challengeCount++;
    done();
    queueMicrotask(() => {
      if (options.missingChallenge === challengeCount) return;
      if (options.badChallenge === challengeCount) value.challenge = 'f'.repeat(32);
      child.stdio[3].emit('data', encodeMessage(message('ALIVE', value.generation, value.challenge)));
      if (options.earlyExit === challengeCount) child.finish(0);
    });
  };
  const metadata = { isDirectory: () => true, isSymbolicLink: () => false,
    uid: 1001, gid: 1002, mode: 0o40700, dev: 1, ino: 5 };
  const fs = {
    realpathSync(path) {
      calls.push('realpath');
      return path.endsWith('managedNamespaceInit.mjs') ? '/source/managedNamespaceInit.mjs' : path;
    },
    mkdtempSync(prefix) { calls.push('createRoot'); assert.equal(prefix, '/synthetic-temp/eky-managed-ns-'); return root; },
    lstatSync(path) { calls.push('inspectRoot'); assert.equal(path, root); return metadata; },
    rmdirSync(path) {
      calls.push('removeRoot'); assert.equal(path, root);
      if (options.removeError) throw Error('PRIVATE_NONEMPTY_ROOT');
      if (options.removeLate) c.set(budgets.report);
    },
  };
  const runtime = { platform: 'linux', env: { ...environment }, execPath: '/opt/node/bin/node',
    getuid: () => 1001, geteuid: () => 1001, getgid: () => 1002, getegid: () => 1002 };
  let sequence = 0;
  const observed = sessionResult();
  let sessionOptions;
  const operations = { runtime, fs, tempDirectory: () => '/synthetic-temp', now: c.now, time: c.time,
    nonce: () => (++sequence).toString(16).padStart(32, '0'),
    spawnChild(file, args, settings) {
      calls.push('spawnSentinel');
      assert.equal(file, runtime.execPath);
      assert.match(args[0], /pidNamespaceActor\.mjs$/u);
      assert.deepEqual(settings, { cwd: root, env: childEnvironment(), shell: false,
        detached: false, stdio: [...descriptors.sentinel] });
      assert.ok(args.includes('--role=sentinel'));
      assert.ok(args.includes(`--started=${started}`));
      if (options.spawnThrows) throw Error('PRIVATE_SPAWN');
      if (options.spawnError) queueMicrotask(() => { child.emit('error', { code: 'PRIVATE_SPAWN' }); child.finish(1); });
      return child;
    },
    session: async value => {
      sessionOptions = value;
      calls.push('session');
      if (options.sessionThrows) throw Error('PRIVATE_SESSION');
      if (!options.noBeforeGo) await value.beforeGo();
      calls.push('goPermitted');
      options.afterSession?.({ metadata, child, observed, c });
      return observed;
    },
  };
  return { ...c, calls, child, metadata, observed, runtime, operations,
    get sessionOptions() { return sessionOptions; } };
}

const run = f => runManagedExperiment({ ...f.operations, started, binding });

test('outer driver combines original deadline, separate sentinel, session and empty-root removal', async () => {
  const f = fixture();
  const result = await run(f);
  assert.equal(result.evidenceOutcome, 'complete');
  assert.equal(result.namespaceOutcome, 'destroyed');
  assert.equal(result.root, 'removed');
  assert.deepEqual(result.sentinel, { started: true, before: true, after: true, closed: true, normalExit: true });
  assert.deepEqual(f.child.kills, []);
  assert.ok(f.calls.indexOf('spawnSentinel') < f.calls.indexOf('session'));
  assert.ok(f.calls.indexOf('CHALLENGE') < f.calls.indexOf('goPermitted'));
  assert.ok(f.calls.lastIndexOf('CHALLENGE') > f.calls.indexOf('goPermitted'));
  assert.ok(f.calls.indexOf('STOP') < f.calls.indexOf('removeRoot'));
  assert.equal(f.sessionOptions.config.started, started);
  assert.equal(f.sessionOptions.config.node, '/opt/node/bin/node');
  assert.equal(f.sessionOptions.config.init, '/source/managedNamespaceInit.mjs');
  assert.equal(f.timers.size, 0);
  assert.deepEqual(parseManagedResult(serializeManagedResult(result, binding), binding), result);
});

test('context and nonroot guards reject before filesystem and spawn', async () => {
  for (const change of [f => { f.runtime.platform = 'win32'; }, f => { f.runtime.env.CI = 'false'; },
    f => { f.runtime.geteuid = () => 0; }, f => { f.runtime.env.EKY_E2E = '0'; }]) {
    const f = fixture(); change(f);
    const result = await run(f);
    assert.equal(result.evidenceOutcome, 'incomplete');
    assert.equal(result.root, 'notCreated');
    assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  const result = await runManagedExperiment({ ...f.operations, started, binding: null });
  assert.equal(result.evidenceOutcome, 'incomplete');
  assert.deepEqual(f.calls, []);
});

test('invalid root, changed root identity and nonempty root are never recursively removed', async () => {
  const early = fixture(); early.metadata.mode = 0o40777;
  assert.equal((await run(early)).root, 'retained');
  assert.ok(!early.calls.includes('spawnSentinel'));
  const changed = fixture({ afterSession: ({ metadata }) => { metadata.ino++; } });
  assert.equal((await run(changed)).root, 'retained');
  assert.ok(!changed.calls.includes('removeRoot'));
  const nonempty = fixture({ removeError: true });
  const result = await run(nonempty);
  assert.equal(result.root, 'removalUnverified');
  assert.equal(result.evidenceOutcome, 'incomplete');
  assert.equal(result.failure.stage, 'rootRemoval');
});

test('failed or invalid session retains root and never promotes stop acknowledgement', async () => {
  for (const mutation of [value => {
    value.outcome = 'unverified'; value.failure = { stage: 'workload', reason: 'unexpectedEof' };
    value.facts.workload = false; value.facts.controlClosed = false;
    value.facts.waitingWrapper = 'unverified'; value.facts.stop = 'commandAccepted';
  }, value => { value.facts.waitingWrapper = 'unverified'; }, value => { value.extra = 'PRIVATE'; }]) {
    const f = fixture(); mutation(f.observed);
    const result = await run(f);
    assert.equal(result.evidenceOutcome, 'incomplete');
    assert.notEqual(result.namespaceOutcome, 'destroyed');
    assert.equal(result.root, 'retained');
    assert.ok(!f.calls.includes('removeRoot'));
    assert.doesNotMatch(serializeManagedResult(result, binding), /PRIVATE/u);
  }
});

test('missing before-GO hook cannot be replaced by an after-session sentinel response', async () => {
  const f = fixture({ noBeforeGo: true });
  const result = await run(f);
  assert.equal(result.sentinel.before, false);
  assert.equal(result.sentinel.after, true);
  assert.equal(result.evidenceOutcome, 'incomplete');
  assert.equal(result.root, 'retained');
});

test('bad challenge or an already-exited sentinel blocks acceptance and keeps cleanup separate', async () => {
  for (const options of [{ badChallenge: 1 }, { badChallenge: 2 }, { earlyExit: 1 }, { earlyExit: 2 },
    { stopCode: 42 }, { stopSignal: 'SIGKILL' }, { stopTail: true }, { missingEof: true },
    { stopWriteError: true }, { spawnError: true }, { spawnThrows: true }, { sessionThrows: true }]) {
    const f = fixture(options);
    const result = await run(f);
    assert.equal(result.evidenceOutcome, 'incomplete', JSON.stringify(options));
    assert.equal(result.root, 'retained');
    assert.ok(!f.calls.includes('removeRoot'));
    assert.doesNotMatch(serializeManagedResult(result, binding), /PRIVATE/u);
  }
});

test('first session failure survives subsequent sentinel failure and forced cleanup', async () => {
  const f = fixture({ badChallenge: 2, stopWriteError: true });
  f.observed.outcome = 'unverified';
  f.observed.failure = { stage: 'wrapper', reason: 'observationInvalid' };
  f.observed.cleanupFailure = { stage: 'stop', reason: 'exitFailed' };
  f.observed.facts.waitingWrapper = 'unverified'; f.observed.facts.stop = 'unverified';
  const result = await run(f);
  assert.deepEqual(result.failure, f.observed.failure);
  assert.deepEqual(result.session.cleanupFailure, f.observed.cleanupFailure);
  assert.equal(result.cleanupFailure.stage, 'sentinelStop');
  assert.deepEqual(f.child.kills, ['SIGKILL']);
});

test('original before-GO deadline is not restarted after slow session preparation', async () => {
  const f = fixture();
  f.operations.session = async value => { f.set(budgets.ready); await value.beforeGo(); return f.observed; };
  const result = await run(f);
  assert.equal(result.failure.reason, 'deadlineExceeded');
  assert.equal(result.sentinel.before, false);
  assert.equal(result.evidenceOutcome, 'incomplete');
  assert.equal(result.root, 'retained');
});

test('late sentinel terminal or root removal never reports complete', async () => {
  for (const options of [{ stopLate: true }, { removeLate: true }]) {
    const f = fixture(options);
    const result = await run(f);
    assert.equal(result.evidenceOutcome, 'incomplete');
    assert.equal((result.failure ?? result.cleanupFailure).reason, 'deadlineExceeded');
  }
});

test('unclosed sentinel retains uncertainty within the original report budget', async () => {
  const f = fixture({ missingClose: true });
  const promise = run(f);
  await setImmediate();
  f.advance(budgets.sentinel);
  await setImmediate();
  f.advance(budgets.report);
  const result = await promise;
  assert.equal(result.sentinel.normalExit, false);
  assert.equal(result.sentinel.closed, false);
  assert.equal(result.root, 'retained');
  assert.equal(result.evidenceOutcome, 'incomplete');
});

test('a repeated sentinel challenge nonce is rejected rather than replayed', async () => {
  const f = fixture(); let n = 0;
  f.operations.nonce = () => Math.min(++n, 3).toString(16).padStart(32, '0');
  const result = await run(f);
  assert.equal(result.failure.reason, 'invalidArguments');
  assert.equal(result.root, 'retained');
});

test('publication ending the run blocks subsequent root deletion', async () => {
  const f = fixture();
  const result = await runManagedExperiment({ ...f.operations, started, binding,
    isEnded: () => f.calls.includes('STOP') });
  assert.equal(result.root, 'retained');
  assert.equal(result.failure.reason, 'deadlineExceeded');
  assert.ok(!f.calls.includes('removeRoot'));
});

function cli(f, extra = {}) {
  const lines = []; const exits = [];
  const promise = runManagedNamespaceCli({ ...f.operations,
    argv: [`--consumer=${binding.consumer}`, `--checkout-sha=${binding.checkoutSha}`],
    writeLine: (line, done) => { lines.push(line); done(); }, exit: code => exits.push(code), ...extra });
  return { lines, exits, promise };
}

test('CLI success and failure publish one closed bound result with matching exit status', async () => {
  for (const options of [{}, { badChallenge: 2 }]) {
    const f = fixture(options); const invocation = cli(f);
    const code = await invocation.promise;
    assert.equal(code, options.badChallenge ? 1 : 0);
    assert.deepEqual(invocation.exits, [code]);
    assert.equal(invocation.lines.length, 1);
    const result = parseManagedResult(invocation.lines[0], binding);
    assert.equal(result.evidenceOutcome, code === 0 ? 'complete' : 'incomplete');
    assert.equal(f.timers.size, 0);
  }
});

test('invalid CLI binding does not perform IO and still emits a bounded rejection', async () => {
  const f = fixture(); const invocation = cli(f, { argv: [] });
  assert.equal(await invocation.promise, 1);
  assert.equal(parseManagedResult(invocation.lines[0], null).failure.reason, 'invalidContext');
  assert.deepEqual(f.calls, []);
});

test('publication throw, callback error and delayed callback cannot produce successful CLI exit', async () => {
  for (const mode of ['throw', 'callbackError', 'late']) {
    const f = fixture(); let writes = 0;
    const invocation = cli(f, { writeLine: (_line, done) => {
      writes++;
      if (mode === 'throw') throw Error('PRIVATE_PUBLICATION');
      if (mode === 'late') f.set(budgets.report);
      done(mode === 'callbackError' ? Error('PRIVATE_PUBLICATION') : null);
    } });
    assert.equal(await invocation.promise, 1);
    assert.equal(writes, 1);
    assert.deepEqual(invocation.exits, [1]);
  }
});

test('report timer emits incomplete state once; late session return cannot remove root or republish', async () => {
  const f = fixture(); let release;
  f.operations.session = async value => {
    await value.beforeGo();
    return new Promise(resolve => { release = resolve; });
  };
  const invocation = cli(f);
  await setImmediate();
  f.advance(budgets.sentinel);
  assert.deepEqual(f.child.kills, ['SIGKILL']);
  f.advance(budgets.report);
  assert.equal(await invocation.promise, 1);
  assert.equal(invocation.lines.length, 1);
  assert.equal(parseManagedResult(invocation.lines[0], binding).evidenceOutcome, 'incomplete');
  release(f.observed);
  await setImmediate();
  assert.equal(invocation.lines.length, 1);
  assert.deepEqual(invocation.exits, [1]);
  assert.ok(!f.calls.includes('removeRoot'));
  assert.deepEqual(f.child.kills, ['SIGKILL']);
  assert.equal(f.timers.size, 0);
});

test('pending session cannot postpone the original sentinel emergency stop or invent close', async () => {
  const f = fixture({ stuckSentinel: true }); let release;
  f.operations.session = async value => {
    await value.beforeGo();
    return new Promise(resolve => { release = resolve; });
  };
  const invocation = cli(f);
  await setImmediate();
  f.advance(budgets.sentinel - 1);
  assert.deepEqual(f.child.kills, []);
  f.advance(budgets.sentinel);
  assert.deepEqual(f.child.kills, ['SIGKILL']);
  assert.equal(invocation.lines.length, 0);
  f.advance(budgets.report);
  assert.equal(await invocation.promise, 1);
  const result = parseManagedResult(invocation.lines[0], binding);
  assert.equal(result.sentinel.before, true);
  assert.equal(result.sentinel.closed, false);
  assert.equal(result.sentinel.normalExit, false);
  assert.equal(result.cleanupFailure.reason, 'deadlineExceeded');
  assert.equal(result.root, 'retained');
  release(f.observed);
  await setImmediate();
  assert.deepEqual(f.child.kills, ['SIGKILL']);
  assert.equal(invocation.lines.length, 1);
  assert.ok(!f.calls.includes('removeRoot'));
  assert.equal(f.timers.size, 0);
});

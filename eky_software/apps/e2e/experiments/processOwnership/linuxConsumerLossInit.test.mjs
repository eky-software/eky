import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { runLinuxConsumerLossInit } from './linuxConsumerLossInit.mjs';
import { openLinuxConsumerExchange } from './linuxConsumerExchange.mjs';
import { ownerLossExit } from './linuxConsumerLossContract.mjs';
import { waitConsumerLossRecord } from './linuxConsumerLossRecords.mjs';
import { failureExit } from './pidNamespaceContract.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const pending = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
};
const root = '/synthetic-temp/eky-managed-ns-ABC123';
const generation = 'a'.repeat(32);

test('only deliberate owner loss has distinct exit 43; ordinary experiment failure remains 42', () => {
  assert.equal(ownerLossExit, 43); assert.equal(failureExit, 42);
});

function fixture(profile = 'backend') {
  let clock = 1_000_000n;
  const started = pending(); const record = pending();
  const calls = []; const exits = []; const waits = []; const spawned = [];
  const config = { root, profile, generation, uid: 1001, gid: 1002,
    startUntil: '45001000000', workUntil: '90001000000' };
  const arm = { caseId: `${profile}-owner`, profile, generation, cause: 'owner' };
  const workload = Object.freeze({ started: started.promise, snapshot: () => 'unchanged', rss: () => 1 });
  let initOptions;
  let exchangeOptions;
  const exchange = {};
  const runtime = { exit(code) { exits.push(code); } };
  const deps = {
    runtime, now: () => clock,
    readConfig(actual) { assert.equal(actual, root); calls.push('readConfig'); return config; },
    openExchange(options) { exchangeOptions = options; calls.push('openExchange'); return exchange; },
    runInit(actualRoot, options) {
      assert.equal(actualRoot, root); calls.push('runInit'); initOptions = options;
    },
    spawnWorkload(...args) { spawned.push(args); return workload; },
    waitRecord(actualExchange, name, deadline, phase) {
      assert.equal(actualExchange, exchange); calls.push('waitArm');
      waits.push({ name, deadline, phase });
      return record.promise.then(value => {
        exchangeOptions.records[0].validate(value); calls.push('armValidated'); return value;
      });
    },
  };
  return { config, arm, calls, exits, waits, spawned, workload, runtime, deps, started, record,
    get initOptions() { return initOptions; }, get exchangeOptions() { return exchangeOptions; },
    run: () => runLinuxConsumerLossInit(root, deps),
    advance(milliseconds) { clock += BigInt(milliseconds) * 1_000_000n; },
  };
}

test('importing the fixed init entrypoint neither launches a child nor exits the importer', async t => {
  const spawn = t.mock.method(childProcess, 'spawn', () => assert.fail('Import must not spawn'));
  const exit = t.mock.method(process, 'exit', () => assert.fail('Import must not exit'));
  syncBuiltinESMExports();
  try {
    await import('./linuxConsumerLossInit.mjs?import-only');
    assert.equal(spawn.mock.callCount(), 0); assert.equal(exit.mock.callCount(), 0);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('delegates to the init with only runtime and a transparent workload wrapper', () => {
  const f = fixture(); f.run();
  assert.deepEqual(f.calls, ['readConfig', 'openExchange', 'runInit']);
  assert.deepEqual(Object.keys(f.initOptions).sort(), ['runtime', 'spawnWorkload']);
  assert.equal(f.initOptions.runtime, f.runtime);
  assert.equal(f.spawned.length, 0);
  const command = { file: 'synthetic-node', args: ['synthetic-workload'] };
  const redacted = ['synthetic-private']; const terminal = () => {};
  assert.equal(f.initOptions.spawnWorkload(command, redacted, terminal), f.workload);
  assert.equal(f.spawned[0][0], command); assert.equal(f.spawned[0][1], redacted);
  assert.equal(f.spawned[0][2], terminal);
  assert.deepEqual(f.exits, []); assert.deepEqual(f.waits, []);
});

for (const profile of ['backend', 'vite', 'chromium']) {
  test(`${profile} owner arm is fixed and cannot exit before the actual workload starts`, async () => {
    const f = fixture(profile); f.run();
    const options = f.exchangeOptions;
    assert.equal(options.root, root);
    assert.deepEqual(options.identity, { uid: 1001, gid: 1002 });
    assert.equal(options.nonce, generation); assert.equal(options.caseId, `${profile}-owner`);
    assert.equal(options.role, 'init');
    assert.equal(options.serviceRoot, true);
    assert.deepEqual(options.records.map(value => [value.name, value.writer]), [['armed.json', 'caller']]);
    f.initOptions.spawnWorkload(); f.record.resolve(f.arm);
    await turn();
    assert.deepEqual(f.exits, []); assert.deepEqual(f.waits, []);
    f.started.resolve({ state: 'running' });
    await turn();
    assert.deepEqual(f.exits, [ownerLossExit]);
    assert.deepEqual(f.calls.slice(-2), ['waitArm', 'armValidated']);
    assert.equal(f.waits[0].name, 'armed.json'); assert.equal(f.waits[0].phase, 'work');
  });
}

test('started workload still waits for the arm using its original work deadline', async () => {
  const f = fixture(); f.run(); f.initOptions.spawnWorkload();
  f.advance(12000); f.started.resolve({ state: 'running' });
  await turn();
  assert.deepEqual(f.exits, []);
  assert.equal(f.waits[0].deadline.remaining('work'), 78000);
  f.record.resolve(f.arm); await turn(); assert.deepEqual(f.exits, [ownerLossExit]);
});

for (const field of ['caseId', 'profile', 'generation', 'cause']) {
  test(`wrong armed ${field} fails the real bound record validator`, async () => {
    const f = fixture(); f.run(); f.initOptions.spawnWorkload(); f.started.resolve();
    const invalid = { ...f.arm, [field]: field === 'generation' ? 'c'.repeat(32) : 'wrong' };
    assert.throws(() => f.exchangeOptions.records[0].validate(invalid), /LOSS_UNVERIFIED/u);
    f.record.resolve(invalid); await turn();
    assert.ok(!f.calls.includes('armValidated'));
    assert.deepEqual(f.exits, [42]);
    assert.ok(!f.exits.includes(ownerLossExit));
  });
}

test('expired and missing arm fail closed without claiming a validated fault grant', async () => {
  for (const mode of ['expired', 'missing']) {
    const f = fixture(); f.run(); f.initOptions.spawnWorkload(); f.started.resolve();
    await turn();
    if (mode === 'expired') { f.advance(90000); f.record.resolve(f.arm); }
    else f.record.reject(new Error('synthetic missing arm'));
    await turn(); assert.deepEqual(f.exits, [42]);
    assert.equal(f.waits.length, 1);
    if (mode === 'expired') assert.equal(f.waits[0].deadline.remaining('work'), 0);
    else assert.ok(!f.calls.includes('armValidated'));
  }
});

test('workload startup rejection fails closed without waiting for an arm', async () => {
  const f = fixture(); f.run(); f.initOptions.spawnWorkload();
  f.started.reject(new Error('synthetic startup failure')); await turn();
  assert.deepEqual(f.exits, [42]); assert.deepEqual(f.waits, []);
});

test('real arm consumption crossing the original deadline fails with 42, never owner-loss exit 43', async () => {
  const f = fixture();
  let consumed = 0;
  f.deps.waitRecord = (_exchange, name, deadline, phase) => waitConsumerLossRecord({
    read() { return f.arm; },
    consume() {
      f.exchangeOptions.records[0].validate(f.arm);
      consumed++; f.advance(90_000); return f.arm;
    },
  }, name, deadline, phase);
  f.run(); f.initOptions.spawnWorkload(); f.started.resolve();
  await turn();
  assert.equal(consumed, 1);
  assert.deepEqual(f.exits, [failureExit]);
  assert.ok(!f.exits.includes(ownerLossExit));
});

test('init adapter preserves synchronous failures without launching replacement work', () => {
  const f = fixture();
  f.deps.readConfig = () => { throw new Error('synthetic config failure'); };
  f.run(); assert.deepEqual(f.exits, [42]); assert.deepEqual(f.calls, []);
  assert.deepEqual(f.spawned, []);
});

// Uses the real strict exchange against the real service directory's mandatory
// names, with metadata supplied in memory. No Linux files or runtime are used.
test('owner fault init can reach real init delegation with service.json already in its service root', () => {
  const f = fixture();
  const directory = { dev: 2, ino: 3, uid: 1001, gid: 1002, mode: 0o40700,
    isDirectory: () => true, isSymbolicLink: () => false };
  const fs = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 131072, O_NONBLOCK: 2048 },
    realpathSync: path => path,
    lstatSync(path) {
      if (path === root) return directory;
      const common = { dev: 2, uid: 1001, gid: 1002, nlink: 1, mtimeMs: 1, ctimeMs: 1,
        isSymbolicLink: () => false };
      if (path === `${root}/service.json`) return { ...common, ino: 4, mode: 0o100600,
        size: 100, isFile: () => true };
      if (path === `${root}/control.sock`) return { ...common, ino: 5, mode: 0o140600,
        size: 0, isSocket: () => true, isFile: () => false };
      throw Object.assign(new Error('synthetic absent file'), { code: 'ENOENT' });
    },
    opendirSync(path) {
      assert.equal(path, root); let index = 0;
      const names = ['service.json', 'control.sock'];
      return { readSync: () => index < names.length ? { name: names[index++] } : null, closeSync() {} };
    },
  };
  f.deps.openExchange = options => openLinuxConsumerExchange(options, { fs, tempDirectory: () => '/synthetic-temp' });
  f.run();
  assert.deepEqual(f.exits, [], 'The owner fault must not fire before the real init and workload start');
  assert.ok(f.calls.includes('runInit'), 'The prepared service must reach the genuine init composition');
});

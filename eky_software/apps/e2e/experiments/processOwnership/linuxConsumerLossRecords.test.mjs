import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consumerLossRecords, ownerLossRecords, waitConsumerLossRecord,
} from './linuxConsumerLossRecords.mjs';
import { serviceDeadlines } from './linuxServiceContract.mjs';
import { managedUnitName } from './managedNamespaceUnitContract.mjs';

const generation = 'a'.repeat(32);
const otherGeneration = 'c'.repeat(32);
const unverified = { message: 'E2E_LINUX_CONSUMER_LOSS_UNVERIFIED' };
const receipt = Object.freeze({ generation, unit: managedUnitName(generation),
  invocation: 'b'.repeat(32), started: '1000000' });
const intent = Object.freeze({ generation, startUntil: '2000000', workUntil: '3000000' });
const readiness = Object.freeze({ testRoot: '/tmp/run-test', workerRoot: '/tmp/run-worker',
  admissionDirectory: '/tmp/run-admission' });
const cases = [
  ['backend-owner', ['backend'], ['backend'], 'owner'],
  ['backend-control', ['backend'], ['backend'], 'control'],
  ['vite-owner', ['chromium', 'backend', 'vite'], ['vite'], 'owner'],
  ['vite-control', ['chromium', 'backend', 'vite'], ['vite'], 'control'],
  ['chromium-owner', ['chromium', 'backend', 'vite'], ['chromium'], 'owner'],
  ['chromium-control', ['chromium', 'backend', 'vite'], ['chromium'], 'control'],
  ['caller', ['chromium', 'backend', 'vite'], ['chromium', 'backend', 'vite'], 'caller'],
];
const validator = (name, caseId = 'backend-owner') => {
  const record = consumerLossRecords(caseId).find(value => value.name === name);
  assert.ok(record, 'expected record in fixed case manifest');
  return record.validate;
};

for (const [caseId, profiles, affected, cause] of cases) {
  test(`${caseId} has exactly the frozen role-owned records for its actual services`, () => {
    const records = consumerLossRecords(caseId);
    const expected = profiles.flatMap(profile => [
      [`${profile}-intent.json`, 'caller'], [`${profile}-ack.json`, 'observer'],
      [`${profile}-owned.json`, 'caller'], [`${profile}-go.json`, 'observer'],
      ...(affected.includes(profile) ? [
        [`${profile}-armed.json`, 'caller'], [`${profile}-passive.json`, 'observer'],
      ] : []),
    ]);
    expected.push(['ready.json', 'caller'], ['grant.json', 'observer']);
    if (cause !== 'caller') expected.push(['result.json', 'caller']);
    assert.deepEqual(records.map(({ name, writer }) => [name, writer]), expected);
    assert.equal(new Set(records.map(value => value.name)).size, records.length);
    assert.ok(Object.isFrozen(records));
    for (const record of records) {
      assert.ok(Object.isFrozen(record));
      assert.deepEqual(Object.keys(record).sort(), ['name', 'validate', 'writer']);
      assert.equal(typeof record.validate, 'function');
    }
    for (const profile of profiles) {
      validator(`${profile}-intent.json`, caseId)(intent);
      validator(`${profile}-ack.json`, caseId)({ generation });
      for (const suffix of ['owned', 'go', ...(affected.includes(profile) ? ['passive'] : [])]) {
        validator(`${profile}-${suffix}.json`, caseId)(receipt);
      }
    }
    for (const profile of affected) {
      const validate = validator(`${profile}-armed.json`, caseId);
      const arm = { caseId, profile, generation, cause };
      validate(arm);
      for (const patch of [{ caseId: 'foreign' }, { profile: 'electron' },
        { cause: 'foreign' }, { generation: 'invalid' }, { extra: true }]) {
        assert.throws(() => validate({ ...arm, ...patch }), unverified);
      }
      for (const foreign of profiles.filter(value => !affected.includes(value))) {
        assert.throws(() => validate({ ...arm, profile: foreign }), unverified);
      }
    }
    const grant = validator('grant.json', caseId);
    grant({ caseId });
    for (const value of [{ caseId: 'foreign' }, { caseId, extra: true }, {}]) {
      assert.throws(() => grant(value), unverified);
    }
  });
}

test('unknown cases and owner profiles cannot create a manifest', () => {
  for (const value of [undefined, null, '', 'backend', 'backend-owner\n', {}, []]) {
    assert.throws(() => consumerLossRecords(value), unverified);
  }
  for (const profile of [undefined, null, '', 'caller', 'electron', 'backend-control']) {
    assert.throws(() => ownerLossRecords(profile, generation), unverified);
  }
});

test('intent deadlines use positive bounded decimal strings and preserve their ordering', () => {
  const validate = validator('backend-intent.json');
  validate({ ...intent, startUntil: '1', workUntil: '1' });
  validate({ ...intent, startUntil: '9007199254740992', workUntil: '9007199254740993' });
  validate({ ...intent, startUntil: '9'.repeat(24), workUntil: '9'.repeat(24) });
  assert.throws(() => validate({ ...intent, startUntil: '9007199254740993',
    workUntil: '9007199254740992' }), unverified);
  for (const field of ['startUntil', 'workUntil']) {
    for (const value of [0, 1, null, '', '0', '01', '-1', '+1', '1.0', '1e3', ' 1', '1 ', '9'.repeat(25)]) {
      assert.throws(() => validate({ ...intent, [field]: value }), unverified);
    }
  }
});

test('timestamp records reject trailing line terminators rather than letting BigInt trim them', () => {
  for (const suffix of ['\n', '\r', '\u2028', '\u2029']) {
    for (const field of ['startUntil', 'workUntil']) {
      assert.throws(() => validator('backend-intent.json')({ ...intent, [field]: intent[field] + suffix }),
        unverified);
    }
    assert.throws(() => validator('backend-owned.json')({ ...receipt, started: receipt.started + suffix }),
      unverified);
  }
});

test('acknowledgements and receipts require exact nonces and generation-derived unit names', () => {
  for (const value of ['', 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32), 'g'.repeat(32), 1, null]) {
    assert.throws(() => validator('backend-ack.json')({ generation: value }), unverified);
    assert.throws(() => validator('backend-intent.json')({ ...intent, generation: value }), unverified);
    for (const field of ['generation', 'invocation']) {
      assert.throws(() => validator('backend-owned.json')({ ...receipt, [field]: value }), unverified);
    }
  }
  for (const suffix of ['owned', 'go', 'passive']) {
    const validate = validator(`backend-${suffix}.json`);
    for (const patch of [{ generation: otherGeneration }, { unit: managedUnitName(otherGeneration) },
      { unit: receipt.unit + '\n' }, { unit: '/tmp/unit' }, { started: '0' }, { started: 1 },
      { started: '01' }, { started: '9'.repeat(25) }, { extra: true }]) {
      assert.throws(() => validate({ ...receipt, ...patch }), unverified);
    }
  }
});

test('receipt timestamps stay within the independent managed-unit receipt range', () => {
  for (const suffix of ['owned', 'go', 'passive']) {
    const validate = validator(`backend-${suffix}.json`);
    validate({ ...receipt, started: '18446744073709551615' });
    assert.throws(() => validate({ ...receipt, started: '18446744073709551616' }), unverified);
  }
});

test('all coordination record validators reject missing and extended shapes', () => {
  const examples = [
    ['backend-intent.json', intent], ['backend-ack.json', { generation }],
    ['backend-owned.json', receipt], ['backend-go.json', receipt], ['backend-passive.json', receipt],
    ['backend-armed.json', { caseId: 'backend-owner', profile: 'backend', generation, cause: 'owner' }],
    ['ready.json', { ...readiness, workerRoot: null, admissionDirectory: null }],
    ['grant.json', { caseId: 'backend-owner' }],
  ];
  for (const [name, value] of examples) {
    const validate = validator(name);
    for (const invalid of [undefined, null, [], {}, { ...value, extra: true },
      Object.assign(Object.create({ inherited: true }), value), { ...value, [Symbol('extra')]: true }]) {
      assert.throws(() => validate(invalid), unverified);
    }
    for (const key of Object.keys(value)) {
      const missing = { ...value }; delete missing[key];
      assert.throws(() => validate(missing), unverified);
      const hidden = Object.defineProperty({ ...value }, key, { enumerable: false });
      assert.throws(() => validate(hidden), unverified);
    }
  }
});

test('armed manifest validation does not invoke a supplied generation getter', () => {
  let getterCalls = 0;
  const value = Object.defineProperty({ caseId: 'backend-owner', profile: 'backend', cause: 'owner' },
    'generation', { enumerable: true, get() { getterCalls++; throw new Error('PRIVATE_GETTER'); } });
  assert.throws(() => validator('backend-armed.json')(value), unverified);
  assert.equal(getterCalls, 0);
});

test('backend readiness excludes browser ownership while web readiness requires distinct worker paths', () => {
  for (const [caseId, profiles] of cases) {
    const validate = validator('ready.json', caseId);
    if (profiles.length === 1) {
      validate({ ...readiness, workerRoot: null, admissionDirectory: null });
      assert.throws(() => validate(readiness), unverified);
      assert.throws(() => validate({ ...readiness, workerRoot: null }), unverified);
      assert.throws(() => validate({ ...readiness, admissionDirectory: null }), unverified);
    } else {
      validate(readiness);
      for (const value of [{ ...readiness, workerRoot: readiness.testRoot },
        { ...readiness, workerRoot: null }, { ...readiness, admissionDirectory: null }]) {
        assert.throws(() => validate(value));
      }
    }
  }
});

test('readiness paths are canonical bounded POSIX strings, not host-dependent paths', () => {
  const validate = validator('ready.json', 'caller');
  for (const field of Object.keys(readiness)) {
    for (const value of [undefined, null, 1, '', '/', 'relative', 'C:\\temp\\root',
      '/tmp/run/', '/tmp/../run', '/tmp/./run', '/tmp//run', '/tmp/run\n', '/tmp/run\0',
      '/tmp/run name', '/' + 'a'.repeat(2047)]) {
      assert.throws(() => validate({ ...readiness, [field]: value }));
    }
  }
});

test('owner-init manifests bind the exact owner case, profile and independently supplied generation', () => {
  for (const profile of ['backend', 'vite', 'chromium']) {
    const records = ownerLossRecords(profile, generation);
    assert.ok(Object.isFrozen(records) && Object.isFrozen(records[0]));
    assert.equal(records.length, 1);
    assert.equal(records[0].name, 'armed.json');
    assert.equal(records[0].writer, 'caller');
    const arm = { caseId: `${profile}-owner`, profile, generation, cause: 'owner' };
    records[0].validate(arm);
    for (const patch of [{ generation: otherGeneration }, { caseId: `${profile}-control` },
      { caseId: 'caller', cause: 'caller' }, { profile: 'foreign' }, { cause: 'control' }]) {
      assert.throws(() => records[0].validate({ ...arm, ...patch }), unverified);
    }
  }
  for (const value of [undefined, null, '', 'a'.repeat(31), 'A'.repeat(32)]) {
    assert.throws(() => ownerLossRecords('backend', value), unverified);
  }
});

function clock(t) {
  let milliseconds = 0;
  let serial = 0;
  const timers = new Map();
  const scheduled = [];
  const deadline = serviceDeadlines({ startUntil: '60000001', workUntil: '90000001' },
    () => 1n + BigInt(milliseconds) * 1_000_000n);
  const time = {
    setTimeout(run, delay) {
      scheduled.push({ delay, until: milliseconds + delay });
      timers.set(++serial, { run, until: milliseconds + delay });
      return serial;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  t.after(() => assert.equal(timers.size, 0, 'all wait timers settled'));
  return { deadline, time, scheduled,
    set(value) { milliseconds = value; },
    async advance(value) {
      milliseconds += value;
      for (const [id, timer] of [...timers]) {
        if (timer.until <= milliseconds && timers.delete(id)) timer.run();
      }
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const expired = error => ['deadlineExceeded', 'startupDeadlineExceeded'].includes(error.reason);

test('an available record is consumed exactly once and the consume result is returned unchanged', async t => {
  const f = clock(t);
  const calls = [];
  const consumed = Object.freeze({ ...receipt });
  const exchange = {
    read(name) { calls.push(['read', name]); return receipt; },
    consume(name) { calls.push(['consume', name]); return consumed; },
  };
  assert.equal(await waitConsumerLossRecord(exchange, 'backend-go.json', f.deadline, 'ready', f.time), consumed);
  assert.deepEqual(calls, [['read', 'backend-go.json'], ['consume', 'backend-go.json']]);
  assert.deepEqual(f.scheduled, []);
});

test('missing records poll the same name and consume the first publication without resetting the deadline', async t => {
  const f = clock(t);
  let published;
  const reads = [];
  const consumes = [];
  const exchange = {
    read(name) { reads.push(name); return published; },
    consume(name) { consumes.push(name); return published; },
  };
  const pending = waitConsumerLossRecord(exchange, 'backend-go.json', f.deadline, 'ready', f.time);
  assert.deepEqual(consumes, []);
  await f.advance(25);
  assert.deepEqual(consumes, []);
  published = receipt;
  await f.advance(25);
  assert.equal(await pending, receipt);
  assert.deepEqual(reads, Array(3).fill('backend-go.json'));
  assert.deepEqual(consumes, ['backend-go.json']);
  assert.equal(f.deadline.remaining('ready'), 10);
  assert.deepEqual(f.scheduled.map(value => value.delay), [25, 60, 25, 35]);
});

test('a missing record expires at the original ready deadline with no consumption', async t => {
  const f = clock(t);
  let reads = 0;
  const pending = assert.rejects(waitConsumerLossRecord({
    read() { reads++; return undefined; }, consume() { assert.fail('missing record consumed'); },
  }, 'backend-go.json', f.deadline, 'ready', f.time), expired);
  await f.advance(25);
  await f.advance(25);
  await f.advance(10);
  await pending;
  assert.equal(reads, 3);
  assert.deepEqual(f.scheduled.map(value => value.delay), [25, 60, 25, 35, 10, 10]);
  assert.ok(f.scheduled.every(value => value.until <= 60));
});

test('a passive wait cannot renew the existing three-second cleanup deadline', async t => {
  const f = clock(t);
  f.deadline.beginCleanup();
  f.set(2980);
  const pending = assert.rejects(waitConsumerLossRecord({
    read() { return undefined; }, consume() { assert.fail('missing passive proof consumed'); },
  }, 'backend-passive.json', f.deadline, 'wrapper', f.time), expired);
  assert.deepEqual(f.scheduled.map(value => value.delay), [20, 20]);
  await f.advance(20);
  await pending;
  assert.equal(f.deadline.remaining('wrapper'), 0);
});

for (const stage of ['read', 'consume']) {
  test(`invalid or stale ${stage} failure is preserved without retry or another consume`, async t => {
    const f = clock(t);
    const failure = new Error('E2E_LINUX_CONSUMER_EXCHANGE_UNVERIFIED');
    const calls = [];
    const exchange = {
      read() { calls.push('read'); if (stage === 'read') throw failure; return receipt; },
      consume() { calls.push('consume'); throw failure; },
    };
    await assert.rejects(waitConsumerLossRecord(exchange, 'backend-go.json', f.deadline, 'ready', f.time),
      error => error === failure);
    assert.deepEqual(calls, stage === 'read' ? ['read'] : ['read', 'consume']);
    assert.deepEqual(f.scheduled, []);
  });
}

test('a second wait cannot turn an already consumed record into another grant', async t => {
  const f = clock(t);
  let consumed = false;
  let consumeCalls = 0;
  const exchange = {
    read: () => receipt,
    consume() {
      consumeCalls++;
      if (consumed) throw new Error('E2E_LINUX_CONSUMER_EXCHANGE_UNVERIFIED');
      consumed = true;
      return receipt;
    },
  };
  await waitConsumerLossRecord(exchange, 'backend-go.json', f.deadline, 'ready', f.time);
  await assert.rejects(waitConsumerLossRecord(exchange, 'backend-go.json', f.deadline, 'ready', f.time),
    { message: 'E2E_LINUX_CONSUMER_EXCHANGE_UNVERIFIED' });
  assert.equal(consumeCalls, 2);
  assert.deepEqual(f.scheduled, []);
});

test('an expired wait does not read or consume even an available record', async t => {
  const f = clock(t);
  f.set(60);
  await assert.rejects(waitConsumerLossRecord({
    read() { assert.fail('read after deadline'); }, consume() { assert.fail('consume after deadline'); },
  }, 'backend-go.json', f.deadline, 'ready', f.time), expired);
  assert.deepEqual(f.scheduled, []);
});

test('a read completing at the deadline cannot proceed to consume', async t => {
  const f = clock(t);
  await assert.rejects(waitConsumerLossRecord({
    read() { f.set(60); return receipt; }, consume() { assert.fail('late read consumed'); },
  }, 'backend-go.json', f.deadline, 'ready', f.time), expired);
  assert.deepEqual(f.scheduled, []);
});

test('a consume completing at the deadline cannot return a successful grant', async t => {
  const f = clock(t);
  let consumed = 0;
  await assert.rejects(waitConsumerLossRecord({
    read: () => receipt,
    consume() { consumed++; f.set(60); return receipt; },
  }, 'backend-go.json', f.deadline, 'ready', f.time), expired);
  assert.equal(consumed, 1);
  assert.deepEqual(f.scheduled, []);
});

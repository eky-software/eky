import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConsumerLossOutcome } from './linuxConsumerLossOutcome.mjs';
import { consumerLossRecords } from './linuxConsumerLossRecords.mjs';

const unverified = { message: 'E2E_LINUX_CONSUMER_LOSS_UNVERIFIED' };
const cases = ['backend-owner', 'backend-control', 'vite-owner', 'vite-control',
  'chromium-owner', 'chromium-control'];

function outcome(caseId, context = 'completed') {
  const backendOnly = caseId.startsWith('backend-');
  const vite = caseId.startsWith('vite-');
  return {
    caseId, bodyPreserved: true, passive: true, commandsClosed: true,
    refusal: backendOnly ? 'backendRestart' : vite ? 'cachedViteStop' : 'chromiumReplacement',
    launches: backendOnly ? { backend: 1 } : { chromium: 1, backend: 1, vite: 1 },
    fixtureCleanup: {
      context: backendOnly ? 'notStarted' : context,
      api: 'completed', web: backendOnly ? 'notStarted' : vite ? 'failed' : 'completed',
      backend: backendOnly ? 'failed' : 'completed',
      webPort: backendOnly ? 'notStarted' : 'completed', backendPort: 'completed', artifacts: 'completed',
      priorCleanup: backendOnly ? 'unverified' : 'verified',
      runRoot: backendOnly || vite || context === 'failed' ? 'retained' : 'removed',
    },
    workerCleanup: backendOnly ? null : {
      schemaVersion: 1, operation: 'chromiumWorker', phase: 'workerTeardown', ownerFailure: null,
      cleanup: vite ? 'verified' : 'unverified', workerRoot: vite ? 'removed' : 'retained',
    },
  };
}

for (const caseId of cases) {
  test(`${caseId} accepts only its exact actual-cleanup summary and manifest binding`, () => {
    const value = outcome(caseId);
    assert.equal(validateConsumerLossOutcome(value, caseId), value);
    const record = consumerLossRecords(caseId).find(record => record.name === 'result.json');
    assert.equal(record.writer, 'caller');
    assert.doesNotThrow(() => record.validate(value));
    for (const foreign of cases.filter(other => other !== caseId)) {
      assert.throws(() => record.validate({ ...value, caseId: foreign }), unverified);
    }
    assert.throws(() => record.validate({ ...value, privateError: '/private/synthetic-path' }), unverified);
  });

  test(`${caseId} refuses lost body errors, intervention-only proof and unclosed commands`, () => {
    for (const key of ['bodyPreserved', 'passive', 'commandsClosed']) {
      for (const invalid of [false, null, undefined, 'true', 1]) {
        assert.throws(() => validateConsumerLossOutcome({ ...outcome(caseId), [key]: invalid }, caseId),
          unverified);
      }
    }
    for (const refusal of ['none', null, 'restart', 'replacementAllowed']) {
      assert.throws(() => validateConsumerLossOutcome({ ...outcome(caseId), refusal }, caseId), unverified);
    }
  });

  test(`${caseId} requires exactly one launch of each genuine service and no extra service`, () => {
    const valid = outcome(caseId);
    for (const profile of Object.keys(valid.launches)) {
      for (const count of [0, 2, -1, 1.5, '1', null, undefined]) {
        const value = structuredClone(valid);
        value.launches[profile] = count;
        assert.throws(() => validateConsumerLossOutcome(value, caseId), unverified);
      }
      const value = structuredClone(valid);
      delete value.launches[profile];
      assert.throws(() => validateConsumerLossOutcome(value, caseId), unverified);
    }
    assert.throws(() => validateConsumerLossOutcome({ ...valid,
      launches: { ...valid.launches, electron: 1 } }, caseId), unverified);
    if (caseId.startsWith('backend-')) {
      assert.throws(() => validateConsumerLossOutcome({ ...valid,
        launches: { ...valid.launches, chromium: 1, vite: 1 } }, caseId), unverified);
    }
  });
}

test('caller loss cannot manufacture a post-exit successful cleanup result', () => {
  assert.ok(!consumerLossRecords('caller').some(record => record.name === 'result.json'));
  assert.throws(() => validateConsumerLossOutcome({ ...outcome('chromium-owner'), caseId: 'caller' }, 'caller'),
    unverified);
  for (const caseId of [undefined, null, '', 'foreign', 'backend-owner\n']) {
    assert.throws(() => validateConsumerLossOutcome(outcome('backend-owner'), caseId), unverified);
  }
});

test('all outcome layers are closed data records without getters, coercion or private fields', () => {
  let getterCalls = 0;
  for (const section of [null, 'launches', 'fixtureCleanup', 'workerCleanup']) {
    const valid = outcome('chromium-owner');
    const record = section === null ? valid : valid[section];
    const withRecord = replacement => section === null ? replacement : { ...valid, [section]: replacement };
    for (const invalid of [undefined, null, [], {}, { ...record, privateError: '/private/synthetic-path' },
      { ...record, [Symbol('extra')]: true }, Object.assign(Object.create({ inherited: true }), record)]) {
      assert.throws(() => validateConsumerLossOutcome(withRecord(invalid), valid.caseId), unverified);
    }
    for (const key of Object.keys(record)) {
      const missing = { ...record }; delete missing[key];
      assert.throws(() => validateConsumerLossOutcome(withRecord(missing), valid.caseId), unverified);
      const accessor = Object.defineProperty({ ...record }, key, { enumerable: true,
        get() { getterCalls++; throw new Error('PRIVATE_GETTER'); } });
      assert.throws(() => validateConsumerLossOutcome(withRecord(accessor), valid.caseId), unverified);
    }
  }
  assert.equal(getterCalls, 0);
});

test('backend restart failure retains the test root and prior uncertainty without starting browser services', () => {
  for (const caseId of ['backend-owner', 'backend-control']) {
    const valid = outcome(caseId);
    for (const patch of [{ backend: 'completed' }, { backend: 'notStarted' }, { backendPort: 'failed' },
      { priorCleanup: 'verified' }, { runRoot: 'removed' }, { context: 'completed' },
      { web: 'completed' }, { webPort: 'completed' }]) {
      assert.throws(() => validateConsumerLossOutcome({ ...valid,
        fixtureCleanup: { ...valid.fixtureCleanup, ...patch } }, caseId), unverified);
    }
    assert.throws(() => validateConsumerLossOutcome({ ...valid,
      workerCleanup: outcome('vite-owner').workerCleanup }, caseId), unverified);
    assert.throws(() => validateConsumerLossOutcome({ ...valid, refusal: 'cachedViteStop' }, caseId), unverified);
  }
});

test('Vite sticky stop retains the affected test root while healthy browser cleanup can succeed', () => {
  for (const caseId of ['vite-owner', 'vite-control']) {
    const valid = outcome(caseId);
    for (const patch of [{ web: 'completed' }, { runRoot: 'removed' }, { context: 'failed' }]) {
      assert.throws(() => validateConsumerLossOutcome({ ...valid,
        fixtureCleanup: { ...valid.fixtureCleanup, ...patch } }, caseId), unverified);
    }
    for (const patch of [{ cleanup: 'unverified' }, { workerRoot: 'retained' }]) {
      assert.throws(() => validateConsumerLossOutcome({ ...valid,
        workerCleanup: { ...valid.workerCleanup, ...patch } }, caseId), unverified);
    }
    assert.throws(() => validateConsumerLossOutcome({ ...valid, refusal: 'backendRestart' }, caseId), unverified);
  }
});

test('Chromium loss always retains its worker but test-root retention follows actual context close', () => {
  for (const caseId of ['chromium-owner', 'chromium-control']) {
    for (const context of ['completed', 'failed']) {
      const valid = outcome(caseId, context);
      assert.equal(validateConsumerLossOutcome(valid, caseId), valid);
      assert.equal(valid.fixtureCleanup.runRoot, context === 'completed' ? 'removed' : 'retained');
      const opposite = context === 'completed' ? 'retained' : 'removed';
      assert.throws(() => validateConsumerLossOutcome({ ...valid,
        fixtureCleanup: { ...valid.fixtureCleanup, runRoot: opposite } }, caseId), unverified);
      for (const patch of [{ cleanup: 'verified' }, { workerRoot: 'removed' }]) {
        assert.throws(() => validateConsumerLossOutcome({ ...valid,
          workerCleanup: { ...valid.workerCleanup, ...patch } }, caseId), unverified);
      }
    }
    const valid = outcome(caseId);
    for (const patch of [{ context: 'notStarted' }, { web: 'failed' }, { web: 'notStarted' }]) {
      assert.throws(() => validateConsumerLossOutcome({ ...valid,
        fixtureCleanup: { ...valid.fixtureCleanup, ...patch } }, caseId), unverified);
    }
    assert.throws(() => validateConsumerLossOutcome({ ...valid, refusal: 'cachedViteStop' }, caseId), unverified);
  }
});

test('healthy-service, API, port and artifact failures cannot be passed off as the intended fault result', () => {
  for (const caseId of cases) {
    const valid = outcome(caseId);
    const fields = ['api', 'artifacts', 'backendPort',
      ...(caseId.startsWith('backend-') ? [] : ['backend', 'webPort'])];
    for (const key of fields) {
      for (const status of ['notStarted', 'failed', 'unknown']) {
        assert.throws(() => validateConsumerLossOutcome({ ...valid,
          fixtureCleanup: { ...valid.fixtureCleanup, [key]: status } }, caseId), unverified);
      }
    }
    if (!caseId.startsWith('backend-')) {
      assert.throws(() => validateConsumerLossOutcome({ ...valid,
        fixtureCleanup: { ...valid.fixtureCleanup, priorCleanup: 'unverified' } }, caseId), unverified);
      for (const patch of [{ schemaVersion: 2 }, { operation: 'foreign' }, { phase: 'startup' },
        { ownerFailure: 'PRIVATE_FAILURE' }]) {
        assert.throws(() => validateConsumerLossOutcome({ ...valid,
          workerCleanup: { ...valid.workerCleanup, ...patch } }, caseId), unverified);
      }
    }
  }
});

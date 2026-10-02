import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../../desktop/e2e/electronE2eBackendFailureCatalog.json' with { type: 'json' };
import { projectElectronLifecycle, projectElectronEvidenceFailures, recordElectronEvidenceFailure } from './electronLifecycleProjection.mjs';

const secret = 'synthetic-private-path-session-and-message';
function evidence() {
  return {
    schemaVersion: 1, attempt: 2, observationsTruncated: false,
    cleanup: { api: 'completed', runtime: 'completed', port: 'released', runRoot: 'removed' },
    firstLaunchFailure: { startupGeneration: 3, phase: 'firstWindow', reason: 'processExited' },
    nativeStartupFailure: {
      status: 'captured', startupFailureCodes: [catalog.stageCodes.backendStart],
      backendFailure: { backendAttempt: 1, status: { type: 'failed', stage: 'backendStart',
        reason: 'SQLITE_CANTOPEN', brokerCleanupFailures: ['secretBroker'] } },
    },
    launchExitCode: 1,
  };
}
function result(value = evidence()) {
  return { retry: 2, attachments: [{ name: 'electron-lifecycle', contentType: 'application/json',
    body: Buffer.from(JSON.stringify(value)) }] };
}

test('projects exact source reason, attempt, generation, exit and cleanup independently', () => {
  const value = evidence();
  Object.assign(value, { path: secret, stack: secret, companyId: secret, launch: [{ secret }] });
  const actual = projectElectronLifecycle(result(value));
  assert.deepEqual(actual, {
    status: 'captured', attempt: 2, startupGeneration: 3, launchPhase: 'firstWindow', nativeCapture: 'captured',
    backendFailure: { backendAttempt: 1, stage: 'backendStart', reason: 'SQLITE_CANTOPEN',
      brokerCleanupFailures: ['secretBroker'] },
    launchExitCode: 1, observationsTruncated: false,
    cleanup: { api: 'completed', runtime: 'completed', port: 'released', runRoot: 'removed' },
  });
  assert.equal(JSON.stringify(actual).includes(secret), false);
});

test('uses every source catalog stage and reason, including unknown, without a second catalog', () => {
  for (const stage of Object.keys(catalog.stageCodes)) for (const reason of Object.keys(catalog.reasons)) {
    const value = evidence();
    Object.assign(value.nativeStartupFailure.backendFailure.status, { stage, reason });
    value.nativeStartupFailure.startupFailureCodes = [catalog.stageCodes[stage]];
    const actual = projectElectronLifecycle(result(value));
    assert.equal(actual.backendFailure.stage, stage);
    assert.equal(actual.backendFailure.reason, reason);
  }
});

test('accepts the matching stage in a sorted code set without treating its order as chronology', () => {
  const value = evidence();
  value.nativeStartupFailure.startupFailureCodes = [
    catalog.stageCodes.backendStart, 'BACKEND_EXITED_BEFORE_READY',
  ].sort();
  assert.notEqual(value.nativeStartupFailure.startupFailureCodes[0], catalog.stageCodes.backendStart);
  assert.deepEqual(projectElectronLifecycle(result(value)), projectElectronLifecycle(result()));
});

test('rejects mismatched attempt, stage codes or unknown fields inside the status', () => {
  for (const mutate of [
    v => { v.attempt = 1; },
    v => { v.attempt = -1; },
    v => { v.schemaVersion = 2; },
    v => { v.firstLaunchFailure.startupGeneration = 0; },
    v => { v.firstLaunchFailure.startupGeneration = 1.1; },
    v => { v.firstLaunchFailure.phase = secret; },
    v => { delete v.nativeStartupFailure.startupFailureCodes; },
    v => { v.nativeStartupFailure.startupFailureCodes = catalog.stageCodes.backendStart; },
    v => { v.nativeStartupFailure.startupFailureCodes = []; },
    v => { v.nativeStartupFailure.startupFailureCodes = [catalog.stageCodes.moduleImport]; },
    v => { v.nativeStartupFailure.backendFailure.status.extra = secret; },
    v => { v.nativeStartupFailure.backendFailure.backendAttempt = -1; },
    v => { v.nativeStartupFailure.backendFailure.status.reason = secret; },
    v => { v.nativeStartupFailure.backendFailure.status.reason = ['EIO']; },
    v => { v.nativeStartupFailure.backendFailure.status.stage = ['backendStart']; },
    v => { v.nativeStartupFailure.backendFailure.status.brokerCleanupFailures = [secret]; },
    v => { v.nativeStartupFailure.backendFailure.status.brokerCleanupFailures = [['secretBroker']]; },
    v => { v.nativeStartupFailure.backendFailure.status.brokerCleanupFailures = ['secretBroker', 'secretBroker']; },
    v => { v.nativeStartupFailure.backendFailure.status.brokerCleanupFailures = [null]; },
    v => { v.nativeStartupFailure.status = 'missing'; },
    v => { v.cleanup.runtime = secret; },
    v => { v.cleanup.path = secret; },
    v => { v.launchExitCode = 2 ** 32; },
    v => { v.observationsTruncated = secret; },
  ]) {
    const value = evidence();
    mutate(value);
    assert.deepEqual(projectElectronLifecycle(result(value)), { status: 'invalid' });
  }
});

test('preserves missing, partial and successful observations without inventing a source cause', () => {
  for (const status of ['notRequested', 'missing', 'invalid', 'tooLarge', 'sourceChanged', 'readFailed', 'captured']) {
    const value = evidence();
    value.nativeStartupFailure = { status };
    value.firstLaunchFailure = null;
    value.launchExitCode = null;
    value.observationsTruncated = true;
    value.cleanup = { api: 'failed', runtime: 'unverified', port: 'unverified', runRoot: 'retained' };
    const actual = projectElectronLifecycle(result(value));
    assert.equal(actual.nativeCapture, status);
    assert.equal(actual.backendFailure, null);
    assert.equal(actual.startupGeneration, null);
    assert.equal(actual.launchExitCode, null);
    assert.equal(actual.observationsTruncated, true);
    assert.equal(actual.cleanup.runRoot, 'retained');
  }
});

test('refuses paths, duplicate attachments, invalid JSON, wrong media and oversized bodies', () => {
  assert.deepEqual(projectElectronLifecycle({ attachments: [] }), { status: 'notAttached' });
  assert.deepEqual(projectElectronLifecycle({ attachments: [{ name: 'private', body: secret }] }), { status: 'notAttached' });
  for (const [change, status] of [
    [a => { delete a.body; a.path = secret; }, 'unavailable'],
    [a => { a.contentType = 'text/plain'; }, 'unavailable'],
    [a => { a.body = secret; }, 'unavailable'],
    [a => { a.body = Buffer.alloc(256 * 1024 + 1); }, 'tooLarge'],
    [a => { a.body = Buffer.from('{broken'); }, 'invalid'],
  ]) {
    const value = result();
    change(value.attachments[0]);
    assert.deepEqual(projectElectronLifecycle(value), { status });
  }
  const duplicate = result();
  duplicate.attachments.push(duplicate.attachments[0]);
  assert.deepEqual(projectElectronLifecycle(duplicate), { status: 'invalid' });
});

test('secondary report failures use closed per-attempt metadata, never a raw exception', () => {
  const info = { annotations: [{ type: 'private', description: secret }] };
  for (const kind of ['captureFailed', 'reportFailed', 'fileWriteFailed', 'attachmentFailed']) {
    recordElectronEvidenceFailure(info, kind);
    recordElectronEvidenceFailure(info, kind);
  }
  recordElectronEvidenceFailure(info, secret);
  assert.equal(info.annotations.length, 5);
  assert.deepEqual(projectElectronEvidenceFailures(info),
    ['captureFailed', 'reportFailed', 'fileWriteFailed', 'attachmentFailed']);
  assert.deepEqual(projectElectronEvidenceFailures({ annotations: [] }), []);
  assert.doesNotThrow(() => recordElectronEvidenceFailure(Object.freeze({ annotations: Object.freeze([]) }), 'reportFailed'));
});

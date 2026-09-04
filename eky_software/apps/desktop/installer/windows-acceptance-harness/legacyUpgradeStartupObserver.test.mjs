import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  captureDesktopLifecycleBaseline,
  requireTargetShutdownCompleted,
  waitForTargetDesktopStarted,
} from './legacyUpgradeStartupObserver.mjs';

const APP = Object.freeze({ appVersion: '0.2.7', buildRevision: 'a'.repeat(40) });
const RUNTIME = '12345678-1234-4abc-8abc-1234567890ab';

function event(eventName, eventId, overrides = {}) {
  const failure = eventName === 'desktop.bootstrapFailed';
  return {
    schemaVersion: 1,
    component: 'desktop',
    category: 'runtime',
    level: failure ? 'error' : 'info',
    outcome: failure ? 'failure' : 'success',
    eventName,
    eventId,
    runtimeInstanceId: RUNTIME,
    timestamp: '2026-09-04T08:00:00.000Z',
    appVersion: APP.appVersion,
    buildRevision: APP.buildRevision.slice(0, 12),
    ...overrides,
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-observer-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const logs = resolve(root, 'desktop');
  await mkdir(logs);
  const info = resolve(logs, 'desktop-info-2026-09-001.jsonl');
  const warning = resolve(logs, 'desktop-warning-error-2026-09-001.jsonl');
  await appendFile(
    info,
    `${JSON.stringify(event('desktop.started', '22345678-1234-4abc-8abc-1234567890ab', { runtimeInstanceId: '32345678-1234-4abc-8abc-1234567890ab' }))}\n`,
  );
  await appendFile(warning, '');
  return { info, logs, warning };
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

test('startup observer resolves from a new matching event without polling', async (t) => {
  const files = await fixture(t);
  const baseline = await captureDesktopLifecycleBaseline(files.logs);
  const child = deferred();
  const waiting = waitForTargetDesktopStarted({
    baselineEventIds: baseline,
    childCompletion: child.promise,
    expectedIdentity: APP,
    logDirectory: files.logs,
  });
  await appendFile(
    files.info,
    `${JSON.stringify(event('desktop.started', '42345678-1234-4abc-8abc-1234567890ab'))}\n`,
  );
  const started = await waiting;
  assert.equal(started.runtimeInstanceId, RUNTIME);
});

test('startup observer fails closed on a matching bootstrap failure', async (t) => {
  const files = await fixture(t);
  const child = deferred();
  const waiting = waitForTargetDesktopStarted({
    baselineEventIds: await captureDesktopLifecycleBaseline(files.logs),
    childCompletion: child.promise,
    expectedIdentity: APP,
    logDirectory: files.logs,
  });
  await appendFile(
    files.warning,
    `${JSON.stringify(event('desktop.bootstrapFailed', '52345678-1234-4abc-8abc-1234567890ab'))}\n`,
  );
  await assert.rejects(waiting, /targetBootstrapFailed/);
});

test('startup observer rejects a process exit without readiness', async (t) => {
  const files = await fixture(t);
  const child = deferred();
  const waiting = waitForTargetDesktopStarted({
    baselineEventIds: await captureDesktopLifecycleBaseline(files.logs),
    childCompletion: child.promise,
    expectedIdentity: APP,
    logDirectory: files.logs,
  });
  child.resolve({ exitCode: 1 });
  await assert.rejects(waiting, /targetApplicationExitedEarly/);
});

test('shutdown proof is bound to the same runtime generation', async (t) => {
  const files = await fixture(t);
  const baseline = await captureDesktopLifecycleBaseline(files.logs);
  await appendFile(
    files.info,
    `${JSON.stringify(event('desktop.started', '62345678-1234-4abc-8abc-1234567890ab'))}\n${JSON.stringify(event('desktop.shutdownCompleted', '72345678-1234-4abc-8abc-1234567890ab'))}\n`,
  );
  await assert.doesNotReject(
    requireTargetShutdownCompleted({
      baselineEventIds: baseline,
      expectedIdentity: APP,
      logDirectory: files.logs,
      runtimeInstanceId: RUNTIME,
    }),
  );
});

import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { readWindowsShortPathFixture } from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';

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

async function fixture(t, automaticCleanup = true) {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-observer-'));
  if (automaticCleanup) {
    t.after(() => rm(root, { force: true, recursive: true }));
  }
  const logs = resolve(root, 'desktop');
  await mkdir(logs);
  const info = resolve(logs, 'desktop-info-2026-09-001.jsonl');
  const warning = resolve(logs, 'desktop-warning-error-2026-09-001.jsonl');
  await appendFile(
    info,
    `${JSON.stringify(event('desktop.started', '22345678-1234-4abc-8abc-1234567890ab', { runtimeInstanceId: '32345678-1234-4abc-8abc-1234567890ab' }))}\n`,
  );
  await appendFile(warning, '');
  return { info, logs, root, warning };
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

test('startup observer accepts the same directory through a Windows 8.3 alias', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const files = await fixture(t, false);
  let verified = false;
  t.after(() => verified ? rm(files.root, { force: true, recursive: true }) : undefined);
  const shortRoot = await readWindowsShortPathFixture(files.root, { directory: files.root });
  assert.notEqual(shortRoot, files.root, 'The fixture must exercise a real 8.3 alias');
  assert.match(shortRoot, /~[0-9]/);
  assert.equal(await realpath(shortRoot), await realpath(files.root));
  const child = deferred();
  const waiting = waitForTargetDesktopStarted({
    baselineEventIds: await captureDesktopLifecycleBaseline(files.logs),
    childCompletion: child.promise,
    expectedIdentity: APP,
    logDirectory: resolve(shortRoot, 'desktop'),
  });
  await appendFile(
    files.info,
    `${JSON.stringify(event('desktop.started', '42345678-1234-4abc-8abc-1234567890ab'))}\n`,
  );
  assert.equal((await waiting).runtimeInstanceId, RUNTIME);
  verified = true;
});

test('startup observer still rejects a directory link before watching its target', async (t) => {
  const files = await fixture(t);
  const linked = resolve(files.root, 'linked');
  await symlink(files.logs, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(waitForTargetDesktopStarted({
    baselineEventIds: [],
    childCompletion: deferred().promise,
    expectedIdentity: APP,
    logDirectory: linked,
  }), /targetOperationalLogInvalid/);
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

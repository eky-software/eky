import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinateRunningApplicationUpgrade } from './upgradeRunningApplication.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(mode = 'validation') {
  const events = [], validation = deferred(), applicationExit = deferred(), msiExit = deferred();
  let applicationRunning = true, observerOpen = false;
  const ports = {
    async startApplication() {
      events.push('applicationStarted');
      return {
        ready: Promise.resolve().then(() => {
          events.push('applicationReady');
          if (mode === 'startupFailed') throw new Error('runningUpgradeApplicationFailed');
        }),
        completion: applicationExit.promise,
        isRunning: () => applicationRunning,
        async close() {
          events.push('applicationClose');
          if (mode === 'cleanupFailed') throw new Error('private close failure');
          applicationRunning = false;
          applicationExit.resolve({ exitCode: 0 });
          if (!['blocked', 'invalidExit'].includes(mode)) msiExit.resolve({ exitCode: 0 });
        },
        async verifyShutdown() { events.push('shutdownVerified'); },
      };
    },
    async createValidationObserver() {
      observerOpen = true;
      return { completion: validation.promise, async close() { observerOpen = false; events.push('observerClosed'); } };
    },
    async startUpgrade() {
      assert.equal(applicationRunning, true);
      assert.ok(events.includes('applicationReady'));
      events.push('installerStarted');
      if (mode === 'blocked') msiExit.resolve({ exitCode: 1603 });
      else if (mode === 'invalidExit') msiExit.resolve({ exitCode: 3010 });
      else if (['observerFailed', 'cleanupFailed'].includes(mode)) {
        validation.reject(new Error('runningUpgradeValidationInvalid'));
        msiExit.resolve({ exitCode: 1603 });
      } else { events.push('validationObserved'); validation.resolve(); }
      return { completion: msiExit.promise };
    },
    async verifyBlockedSource() {
      assert.equal(applicationRunning, false);
      events.push('sourceVerified');
    },
    async resumeUpgrade() { events.push('upgradeAfterClose'); return 0; },
  };
  return { ports, events, resources: () => ({ applicationRunning, observerOpen }) };
}

test('MSI validation, not a fixed delay, releases a ready application before terminal acceptance', async () => {
  const f = fixture();
  const result = await coordinateRunningApplicationUpgrade(f.ports);
  assert.deepEqual(result, { status: 'completed', errorCode: null, cleanupResultCode: 'completed',
    exitCode: 0, boundary: 'validationObserved' });
  assert.deepEqual(f.events, ['applicationStarted', 'applicationReady', 'installerStarted',
    'validationObserved', 'applicationClose', 'shutdownVerified', 'observerClosed']);
  assert.deepEqual(f.resources(), { applicationRunning: false, observerOpen: false });
});

test('blocked Setup resumes once only after graceful exit and unchanged source proof', async () => {
  const f = fixture('blocked');
  const result = await coordinateRunningApplicationUpgrade(f.ports);
  assert.equal(result.status, 'completed');
  assert.equal(result.boundary, 'blockedSourcePreserved');
  assert.ok(f.events.indexOf('sourceVerified') > f.events.indexOf('shutdownVerified'));
  assert.equal(f.events.filter((event) => event === 'upgradeAfterClose').length, 1);
});

test('failed unchanged-source proof never resumes the blocked installer', async () => {
  const f = fixture('blocked');
  f.ports.verifyBlockedSource = async () => { throw new Error('runningUpgradeBlockedSourceChanged'); };
  const result = await coordinateRunningApplicationUpgrade(f.ports);
  assert.equal(result.errorCode, 'runningUpgradeBlockedSourceChanged');
  assert.equal(result.cleanupResultCode, 'completed');
  assert.equal(f.events.includes('upgradeAfterClose'), false);
});

test('failed application startup never starts MSI but still closes the owned application', async () => {
  const f = fixture('startupFailed');
  const result = await coordinateRunningApplicationUpgrade(f.ports);
  assert.equal(result.errorCode, 'runningUpgradeApplicationFailed');
  assert.equal(f.events.includes('installerStarted'), false);
  assert.deepEqual(f.resources(), { applicationRunning: false, observerOpen: false });
});

test('unknown or reboot-required MSI failure cannot become a blocked-Setup retry', async () => {
  const f = fixture('invalidExit');
  const result = await coordinateRunningApplicationUpgrade(f.ports);
  assert.equal(result.errorCode, 'runningUpgradeMsiFailed');
  assert.equal(f.events.includes('upgradeAfterClose'), false);
  assert.deepEqual(f.resources(), { applicationRunning: false, observerOpen: false });
});

for (const mode of ['observerFailed', 'cleanupFailed']) {
  test(`${mode} keeps the original error separate from resource cleanup`, async () => {
    const f = fixture(mode);
    const result = await coordinateRunningApplicationUpgrade(f.ports);
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'runningUpgradeValidationInvalid');
    assert.equal(result.cleanupResultCode, mode === 'cleanupFailed' ? 'cleanupUnverified' : 'completed');
    assert.deepEqual(f.resources(), { applicationRunning: mode === 'cleanupFailed', observerOpen: false });
    assert.equal(f.events.includes('upgradeAfterClose'), false);
    assert.equal(f.events.filter((event) => event === 'applicationClose').length, 1);
  });
}

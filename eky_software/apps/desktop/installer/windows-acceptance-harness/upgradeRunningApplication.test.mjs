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
  validation.promise.catch(() => undefined);
  let applicationRunning = true;
  const nativeResult = (exitCode) => ({ exitCode, protocolValid: true,
    validationObserved: !['observerFailed', 'cleanupFailed'].includes(mode), callbackValid: mode !== 'wrongEvent' });
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
          if (['cleanupFailed', 'shutdownFailed'].includes(mode)) throw new Error('private close failure');
          applicationRunning = false;
          applicationExit.resolve({ exitCode: 0 });
          msiExit.resolve(nativeResult(0));
        },
        async verifyShutdown() { events.push('shutdownVerified'); },
      };
    },
    async startUpgrade() {
      assert.equal(applicationRunning, true);
      assert.ok(events.includes('applicationReady'));
      events.push('installerStarted');
      if (['observerFailed', 'cleanupFailed'].includes(mode)) {
        validation.reject(new Error('runningUpgradeValidationInvalid'));
        msiExit.resolve(nativeResult(1603));
      } else {
        events.push('validationObserved'); validation.resolve();
        if (['blocked', 'shutdownFailed'].includes(mode)) msiExit.resolve(nativeResult(1603));
        if (mode === 'invalidExit') msiExit.resolve(nativeResult(3010));
        if (mode === 'wrongEvent') msiExit.resolve(nativeResult(0));
      }
      return { validation: validation.promise, completion: msiExit.promise };
    },
    async verifyBlockedSource() {
      assert.equal(applicationRunning, false);
      events.push('sourceVerified');
    },
    async resumeUpgrade() { events.push('upgradeAfterClose'); return 0; },
  };
  return { ports, events, resources: () => ({ applicationRunning }) };
}

test('MSI validation, not a fixed delay, releases a ready application before terminal acceptance', async () => {
  const f = fixture();
  const result = await coordinateRunningApplicationUpgrade(f.ports);
  assert.deepEqual(result, { status: 'completed', errorCode: null, cleanupResultCode: 'completed',
    exitCode: 0, initialExitCode: 0, boundary: 'validationObserved' });
  assert.deepEqual(f.events, ['applicationStarted', 'applicationReady', 'installerStarted',
    'validationObserved', 'applicationClose', 'shutdownVerified']);
  assert.deepEqual(f.resources(), { applicationRunning: false });
});

test('blocked Setup resumes once only after graceful exit and unchanged source proof', async () => {
  const f = fixture('blocked');
  const result = await coordinateRunningApplicationUpgrade(f.ports);
  assert.equal(result.status, 'completed');
  assert.equal(result.boundary, 'blockedSourcePreserved');
  assert.equal(result.initialExitCode, 1603);
  assert.equal(result.exitCode, 0);
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

test('failed installed-state inspection retains its known error and forbids continuation', async () => {
  const f = fixture('blocked');
  f.ports.verifyBlockedSource = async () => { throw new Error('installerStateInspectionFailed'); };
  const result = await coordinateRunningApplicationUpgrade(f.ports);
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'installerStateInspectionFailed');
  assert.equal(result.cleanupResultCode, 'completed');
  assert.equal(f.events.includes('upgradeAfterClose'), false);
  assert.deepEqual(f.resources(), { applicationRunning: false });
});

test('failed application startup never starts MSI but still closes the owned application', async () => {
  const f = fixture('startupFailed');
  const result = await coordinateRunningApplicationUpgrade(f.ports);
  assert.equal(result.errorCode, 'runningUpgradeApplicationFailed');
  assert.equal(f.events.includes('installerStarted'), false);
  assert.deepEqual(f.resources(), { applicationRunning: false });
});

test('unknown or reboot-required MSI failure cannot become a blocked-Setup retry', async () => {
  const f = fixture('invalidExit');
  const result = await coordinateRunningApplicationUpgrade(f.ports);
  assert.equal(result.errorCode, 'runningUpgradeMsiFailed');
  assert.equal(result.initialExitCode, 3010);
  assert.equal(f.events.includes('upgradeAfterClose'), false);
  assert.deepEqual(f.resources(), { applicationRunning: false });
});

for (const mode of ['observerFailed', 'wrongEvent', 'cleanupFailed', 'shutdownFailed']) {
  test(`${mode} keeps the original error separate from resource cleanup`, async () => {
    const f = fixture(mode);
    const result = await coordinateRunningApplicationUpgrade(f.ports);
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, mode === 'shutdownFailed' ? 'runningUpgradeShutdownFailed' : 'runningUpgradeValidationInvalid');
    const cleanupFailed = ['cleanupFailed', 'shutdownFailed'].includes(mode);
    assert.equal(result.cleanupResultCode, cleanupFailed ? 'cleanupUnverified' : 'completed');
    assert.deepEqual(f.resources(), { applicationRunning: cleanupFailed });
    assert.equal(f.events.includes('upgradeAfterClose'), false);
    assert.equal(f.events.filter((event) => event === 'applicationClose').length, 1);
  });
}

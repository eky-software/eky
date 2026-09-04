import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeCleanInstallUninstallLifecycle,
} from './cleanInstallUninstallLifecycle.mjs';

function absentState(overrides = {}) {
  return {
    productState: -1,
    productName: null,
    productVersion: null,
    localPackagePresent: false,
    ownedRegistryExists: false,
    installRootExists: false,
    executableExists: false,
    shortcutExists: false,
    ekyProcessCount: 0,
    ...overrides,
  };
}

function installedState(overrides = {}) {
  return absentState({
    productState: 5,
    productName: 'Eky',
    productVersion: '0.2.7',
    localPackagePresent: true,
    ownedRegistryExists: true,
    installRootExists: true,
    executableExists: true,
    shortcutExists: true,
    ...overrides,
  });
}

test('clean lifecycle installs, verifies, uninstalls, and verifies absence in order', async () => {
  const events = [];
  const states = [absentState(), installedState(), absentState()];
  const result = await executeCleanInstallUninstallLifecycle({
    expectedVersion: '0.2.7',
    inspectState: async (label) => {
      events.push(`state:${label}`);
      return states.shift();
    },
    runMsiOperation: async (operation) => {
      events.push(`msi:${operation}`);
      return 0;
    },
    verifyFixture: async () => events.push('fixture'),
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(events, [
    'state:preflight',
    'fixture',
    'msi:install',
    'state:installed',
    'fixture',
    'msi:uninstall',
    'state:uninstalled',
    'fixture',
  ]);
});

test('a dirty precondition is rejected without mutating the existing install', async () => {
  const operations = [];
  const result = await executeCleanInstallUninstallLifecycle({
    expectedVersion: '0.2.7',
    inspectState: async () => installedState(),
    runMsiOperation: async (operation) => {
      operations.push(operation);
      return 0;
    },
    verifyFixture: async () => undefined,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'cleanLifecyclePreconditionFailed');
  assert.equal(result.cleanupResultCode, 'notRequired');
  assert.deepEqual(operations, []);
});

test('an installed-state failure preserves the primary error and cleans the exact product', async () => {
  const operations = [];
  const states = [
    absentState(),
    installedState({ executableExists: false }),
    installedState(),
    absentState(),
  ];
  const result = await executeCleanInstallUninstallLifecycle({
    expectedVersion: '0.2.7',
    inspectState: async () => states.shift(),
    runMsiOperation: async (operation) => {
      operations.push(operation);
      return 0;
    },
    verifyFixture: async () => undefined,
  });
  assert.equal(result.errorCode, 'cleanInstalledStateInvalid');
  assert.equal(result.cleanupResultCode, 'cleanupCompleted');
  assert.equal(result.uninstalledStateValidated, true);
  assert.deepEqual(operations, ['install', 'cleanup']);
});

test('cleanup failure cannot replace the primary lifecycle failure', async () => {
  const states = [absentState(), installedState({ shortcutExists: false }), installedState()];
  const result = await executeCleanInstallUninstallLifecycle({
    expectedVersion: '0.2.7',
    inspectState: async () => states.shift(),
    runMsiOperation: async (operation) => (operation === 'cleanup' ? 1603 : 0),
    verifyFixture: async () => undefined,
  });
  assert.equal(result.errorCode, 'cleanInstalledStateInvalid');
  assert.equal(result.cleanupResultCode, 'cleanupFailed');
});

test('dependency failures retain their allowlisted lifecycle classification', async () => {
  const result = await executeCleanInstallUninstallLifecycle({
    expectedVersion: '0.2.7',
    inspectState: async () => absentState(),
    runMsiOperation: async () => 0,
    verifyFixture: async () => {
      throw new Error('untrusted detail');
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'fixtureVerificationFailed');
  assert.equal(result.cleanupResultCode, 'notRequired');
});

test('safe progress uses schema version 1 and cannot alter the terminal result', async () => {
  async function execute(reportProgress) {
    const states = [absentState(), installedState(), absentState()];
    return executeCleanInstallUninstallLifecycle({
      expectedVersion: '0.2.7',
      inspectState: async () => states.shift(),
      reportProgress,
      runMsiOperation: async () => 0,
      verifyFixture: async () => undefined,
    });
  }

  const evidence = [];
  const expected = await execute((entry) => evidence.push(entry));
  const withBrokenOutput = await execute(() => {
    throw new Error('output unavailable');
  });

  assert.deepEqual(withBrokenOutput, expected);
  assert.ok(evidence.length > 0);
  assert.ok(evidence.every((entry) => entry.schemaVersion === 1));
  assert.ok(
    evidence.every(
      (entry) => entry.operation === 'cleanInstallUninstallLifecycle',
    ),
  );
  assert.ok(
    evidence.every((entry) => entry.scenario === 'cleanInstallUninstall'),
  );
  assert.equal(evidence.at(-1).phase, 'lifecycle');
  assert.equal(evidence.at(-1).status, 'completed');
});

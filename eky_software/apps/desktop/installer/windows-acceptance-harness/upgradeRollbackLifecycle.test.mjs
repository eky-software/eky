import assert from 'node:assert/strict';
import test from 'node:test';

import { executeUpgradeRollbackLifecycle } from './upgradeRollbackLifecycle.mjs';

const VERSIONS = Object.freeze({ source: '0.2.7', target: '0.2.8' });

function product(version = null) {
  return Object.freeze({
    schemaVersion: 1,
    productState: version === null ? -1 : 5,
    productName: version === null ? null : 'Eky',
    productVersion: version,
    localPackagePresent: version !== null,
    ownedRegistryExists: version !== null,
    ekyProcessCount: 0,
  });
}

function state(active = null, rollbackBlockerKind = 'absent') {
  return Object.freeze({
    source: product(active === 'source' ? VERSIONS.source : null),
    target: product(active === 'target' ? VERSIONS.target : null),
    installRootExists: active !== null,
    executableExists: active !== null,
    shortcutExists: active !== null,
    ekyProcessCount: 0,
    rollbackBlockerKind,
  });
}

function createSuccessfulDependencies(overrides = {}) {
  const states = [
    state(),
    state('source'),
    state('target'),
    state('target'),
    state('source'),
    state('source', 'file'),
    state('source'),
    state(),
  ];
  const operations = [];
  let verifyCount = 0;
  return {
    createRollbackBlocker: async () => undefined,
    inspectState: async () => states.shift(),
    invokeBinaryRollback: async () => 0,
    removeRollbackBlocker: async () => undefined,
    reportProgress: () => undefined,
    runMsiOperation: async (operation) => {
      operations.push(operation);
      return {
        sourceInstall: 0,
        majorUpgrade: 0,
        downgrade: 1638,
        windowsInstallerRollback: 1603,
        finalUninstall: 0,
      }[operation];
    },
    verifyArtifact: async () => {
      verifyCount += 1;
    },
    versions: VERSIONS,
    operations,
    getVerifyCount: () => verifyCount,
    ...overrides,
  };
}

test('lifecycle proves upgrade, downgrade, both rollback paths, and final absence', async () => {
  const dependencies = createSuccessfulDependencies();
  const result = await executeUpgradeRollbackLifecycle(dependencies);

  assert.equal(result.status, 'completed');
  assert.equal(result.resultCode, 'upgradeRollbackCompleted');
  assert.deepEqual(dependencies.operations, [
    'sourceInstall',
    'majorUpgrade',
    'downgrade',
    'windowsInstallerRollback',
    'finalUninstall',
  ]);
  assert.equal(dependencies.getVerifyCount(), 5);
  assert.equal(result.binaryRollbackRestoredSource, true);
  assert.equal(result.windowsInstallerRollbackRestoredSource, true);
});

test('accepted downgrade fails closed and cleans the exact target product', async () => {
  const states = [
    state(),
    state('source'),
    state('target'),
    state('target'),
    state('target'),
    state(),
  ];
  const operations = [];
  const result = await executeUpgradeRollbackLifecycle({
    ...createSuccessfulDependencies(),
    inspectState: async () => states.shift(),
    runMsiOperation: async (operation) => {
      operations.push(operation);
      return operation === 'downgrade' ? 0 : 0;
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'downgradeAccepted');
  assert.equal(result.cleanupResultCode, 'cleanupCompleted');
  assert.deepEqual(operations, [
    'sourceInstall',
    'majorUpgrade',
    'downgrade',
    'cleanupTarget',
  ]);
});

test('cleanup failure never replaces the primary lifecycle error', async () => {
  const states = [state(), state('source'), state('source')];
  const result = await executeUpgradeRollbackLifecycle({
    ...createSuccessfulDependencies(),
    inspectState: async () => {
      const next = states.shift();
      if (next === undefined) {
        throw new Error('blocked');
      }
      return next;
    },
    runMsiOperation: async (operation) =>
      operation === 'majorUpgrade' ? 1603 : 0,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'majorUpgradeFailed');
  assert.equal(result.cleanupResultCode, 'cleanupFailed');
});

test('progress output failure cannot alter terminal semantics', async () => {
  const dependencies = createSuccessfulDependencies({
    reportProgress() {
      throw new Error('output unavailable');
    },
  });
  const result = await executeUpgradeRollbackLifecycle(dependencies);
  assert.equal(result.status, 'completed');
});

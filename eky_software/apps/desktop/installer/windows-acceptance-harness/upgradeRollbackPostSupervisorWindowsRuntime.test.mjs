import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyUpgradeRollbackProductStates } from './upgradeRollbackPostSupervisorWindowsRuntime.mjs';


test('shared installer registry never aliases the absent target ProductCode', () => {
  assert.deepEqual(
    classifyUpgradeRollbackProductStates(
      {
        exactProductPresent: true,
        installerRegistryPresent: true,
      },
      {
        exactProductPresent: false,
        installerRegistryPresent: true,
      },
    ),
    {
      status: 'completed',
      resultCode: 'sourceProductPresent',
      sourcePresent: true,
      targetPresent: false,
      installerRegistryPresent: true,
    },
  );
});

test('orphaned shared installer registry remains a distinct failed-safe state', () => {
  assert.equal(
    classifyUpgradeRollbackProductStates(
      {
        exactProductPresent: false,
        installerRegistryPresent: true,
      },
      {
        exactProductPresent: false,
        installerRegistryPresent: true,
      },
    ).resultCode,
    'installerRegistryPresent',
  );
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { classifyUpgradeRollbackProductStates } from './upgradeRollbackPostSupervisorWindowsRuntime.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

test('post-supervisor runtime owns only bounded exact-product adapters', async () => {
  const source = await readFile(
    resolve(DIRECTORY, 'upgradeRollbackPostSupervisorWindowsRuntime.mjs'),
    'utf8',
  );
  assert.match(source, /runBoundedWindowsAdapterProcess/u);
  assert.match(source, /artifact\.roles\[roleName\]\.productCode/u);
  assert.doesNotMatch(source, /taskkill|Get-CimInstance|WindowsProcessSupervisor/iu);
  assert.doesNotMatch(source, /retry|setTimeout|Start-Sleep/iu);
});

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

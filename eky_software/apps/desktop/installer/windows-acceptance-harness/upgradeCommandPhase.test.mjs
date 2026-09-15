import assert from 'node:assert/strict';
import test from 'node:test';
import { runUpgradeCommandPhase } from './upgradeCommandPhase.mjs';
import { runUpgradeRollbackWorker } from './runUpgradeRollbackWorker.mjs';

test('upgrade phase and existing scenario worker load and reject malformed invocation before filesystem work', async () => {
  assert.equal(await runUpgradeCommandPhase([]), 1);
  assert.equal(await runUpgradeCommandPhase(['--phase-request', null]), 1);
  assert.equal(await runUpgradeRollbackWorker([]), 64);
});

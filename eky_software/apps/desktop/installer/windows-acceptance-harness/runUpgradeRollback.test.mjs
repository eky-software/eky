import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  parseUpgradeRollbackArguments,
  requireUpgradeRollbackProductPrecondition,
} from './runUpgradeRollback.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

test('upgrade runner accepts only the canonical descriptor path', () => {
  assert.deepEqual(
    parseUpgradeRollbackArguments([
      '--artifact-descriptor',
      'C:\\temp\\artifact\\upgrade-rollback-artifact.json',
    ]),
    {
      descriptorPath:
        'C:\\temp\\artifact\\upgrade-rollback-artifact.json',
    },
  );
  assert.throws(
    () =>
      parseUpgradeRollbackArguments([
        '--artifact-descriptor',
        'C:\\temp\\artifact\\renamed.json',
      ]),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARGUMENTS_INVALID/,
  );
  assert.throws(
    () => parseUpgradeRollbackArguments(['--artifact-descriptor', 'relative']),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARGUMENTS_INVALID/,
  );
});

test('upgrade worker has no build, nested supervisor, W6, or emergency cleanup ownership', async () => {
  const worker = await readFile(
    resolve(DIRECTORY, 'runUpgradeRollbackWorker.mjs'),
    'utf8',
  );
  const runtime = await readFile(
    resolve(DIRECTORY, 'upgradeRollbackWindowsRuntime.mjs'),
    'utf8',
  );
  assert.doesNotMatch(worker, /buildWindows|packageWindows|w6b/iu);
  assert.doesNotMatch(worker, /WindowsProcessSupervisor|taskkill|Get-CimInstance/iu);
  assert.doesNotMatch(runtime, /WindowsProcessSupervisor|taskkill|Get-CimInstance/iu);
  assert.match(runtime, /rollbackWindowsInstaller\.ps1/u);
});

test('outer product preflight accepts only exact source and target absence', () => {
  assert.doesNotThrow(() =>
    requireUpgradeRollbackProductPrecondition({
      status: 'completed',
      resultCode: 'exactProductsAbsent',
      sourcePresent: false,
      targetPresent: false,
      installerRegistryPresent: false,
    }),
  );
  assert.throws(
    () =>
      requireUpgradeRollbackProductPrecondition({
        status: 'completed',
        resultCode: 'sourceProductPresent',
        sourcePresent: true,
        targetPresent: false,
        installerRegistryPresent: true,
      }),
    /WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED/,
  );
  assert.throws(
    () =>
      requireUpgradeRollbackProductPrecondition({
        status: 'completed',
        resultCode: 'installerRegistryPresent',
        sourcePresent: false,
        targetPresent: false,
        installerRegistryPresent: true,
      }),
    /WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED/,
  );
  assert.throws(
    () =>
      requireUpgradeRollbackProductPrecondition({
        status: 'failed',
        errorCode: 'productStateVerificationFailed',
      }),
    /WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED/,
  );
});

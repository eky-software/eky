import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  parseLegacyUpgradeArguments,
  requireLegacyUpgradeProductPrecondition,
  resolveLegacyUpgradeTemporaryRoot,
} from './runLegacyUpgrade.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

test('legacy runner accepts only the canonical descriptor path', () => {
  assert.deepEqual(
    parseLegacyUpgradeArguments([
      '--artifact-descriptor',
      'C:\\temp\\legacy\\legacy-upgrade-artifact.json',
    ]),
    { descriptorPath: 'C:\\temp\\legacy\\legacy-upgrade-artifact.json' },
  );
  assert.throws(
    () =>
      parseLegacyUpgradeArguments([
        '--artifact-descriptor',
        'C:\\temp\\legacy\\renamed.json',
      ]),
    /WINDOWS_ACCEPTANCE_LEGACY_ARGUMENTS_INVALID/,
  );
});

test('legacy runner canonicalizes the temporary root before fixture creation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-legacy-root-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const canonical = resolve(root, 'canonical');
  const alias = resolve(root, 'alias');
  await mkdir(canonical);
  await symlink(canonical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await resolveLegacyUpgradeTemporaryRoot(alias), await realpath(canonical));
});

test('legacy outer precondition accepts only exact product absence', () => {
  assert.doesNotThrow(() =>
    requireLegacyUpgradeProductPrecondition({
      status: 'completed',
      resultCode: 'exactProductsAbsent',
      sourcePresent: false,
      targetPresent: false,
      installerRegistryPresent: false,
    }),
  );
  assert.throws(
    () =>
      requireLegacyUpgradeProductPrecondition({
        status: 'completed',
        resultCode: 'sourceProductPresent',
        sourcePresent: true,
        targetPresent: false,
        installerRegistryPresent: true,
      }),
    /WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED/,
  );
});

test('legacy worker has one supervisor owner and no build, W6, retry, or emergency cleanup', async () => {
  const runner = await readFile(resolve(DIRECTORY, 'runLegacyUpgrade.mjs'), 'utf8');
  const worker = await readFile(resolve(DIRECTORY, 'runLegacyUpgradeWorker.mjs'), 'utf8');
  assert.match(runner, /Eky\.WindowsProcessSupervisor\.dll/u);
  assert.doesNotMatch(worker, /WindowsProcessSupervisor|taskkill|Get-CimInstance|packageWindows|buildWindows|w6b/iu);
  assert.doesNotMatch(`${runner}\n${worker}`, /retry|setTimeout|Start-Sleep/iu);
});

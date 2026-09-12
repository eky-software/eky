import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parseLegacyUpgradeArguments, requireLegacyUpgradeProductPrecondition,
  resolveLegacyUpgradeTemporaryRoot } from './legacyUpgradeAdmission.mjs';

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

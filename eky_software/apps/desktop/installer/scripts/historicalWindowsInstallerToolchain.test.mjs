import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import { HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY } from './historicalWindowsInstallerFixturePolicy.mjs';
import {
  assertHistoricalLockedInputsUnchanged,
  captureHistoricalLockedInputHashes,
  validateHistoricalWindowsInstallerSource,
} from './historicalWindowsInstallerToolchain.mjs';
import { withMaterializedHistoricalWindowsInstallerSource } from './materializeHistoricalWindowsInstallerSource.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test('validates the locked metadata from the exact archived source tree', async () => {
  const metadata = await withMaterializedHistoricalWindowsInstallerSource(
    (materialized) =>
      validateHistoricalWindowsInstallerSource(materialized.workspaceRoot),
  );

  assert.deepEqual(
    {
      betterSqliteVersion: metadata.betterSqliteVersion,
      dotnetVersion: metadata.dotnetVersion,
      electronVersion: metadata.electronVersion,
      pnpmVersion: metadata.pnpmVersion,
      wixVersion: metadata.wixVersion,
    },
    {
      betterSqliteVersion: '13.0.2',
      dotnetVersion: '10.0.302',
      electronVersion: '43.3.0',
      pnpmVersion: '11.1.3',
      wixVersion: '7.0.0',
    },
  );
});

test('rejects changed or missing historical lock inputs', async () => {
  const root = await createLockedInputFixture();
  const captured = await captureHistoricalLockedInputHashes(root);

  await writeFile(join(root, 'pnpm-lock.yaml'), 'changed\n');
  await assert.rejects(
    assertHistoricalLockedInputsUnchanged({
      expected: captured,
      workspaceRoot: root,
    }),
    /HISTORICAL_FIXTURE_LOCKED_INPUT_CHANGED/,
  );

  await unlink(join(root, 'pnpm-lock.yaml'));
  await assert.rejects(
    captureHistoricalLockedInputHashes(root),
    /HISTORICAL_FIXTURE_LOCKED_INPUT_INVALID/,
  );
});

async function createLockedInputFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-historical-locks-'));
  temporaryDirectories.push(root);
  for (const relativePath of
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY.lockedInputRelativePaths) {
    const path = join(root, ...relativePath.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${relativePath}\n`);
  }
  return root;
}

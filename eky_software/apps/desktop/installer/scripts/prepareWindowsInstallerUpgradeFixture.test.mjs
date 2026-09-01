import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  copyRollbackFixturePayload,
  createUpgradeFixtureAppVersion,
  createUpgradeFixtureMsiVersion,
  validateUpgradeFixtureReleaseRevision,
} from './prepareWindowsInstallerUpgradeFixture.mjs';

test('copies rollback payload without hardlinking the release artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-upgrade-fixture-copy-'));
  const sourceRoot = join(root, 'source');
  const sourceDirectory = join(sourceRoot, 'resources', 'desktop-runtime');
  const sourceFile = join(sourceDirectory, 'runtime.js');
  const targetRoot = join(root, 'target');
  const targetFile = join(
    targetRoot,
    'resources',
    'desktop-runtime',
    'runtime.js',
  );

  try {
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(sourceFile, 'release payload\n', 'utf8');

    await copyRollbackFixturePayload(sourceRoot, targetRoot);

    assert.equal(await readFile(targetFile, 'utf8'), 'release payload\n');
    assert.equal((await lstat(sourceFile)).nlink, 1);
    assert.equal((await lstat(targetFile)).nlink, 1);

    await writeFile(targetFile, 'rollback fixture\n', 'utf8');
    assert.equal(await readFile(sourceFile, 'utf8'), 'release payload\n');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('creates the next numeric patch version for the synthetic upgrade', () => {
  assert.equal(
    createUpgradeFixtureAppVersion('0.1.0'),
    '0.1.1',
  );
  assert.equal(
    createUpgradeFixtureAppVersion('1.2.3'),
    '1.2.4',
  );
  assert.throws(
    () => createUpgradeFixtureAppVersion('1.2.3-alpha.1'),
    /INSTALLER_UPGRADE_FIXTURE_APP_VERSION_INVALID/,
  );
});

test('increments only the MSI build version for the synthetic upgrade', () => {
  assert.equal(createUpgradeFixtureMsiVersion('0.1.1'), '0.1.2');
  assert.equal(createUpgradeFixtureMsiVersion('255.255.65534'), '255.255.65535');
  assert.throws(
    () => createUpgradeFixtureMsiVersion('255.255.65535'),
    /INSTALLER_UPGRADE_FIXTURE_MSI_VERSION_EXHAUSTED/,
  );
});

test('accepts only a frozen release revision in the clean harness ancestry', () => {
  const releaseRevision = 'a'.repeat(40);
  const harnessRevision = 'b'.repeat(40);

  assert.equal(
    validateUpgradeFixtureReleaseRevision({
      artifactRevision: releaseRevision,
      currentRevision: harnessRevision,
      isAncestor: true,
    }),
    releaseRevision,
  );
  assert.throws(
    () => validateUpgradeFixtureReleaseRevision({
      artifactRevision: releaseRevision,
      currentRevision: harnessRevision,
      isAncestor: false,
    }),
    /INSTALLER_UPGRADE_FIXTURE_RELEASE_REVISION_INVALID/,
  );
  assert.throws(
    () => validateUpgradeFixtureReleaseRevision({
      artifactRevision: 'not-a-revision',
      currentRevision: harnessRevision,
      isAncestor: true,
    }),
    /INSTALLER_UPGRADE_FIXTURE_RELEASE_REVISION_INVALID/,
  );
});

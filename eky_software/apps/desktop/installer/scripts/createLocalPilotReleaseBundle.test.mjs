import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  createInstallerManifest,
  writeInstallerManifest,
} from '../installerManifest.mjs';
import {
  createLocalPilotReleaseBundle,
  verifyLocalPilotReleaseBundle,
} from './createLocalPilotReleaseBundle.mjs';

const temporaryDirectories = [];
const buildRevision = 'a'.repeat(40);
const release = Object.freeze({
  appIdentity: 'Eky',
  appVersion: '0.1.0-alpha.1',
  architecture: 'x64',
  msiProductVersion: '0.1.1',
  platform: 'win32',
  releaseChannel: 'pilot',
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test('copies exactly the verified MSI, manifest and standard checksum', async () => {
  const fixture = await createFixture();
  const bundle = await createLocalPilotReleaseBundle(fixture);
  const checksum = await readFile(bundle.checksumPath, 'utf8');
  const verified = await verifyLocalPilotReleaseBundle({
    buildRevision,
    bundleDirectory: bundle.bundleDirectory,
    release,
  });

  assert.equal(verified.manifest.packageFilename, 'Eky-0.1.0-alpha.1-x64.msi');
  assert.equal(
    checksum,
    `${verified.manifest.packageSha256}  Eky-0.1.0-alpha.1-x64.msi\n`,
  );
});

test('does not overwrite an existing release bundle', async () => {
  const fixture = await createFixture();
  await createLocalPilotReleaseBundle(fixture);
  await assert.rejects(
    createLocalPilotReleaseBundle(fixture),
    /EEXIST/,
  );
});

test('rejects changed MSI bytes and non-pilot release identity', async () => {
  const fixture = await createFixture();
  await writeFile(fixture.installerPath, 'changed MSI bytes');
  await assert.rejects(
    createLocalPilotReleaseBundle(fixture),
    /INSTALLER_PACKAGE_DOES_NOT_MATCH_MANIFEST/,
  );
  await assert.rejects(
    createLocalPilotReleaseBundle({
      ...fixture,
      release: { ...release, releaseChannel: 'stable' },
    }),
    /INSTALLER_PILOT_BUNDLE_RELEASE_INVALID/,
  );
});

test('rejects a symbolic-link output root', async (t) => {
  const fixture = await createFixture();
  const realOutput = join(fixture.root, 'real-output');
  await rm(fixture.outputRoot, { force: true, recursive: true });
  await writeFile(realOutput, 'not a directory');
  try {
    await symlink(realOutput, fixture.outputRoot, 'file');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Symbolic link creation is not permitted in this Windows context.');
      return;
    }
    throw error;
  }
  await assert.rejects(
    createLocalPilotReleaseBundle(fixture),
    /INSTALLER_PILOT_BUNDLE_OUTPUT_INVALID/,
  );
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-local-pilot-release-'));
  temporaryDirectories.push(root);
  const installerPath = join(root, 'Eky-0.1.0-alpha.1-x64.msi');
  const manifestPath = join(root, 'Eky-0.1.0-alpha.1-x64.manifest.json');
  const outputRoot = join(root, 'bundles');
  await writeFile(installerPath, 'synthetic MSI release bytes');
  const manifest = await createInstallerManifest({
    buildRevision,
    installerPath,
    release,
  });
  await writeInstallerManifest(manifestPath, manifest);
  return { buildRevision, installerPath, manifestPath, outputRoot, release, root };
}

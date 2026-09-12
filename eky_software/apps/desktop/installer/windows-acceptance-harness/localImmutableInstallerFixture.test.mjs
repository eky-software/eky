import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  materializeLocalImmutableFixture,
} from './localImmutableInstallerFixture.mjs';

async function fixtureRoot(testContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-local-fixture-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function writeFixture(root) {
  const packageFilename = 'Eky-0.2.7-x64.msi';
  const packageBytes = Buffer.from('synthetic-msi-fixture');
  const packageSha256 = createHash('sha256').update(packageBytes).digest('hex');
  const manifest = {
    appIdentity: 'Eky',
    appVersion: '0.2.7',
    architecture: 'x64',
    buildRevision: 'a'.repeat(40),
    manifestFormatVersion: 1,
    msiProductVersion: '0.2.7',
    packageFilename,
    packageKind: 'windows-installer-msi',
    packageSha256,
    packageSize: packageBytes.length,
    platform: 'win32',
    releaseChannel: 'pilot',
    signing: {
      publisher: null,
      status: 'unsigned-prototype',
      thumbprint: null,
      timestamped: false,
    },
  };
  const manifestPath = join(root, 'installer.manifest.json');
  await writeFile(join(root, packageFilename), packageBytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const descriptorPath = join(root, 'clean-install-artifact.json');
  const manifestSha256 = createHash('sha256').update(`${JSON.stringify(manifest, null, 2)}\n`).digest('hex');
  await writeFile(descriptorPath, JSON.stringify({ schemaVersion: 1, buildRevision: manifest.buildRevision,
    manifestSha256, payload: { stage: 'packagedApp', fileCount: 1, totalByteSize: 1, identity: 'b'.repeat(64) } }));
  return { manifestPath: descriptorPath, packageSha256 };
}

test('local fixture is copied as independent bytes and bound to its manifest', async (testContext) => {
  const root = await fixtureRoot(testContext);
  const source = join(root, 'source');
  const runRoot = join(root, 'run');
  await mkdir(source);
  await mkdir(runRoot);
  const { manifestPath, packageSha256 } = await writeFixture(source);

  const fixture = await materializeLocalImmutableFixture(manifestPath, runRoot);
  assert.equal(fixture.packageSha256, packageSha256);
  assert.equal(fixture.manifest.appVersion, '0.2.7');
  assert.match(fixture.artifactDescriptorSha256, /^[0-9a-f]{64}$/);
});

test('hardlinked local fixture input is rejected', async (testContext) => {
  const root = await fixtureRoot(testContext);
  const source = join(root, 'source');
  const runRoot = join(root, 'run');
  await mkdir(source);
  await mkdir(runRoot);
  const { manifestPath } = await writeFixture(source);
  const linkedManifest = join(source, 'linked.manifest.json');
  await link(manifestPath, linkedManifest);
  await assert.rejects(
    materializeLocalImmutableFixture(linkedManifest, runRoot),
    /WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_INVALID/,
  );
});

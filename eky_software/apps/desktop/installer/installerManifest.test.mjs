import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  createInstallerManifest,
  readInstallerManifest,
  validateInstallerManifest,
  writeInstallerManifest,
} from './installerManifest.mjs';

const temporaryDirectories = [];
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

test('binds the sidecar manifest to exact MSI bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-installer-manifest-'));
  temporaryDirectories.push(root);
  const installerPath = join(root, 'Eky-0.1.0-alpha.1-x64.msi');
  const manifestPath = `${installerPath}.json`;
  const bytes = Buffer.from('synthetic MSI bytes');
  await writeFile(installerPath, bytes);

  const manifest = await createInstallerManifest({
    buildRevision: '123456789abc',
    installerPath,
    release,
  });
  assert.equal(manifest.packageSize, bytes.length);
  assert.equal(
    manifest.packageSha256,
    createHash('sha256').update(bytes).digest('hex'),
  );
  assert.equal(manifest.signing.status, 'unsigned-prototype');

  await writeInstallerManifest(manifestPath, manifest);
  assert.deepEqual(await readInstallerManifest(manifestPath), manifest);
  assert.match(await readFile(manifestPath, 'utf8'), /"windows-installer-msi"/);
});

test('rejects unknown fields and false signing claims', () => {
  const base = {
    appIdentity: 'Eky',
    appVersion: '0.1.0-alpha.1',
    architecture: 'x64',
    buildRevision: '123456789abc',
    manifestFormatVersion: 1,
    msiProductVersion: '0.1.1',
    packageFilename: 'Eky-0.1.0-alpha.1-x64.msi',
    packageKind: 'windows-installer-msi',
    packageSha256: 'a'.repeat(64),
    packageSize: 123,
    platform: 'win32',
    releaseChannel: 'pilot',
    signing: {
      publisher: null,
      status: 'unsigned-prototype',
      thumbprint: null,
      timestamped: false,
    },
  };
  assert.doesNotThrow(() => validateInstallerManifest(base));
  assert.throws(
    () => validateInstallerManifest({ ...base, path: 'C:\\secret' }),
    /INSTALLER_MANIFEST_MISSING_OR_INVALID/,
  );
  assert.throws(
    () =>
      validateInstallerManifest({
        ...base,
        signing: { ...base.signing, status: 'signed' },
      }),
    /INSTALLER_MANIFEST_MISSING_OR_INVALID/,
  );
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  createInstallerManifest,
  readInstallerManifest,
  validateInstallerManifest,
  verifyInstallerManifestPackage,
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
  assert.deepEqual(
    await verifyInstallerManifestPackage({
      expectedBuildRevision: '123456789abc',
      expectedRelease: release,
      installerPath,
      manifest,
    }),
    manifest,
  );
  assert.match(await readFile(manifestPath, 'utf8'), /"windows-installer-msi"/);
});

test('rejects changed MSI bytes and release identity mismatches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-installer-manifest-'));
  temporaryDirectories.push(root);
  const installerPath = join(root, 'Eky-0.1.0-alpha.1-x64.msi');
  await writeFile(installerPath, 'original MSI bytes');
  const manifest = await createInstallerManifest({
    buildRevision: '123456789abc',
    installerPath,
    release,
  });

  await writeFile(installerPath, 'changed MSI bytes');
  await assert.rejects(
    verifyInstallerManifestPackage({
      expectedBuildRevision: '123456789abc',
      expectedRelease: release,
      installerPath,
      manifest,
    }),
    /INSTALLER_PACKAGE_DOES_NOT_MATCH_MANIFEST/,
  );
  await assert.rejects(
    verifyInstallerManifestPackage({
      expectedBuildRevision: 'abcdef123456',
      expectedRelease: release,
      installerPath,
      manifest,
    }),
    /INSTALLER_MANIFEST_RELEASE_MISMATCH/,
  );
});

test('rejects non-files and symbolic links as installer packages', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-installer-manifest-'));
  temporaryDirectories.push(root);
  const directoryPath = join(root, 'Eky-0.1.0-alpha.1-x64.msi');
  await mkdir(directoryPath);
  await assert.rejects(
    createInstallerManifest({
      buildRevision: '123456789abc',
      installerPath: directoryPath,
      release,
    }),
    /INSTALLER_PACKAGE_MISSING_OR_INVALID/,
  );

  const targetPath = join(root, 'target.msi');
  const linkPath = join(root, 'Eky-0.1.0-alpha.1-x64-link.msi');
  await writeFile(targetPath, 'synthetic MSI bytes');
  try {
    await symlink(targetPath, linkPath, 'file');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Symbolic link creation is not permitted in this Windows context.');
      return;
    }
    throw error;
  }
  await assert.rejects(
    createInstallerManifest({
      buildRevision: '123456789abc',
      installerPath: linkPath,
      release,
    }),
    /INSTALLER_PACKAGE_MISSING_OR_INVALID/,
  );
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

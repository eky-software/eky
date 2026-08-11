import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  createInstallerSidecarPath,
  createWindowsInstallerRelease,
} from './releaseWindowsInstaller.mjs';
import { verifyWindowsInstallerRelease } from './verifyWindowsInstallerRelease.mjs';

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

test('builds once, inspects and verifies the same MSI bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-installer-release-'));
  temporaryDirectories.push(root);
  const installerPath = join(root, 'Eky-0.1.0-alpha.1-x64.msi');
  let buildCalls = 0;
  let inspectionCalls = 0;
  const built = await createWindowsInstallerRelease({
    buildInstaller: async () => {
      buildCalls += 1;
      await writeFile(installerPath, 'synthetic MSI release bytes');
      return installerBuildResult(installerPath);
    },
    buildRevision,
    inspectInstaller: async (result) => {
      inspectionCalls += 1;
      assert.equal(result.artifact, installerPath);
    },
  });

  assert.equal(buildCalls, 1);
  assert.equal(inspectionCalls, 1);
  assert.equal(
    built.manifestPath,
    join(root, 'Eky-0.1.0-alpha.1-x64.manifest.json'),
  );
  await verifyWindowsInstallerRelease({
    buildRevision,
    installerPath,
    manifestPath: built.manifestPath,
    release,
  });
});

test('does not publish a sidecar if inspection changes the MSI bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-installer-release-'));
  temporaryDirectories.push(root);
  const installerPath = join(root, 'Eky-0.1.0-alpha.1-x64.msi');
  const manifestPath = createInstallerSidecarPath(installerPath);

  await assert.rejects(
    createWindowsInstallerRelease({
      buildInstaller: async () => {
        await writeFile(installerPath, 'synthetic MSI release bytes');
        return installerBuildResult(installerPath);
      },
      buildRevision,
      inspectInstaller: async () => {
        await writeFile(installerPath, 'changed after inspection started');
      },
    }),
    /INSTALLER_PACKAGE_DOES_NOT_MATCH_MANIFEST/,
  );
  await assert.rejects(access(manifestPath));
});

test('separate verification rejects MSI changes without rebuilding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-installer-release-'));
  temporaryDirectories.push(root);
  const installerPath = join(root, 'Eky-0.1.0-alpha.1-x64.msi');
  const built = await createWindowsInstallerRelease({
    buildInstaller: async () => {
      await writeFile(installerPath, 'synthetic MSI release bytes');
      return installerBuildResult(installerPath);
    },
    buildRevision,
    inspectInstaller: async () => {},
  });

  await writeFile(installerPath, 'tampered release bytes');
  await assert.rejects(
    verifyWindowsInstallerRelease({
      buildRevision,
      installerPath,
      manifestPath: built.manifestPath,
      release,
    }),
    /INSTALLER_PACKAGE_DOES_NOT_MATCH_MANIFEST/,
  );
});

function installerBuildResult(installerPath) {
  return Object.freeze({
    artifact: installerPath,
    inventory: Object.freeze({}),
    payloadFileCount: 3,
    productCode: '5D93DBC6-ECBC-5725-83F0-EFBB131D42D0',
    release,
  });
}

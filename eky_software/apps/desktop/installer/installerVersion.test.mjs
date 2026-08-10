import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  compareMsiProductVersions,
  parseMsiProductVersion,
  readInstallerReleaseConfig,
  validateInstallerReleaseConfig,
} from './installerVersion.mjs';

const temporaryDirectories = [];
const validConfig = Object.freeze({
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

test('accepts only Windows Installer three-part numeric versions in range', () => {
  assert.deepEqual(parseMsiProductVersion('255.255.65535'), [255, 255, 65_535]);
  for (const value of [
    '1',
    '1.2',
    '1.2.3.4',
    '01.2.3',
    '256.0.0',
    '0.256.0',
    '0.0.65536',
  ]) {
    assert.throws(
      () => parseMsiProductVersion(value),
      /MSI_PRODUCT_VERSION_INVALID/,
    );
  }
});

test('compares MSI versions numerically', () => {
  assert.equal(compareMsiProductVersions('0.1.2', '0.1.1'), 1);
  assert.equal(compareMsiProductVersions('0.1.1', '0.1.1'), 0);
  assert.equal(compareMsiProductVersions('0.1.1', '0.2.0'), -1);
});

test('requires an exact release config and desktop SemVer match', () => {
  assert.deepEqual(
    validateInstallerReleaseConfig(validConfig, '0.1.0-alpha.1'),
    validConfig,
  );
  for (const value of [
    { ...validConfig, appVersion: '0.1.1' },
    { ...validConfig, releaseChannel: 'development' },
    { ...validConfig, extra: true },
  ]) {
    assert.throws(
      () => validateInstallerReleaseConfig(value, '0.1.0-alpha.1'),
      /INSTALLER_RELEASE_CONFIG_INVALID/,
    );
  }
});

test('reads release identity from closed JSON files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-installer-release-'));
  temporaryDirectories.push(root);
  const configPath = join(root, 'installer-release.json');
  const packagePath = join(root, 'package.json');
  await writeFile(configPath, JSON.stringify(validConfig), 'utf8');
  await writeFile(
    packagePath,
    JSON.stringify({ version: validConfig.appVersion }),
    'utf8',
  );

  await assert.doesNotReject(
    readInstallerReleaseConfig(configPath, packagePath),
  );
  await writeFile(packagePath, JSON.stringify({ version: '0.1.1' }), 'utf8');
  await assert.rejects(
    readInstallerReleaseConfig(configPath, packagePath),
    /INSTALLER_RELEASE_CONFIG_INVALID/,
  );
});

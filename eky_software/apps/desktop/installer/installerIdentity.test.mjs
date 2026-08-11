import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createInstallerComponentCode,
  createInstallerProductCode,
  createInstallerRegistryValueName,
  INSTALLER_UPGRADE_CODE,
  normalizeInstallerLogicalPath,
} from './installerIdentity.mjs';

const guidPattern = /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/;

test('keeps upgrade identity stable while product identity changes by version', () => {
  assert.match(INSTALLER_UPGRADE_CODE, guidPattern);
  assert.match(createInstallerProductCode('0.1.1'), guidPattern);
  assert.equal(
    createInstallerProductCode('0.1.1'),
    createInstallerProductCode('0.1.1'),
  );
  assert.notEqual(
    createInstallerProductCode('0.1.1'),
    createInstallerProductCode('0.1.2'),
  );
});

test('matches the canonical runtime ProductCode contract corpus', async () => {
  const fixtures = JSON.parse(
    await readFile(
      new URL(
        './fixtures/installerProductCodeContractFixtures.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  for (const fixture of fixtures) {
    assert.equal(
      createInstallerProductCode(fixture.msiProductVersion),
      fixture.productCode,
    );
  }
});

test('normalizes component identity without depending on Windows separators', () => {
  assert.equal(
    normalizeInstallerLogicalPath('resources\\backend'),
    'resources/backend',
  );
  assert.equal(
    createInstallerComponentCode('Resources/Backend'),
    createInstallerComponentCode('resources\\backend'),
  );
  assert.equal(
    createInstallerRegistryValueName('Resources/Backend'),
    createInstallerRegistryValueName('resources\\backend'),
  );
});

test('rejects empty, absolute and traversing installer paths', () => {
  for (const value of [
    '',
    '.',
    '..',
    '/resources/backend',
    'C:\\resources\\backend',
    '\\\\server\\share\\backend',
    'resources/../backend',
    'resources\0backend',
  ]) {
    assert.throws(
      () => normalizeInstallerLogicalPath(value),
      /INSTALLER_LOGICAL_PATH_INVALID/,
    );
  }
});

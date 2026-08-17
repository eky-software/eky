import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  readDesktopElectronVersion,
  readDesktopElectronVersionFromMetadata,
} from './read-desktop-electron-version.mjs';

test('reads the exact stable Electron version from desktop package metadata', () => {
  assert.equal(
    readDesktopElectronVersionFromMetadata({
      devDependencies: { electron: '42.8.0' },
    }),
    '42.8.0',
  );
});

for (const [name, value] of [
  ['missing version', { devDependencies: {} }],
  ['caret range', { devDependencies: { electron: '^42.8.0' } }],
  ['tilde range', { devDependencies: { electron: '~42.8.0' } }],
  ['latest tag', { devDependencies: { electron: 'latest' } }],
  ['wrong type', { devDependencies: { electron: 42 } }],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(
      () => readDesktopElectronVersionFromMetadata(value),
      /exact stable SemVer/,
    );
  });
}

test('reads the repository desktop package as the only Electron version source', async () => {
  assert.equal(await readDesktopElectronVersion(), '43.3.0');
});

import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInstallerValidationObserver, hasInstallerValidationStarted } from './upgradeInstallerValidationObserver.mjs';

const MARKER = 'MSI (s) (10:2C) [12:34:56:789]: Doing action: InstallValidate\r\n';

test('only the native execute sequence validation action is an observation', () => {
  assert.equal(hasInstallerValidationStarted(Buffer.from(MARKER)), true);
  assert.equal(hasInstallerValidationStarted(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(MARKER, 'utf16le')])), true);
  for (const value of [MARKER.replace('(s)', '(c)'), MARKER.replace('InstallValidate', 'InstallFiles'),
    'untrusted field: Doing action: InstallValidate\r\n']) {
    assert.equal(hasInstallerValidationStarted(Buffer.from(value)), false);
  }
});

test('native file change completes the observation and closing releases the watcher', { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-msi-validation-'));
  const path = join(root, 'validation.log');
  let observer;
  t.after(async () => { await observer?.close(); await rm(root, { force: true, recursive: true }); });
  observer = await createInstallerValidationObserver(path);
  await appendFile(path, MARKER);
  await observer.completion;
  await observer.close();
  await rm(path);
});

test('closing an observer without an event does not wait for an MSI phase', { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-msi-validation-close-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const observer = await createInstallerValidationObserver(join(root, 'validation.log'));
  await observer.close();
});

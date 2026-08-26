import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

test('W6B.2 rollback progress accepts only closed safe records', {
  skip: process.platform !== 'win32',
}, () => {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(scriptDirectory, 'w6b2FaultRollbackProgress.test.ps1'),
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const lines = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '');

  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  assert.deepEqual(lines.map((line) => JSON.parse(line)), [
    { status: 'succeeded' },
  ]);
});

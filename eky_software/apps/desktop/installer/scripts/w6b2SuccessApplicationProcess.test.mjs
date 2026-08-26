import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const powershellTestPath = join(
  scriptDirectory,
  'w6b2SuccessApplicationProcess.test.ps1',
);

test('W6B2 handoff transfers validated proof without weakening strict phases', {
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
      powershellTestPath,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const lines = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '');
  const terminal = lines.length === 1 ? JSON.parse(lines[0]) : null;

  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  assert.deepEqual(terminal, {
    status: 'succeeded',
    handoffReturnsOnProof: true,
    strictPhaseRequiresZeroExit: true,
    earlyExitRejected: true,
    activationMigrationUsesExactRelaunch: true,
    proofFailureIsSafelyClassified: true,
    exactOwnedCleanup: true,
    reusedProcessIdentityPreserved: true,
    missingProcessIdentityIgnored: true,
    orphanProcessCount: 0,
  });
});

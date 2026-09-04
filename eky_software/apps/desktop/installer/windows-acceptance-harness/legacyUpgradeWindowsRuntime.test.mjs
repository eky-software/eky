import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

test('legacy worker runtime has no nested supervisor, process scan, timeout, or emergency cleanup', async () => {
  const files = await Promise.all(
    [
      'legacyUpgradeWindowsRuntime.mjs',
      'legacyUpgradeSourceSmoke.mjs',
      'legacyUpgradeStartupObserver.mjs',
    ].map((name) => readFile(resolve(DIRECTORY, name), 'utf8')),
  );
  const source = files.join('\n');
  assert.doesNotMatch(
    source,
    /WindowsProcessSupervisor|Get-CimInstance|taskkill|Stop-Process|wmic|setTimeout|Start-Sleep/iu,
  );
  assert.match(source, /requestWindowsApplicationClose\.ps1/u);
  assert.match(source, /runHistoricalPackagedSmokeProcessChain/u);
});

test('legacy worker runtime uses the artifact packages and normal source and target startup', async () => {
  const source = await readFile(
    resolve(DIRECTORY, 'legacyUpgradeWindowsRuntime.mjs'),
    'utf8',
  );
  assert.match(source, /artifact\[roleName\]\.installerPath/u);
  assert.match(source, /--desktop-smoke-restored/u);
  assert.match(source, /--user-data-dir=/u);
  assert.match(source, /windowsHide: false/u);
  assert.match(source, /runSourceStartup/u);
  assert.doesNotMatch(source, /w6b|packageWindows|buildWindows/iu);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

test('graceful close adapter requests one exact window close without ownership logic', async () => {
  const source = await readFile(
    resolve(DIRECTORY, 'requestWindowsApplicationClose.ps1'),
    'utf8',
  );
  assert.match(source, /Get-Process -Id \$ProcessId/u);
  assert.match(source, /CloseMainWindow\(\)/u);
  assert.doesNotMatch(
    source,
    /Get-CimInstance|taskkill|Stop-Process|Wait-Process|Start-Sleep|while\s*\(|do\s*\{/iu,
  );
});

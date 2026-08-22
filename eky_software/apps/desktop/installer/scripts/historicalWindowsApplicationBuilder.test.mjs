import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

test('uses only the ordinary package command for the historical application payload', async () => {
  const source = await readFile(
    join(scriptDirectory, 'historicalWindowsApplicationBuilder.mjs'),
    'utf8',
  );

  assert.match(source, /'package:windows'/u);
  assert.doesNotMatch(source, /package:windows:pilot/u);
  assert.doesNotMatch(source, /installer:local-pilot-bundle/u);
  assert.doesNotMatch(source, /verifyHistorical/u);
});

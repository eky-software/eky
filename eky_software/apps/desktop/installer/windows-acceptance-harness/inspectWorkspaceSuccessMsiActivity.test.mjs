import assert from 'node:assert/strict';
import { link, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { readWorkspaceSuccessObject } from './workspaceSuccessContracts.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'inspectWorkspaceSuccessMsiActivity.ps1');
const windows = { skip: process.platform !== 'win32' };

async function fixture(context) {
  const root = await mkdtemp(resolve(await realpath(tmpdir()), 'eky-v26-msi-query-contract-'));
  let removable = true;
  context.after(async () => { if (removable) await rm(root, { force: true, recursive: true }); });
  return { root, resultPath: resolve(root, 'activity.json'),
    async query(arguments_) {
      removable = false;
      const result = await runBoundedWindowsAdapterProcess({
        command: resolve(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        arguments: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...arguments_],
        cwd: root, timeoutMilliseconds: 30_000, terminationTimeoutMilliseconds: 5_000,
      });
      removable = result.directProcessAbsent === true;
      assert.deepEqual({ status: result.status, resultCode: result.resultCode, directProcessAbsent: result.directProcessAbsent },
        { status: 'completed', resultCode: 'processCompleted', directProcessAbsent: true },
        'read-only query must complete and exit before removing its fixture');
      return result.exitCode;
    } };
}

test('Windows MSI activity observation returns only schema and count and terminates', windows, async (context) => {
  const value = await fixture(context);
  assert.equal(await value.query(['-ResultPath', value.resultPath]), 0);
  const result = await readWorkspaceSuccessObject(value.resultPath, 'resultInvalid');
  assert.deepEqual(Object.keys(result).sort(), ['msiClientCount', 'schemaVersion']);
  assert.equal(result.schemaVersion, 1);
  assert.equal(Number.isSafeInteger(result.msiClientCount) && result.msiClientCount >= 0, true);
});

test('Windows MSI query never overwrites an existing result or its hardlink', windows, async (context) => {
  const value = await fixture(context);
  const sentinel = 'synthetic retained evidence';
  await writeFile(value.resultPath, sentinel);
  const alias = resolve(value.root, 'alias.json');
  await link(value.resultPath, alias);
  assert.equal(await value.query(['-ResultPath', value.resultPath]), 64);
  assert.equal(await readFile(value.resultPath, 'utf8'), sentinel);
  assert.equal(await readFile(alias, 'utf8'), sentinel);
});

test('Windows MSI query rejects a relative destination before writing', windows, async (context) => {
  const value = await fixture(context);
  assert.equal(await value.query(['-ResultPath', 'relative.json']), 64);
  await assert.rejects(() => readFile(resolve(value.root, 'relative.json')), { code: 'ENOENT' });
});

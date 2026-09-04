import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const WINDOWS_ONLY = { skip: process.platform !== 'win32', timeout: 10_000 };
const SCRIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'inspectWindowsInstallerProductState.ps1',
);

test(
  'Windows PowerShell 5.1 inspector writes a strict absent-product result',
  WINDOWS_ONLY,
  async (testContext) => {
    const root = await mkdtemp(join(tmpdir(), 'eky-v2-state-inspector-'));
    const resultPath = join(root, 'state.json');
    const powershell = resolve(
      process.env.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    let child;
    testContext.after(async () => {
      if (child?.exitCode === null && child.signalCode === null) {
        child.kill();
      }
      await rm(root, { force: true, recursive: true });
    });

    child = spawn(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT_PATH,
        '-ProductCode',
        '{00000000-0000-0000-0000-000000000000}',
        '-ResultPath',
        resultPath,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    const exitCode = await new Promise((resolvePromise, rejectPromise) => {
      child.once('error', rejectPromise);
      child.once('close', resolvePromise);
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(await readFile(resultPath, 'utf8')), {
      schemaVersion: 1,
      productState: -1,
      productName: null,
      productVersion: null,
      localPackagePresent: false,
      ownedRegistryExists: false,
      ekyProcessCount: 0,
    });
  },
);

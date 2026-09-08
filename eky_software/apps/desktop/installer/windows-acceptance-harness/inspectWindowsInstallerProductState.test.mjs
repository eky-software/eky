import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const WINDOWS_ONLY = { skip: process.platform !== 'win32', timeout: 20_000 };
const SCRIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'inspectWindowsInstallerProductState.ps1',
);

function runInspector(powershell, resultPath, { failProductState = false } = {}) {
  const queryFailureCommand = `
    function New-Object {
      param([string]$ComObject)
      if ($ComObject -cne 'WindowsInstaller.Installer') { throw 'unexpectedComRequest' }
      # A real COM handle without ProductState exercises the query failure and release.
      Microsoft.PowerShell.Utility\\New-Object -ComObject Scripting.Dictionary
    }
    & $env:EKY_TEST_INSPECTOR_SCRIPT -ProductCode '{00000000-0000-0000-0000-000000000000}' -ResultPath $env:EKY_TEST_INSPECTOR_RESULT
    exit $LASTEXITCODE
  `;
  const invocation = failProductState
    ? [
        '-EncodedCommand',
        Buffer.from(queryFailureCommand, 'utf16le').toString('base64'),
      ]
    : [
        '-File',
        SCRIPT_PATH,
        '-ProductCode',
        '{00000000-0000-0000-0000-000000000000}',
        '-ResultPath',
        resultPath,
      ];
  const child = spawn(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      ...invocation,
    ],
    {
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        EKY_TEST_INSPECTOR_SCRIPT: SCRIPT_PATH,
        EKY_TEST_INSPECTOR_RESULT: resultPath,
      },
    },
  );
  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise);
    child.once('close', resolvePromise);
  });
  return Object.freeze({ child, completion });
}

test(
  'Windows PowerShell 5.1 inspector distinguishes absent products from query failure',
  WINDOWS_ONLY,
  async (testContext) => {
    const root = await mkdtemp(join(tmpdir(), 'eky-v2-state-inspector-'));
    const resultPath = join(root, 'state.json');
    const transportedResultPath = join(root, 'transported-state.json').replaceAll(
      '\\',
      '\\\\',
    );
    const rejectedResultPath = `${join(root, 'parent')}\\..\\rejected.json`;
    const powershell = resolve(
      process.env.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const children = new Set();
    testContext.after(async () => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
        }
      }
      await rm(root, { force: true, recursive: true });
    });

    const canonicalRun = runInspector(powershell, resultPath);
    children.add(canonicalRun.child);
    const exitCode = await canonicalRun.completion;
    assert.equal(exitCode, 0);
    const expected = {
      schemaVersion: 1,
      productState: -1,
      productName: null,
      productVersion: null,
      localPackagePresent: false,
      ownedRegistryExists: false,
      ekyProcessCount: 0,
    };
    assert.deepEqual(JSON.parse(await readFile(resultPath, 'utf8')), expected);

    const transportedRun = runInspector(powershell, transportedResultPath);
    children.add(transportedRun.child);
    assert.equal(await transportedRun.completion, 0);
    assert.deepEqual(
      JSON.parse(
        await readFile(join(root, 'transported-state.json'), 'utf8'),
      ),
      expected,
    );

    const rejectedRun = runInspector(powershell, rejectedResultPath);
    children.add(rejectedRun.child);
    assert.equal(await rejectedRun.completion, 64);
    await assert.rejects(access(join(root, 'rejected.json')), { code: 'ENOENT' });

    const failedResultPath = join(root, 'query-failed.json');
    const failedRun = runInspector(powershell, failedResultPath, {
      failProductState: true,
    });
    children.add(failedRun.child);
    assert.equal(await failedRun.completion, 1);
    await assert.rejects(access(failedResultPath), { code: 'ENOENT' });
  },
);

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = join(scriptDirectory, '..', '..');
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test(
  'the detached fixed launcher reaches rollback validation without MSI work',
  { skip: process.platform !== 'win32' },
  async () => {
    const systemRoot = process.env.SystemRoot;
    assert.ok(systemRoot);
    const proofRoot = await mkdtemp(
      join(tmpdir(), 'eky-rollback-launcher-proof-'),
    );
    temporaryDirectories.push(proofRoot);
    const progressPath = join(proofRoot, 'rollback-progress.jsonl');
    const updateRuntimeDirectory = join(
      desktopDirectory,
      'resources',
      'update',
    );
    const commandPath = join(systemRoot, 'System32', 'cmd.exe');
    const msiExecPath = join(systemRoot, 'System32', 'msiexec.exe');
    const processHandle = spawn(
      commandPath,
      [
        '/d',
        '/q',
        '/v:off',
        '/s',
        '/c',
        'rollbackWindowsInstallerLauncher.cmd',
      ],
      {
        cwd: updateRuntimeDirectory,
        detached: true,
        env: {
          EKY_ROLLBACK_FAILED_PACKAGE_PATH: join(
            proofRoot,
            'missing-failed.msi',
          ),
          EKY_ROLLBACK_FAILED_PRODUCT_CODE:
            '{22222222-2222-4222-8222-222222222222}',
          EKY_ROLLBACK_LAUNCHER_PROCESS_ID: String(process.pid),
          EKY_ROLLBACK_MSIEXEC_PATH: msiExecPath,
          EKY_ROLLBACK_PROGRESS_PATH: progressPath,
          EKY_ROLLBACK_PACKAGE_PATH: join(
            proofRoot,
            'missing-rollback.msi',
          ),
          SystemRoot: systemRoot,
          windir: systemRoot,
        },
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    await waitUntilSpawned(processHandle);

    const rows = await waitForValidationFailure(progressPath);
    assert.deepEqual(
      rows.map(({ event, phase }) => ({ event, phase })),
      [
        { event: 'started', phase: 'inputValidation' },
        { event: 'failed', phase: 'inputValidation' },
      ],
    );
  },
);

function waitUntilSpawned(processHandle) {
  return new Promise((resolve, reject) => {
    processHandle.once('error', reject);
    processHandle.once('spawn', () => {
      processHandle.unref();
      resolve();
    });
  });
}

async function waitForValidationFailure(progressPath) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const rows = (await readFile(progressPath, 'utf8'))
        .trim()
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      if (
        rows.some(
          (row) =>
            row.phase === 'inputValidation' && row.event === 'failed',
        )
      ) {
        return rows;
      }
    } catch {
      // The detached launcher creates the bounded progress file asynchronously.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail('ROLLBACK_LAUNCHER_PROGRESS_MISSING');
}

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const executablePath = resolve(
  scriptDirectory,
  '../out/Eky-win32-x64/Eky.exe',
);
const smokeTimeoutMilliseconds = 60_000;
const childEnvironment = { ...process.env };
const smokeToken = randomBytes(16).toString('hex');
const smokeRootDirectory = resolve(
  tmpdir(),
  'eky-desktop-smoke',
  smokeToken,
);
const smokeResultPath = resolve(
  smokeRootDirectory,
  'result/desktop-smoke-result.json',
);

delete childEnvironment.ELECTRON_RUN_AS_NODE;
childEnvironment.ELECTRON_ENABLE_SECURITY_WARNINGS = 'true';
childEnvironment.EKY_DESKTOP_SMOKE_TOKEN = smokeToken;

async function readSmokeResult() {
  try {
    return JSON.parse(await readFile(smokeResultPath, 'utf8'));
  } catch {
    return undefined;
  }
}

try {
  await new Promise((resolveSmoke, rejectSmoke) => {
    const processHandle = spawn(
      executablePath,
      ['--desktop-smoke'],
      {
        env: childEnvironment,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const timer = setTimeout(async () => {
      processHandle.kill();
      const smokeResult = await readSmokeResult();
      const status =
        typeof smokeResult?.status === 'string'
          ? smokeResult.status
          : 'missing';
      const code =
        typeof smokeResult?.code === 'string' ? `/${smokeResult.code}` : '';

      rejectSmoke(
        new Error(`Packaged desktop smoke check timed out (${status}${code}).`),
      );
    }, smokeTimeoutMilliseconds);

    processHandle.once('error', (error) => {
      clearTimeout(timer);
      rejectSmoke(error);
    });
    processHandle.once('exit', async (code) => {
      clearTimeout(timer);

      const smokeResult = await readSmokeResult();

      if (smokeResult === undefined) {
        rejectSmoke(
          new Error(
            `Packaged desktop smoke check did not produce a result (code ${String(code)}).`,
          ),
        );
        return;
      }

      if (code !== 0 || smokeResult?.status !== 'ok') {
        const safeCode =
          typeof smokeResult?.code === 'string'
            ? smokeResult.code
            : 'DESKTOP_SMOKE_FAILED';
        rejectSmoke(
          new Error(
            `Packaged desktop smoke check failed (${safeCode}, code ${String(code)}).`,
          ),
        );
        return;
      }

      console.log('Packaged Windows smoke check passed.');
      resolveSmoke();
    });
  });
} finally {
  await rm(smokeRootDirectory, {
    force: true,
    maxRetries: 20,
    recursive: true,
    retryDelay: 100,
  });
}

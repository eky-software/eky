import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPackagedSmokeFailureMessage,
  createPackagedSmokeTimeoutMessage,
  readPackagedSmokeResult,
  resolvePackagedSmokeTempPath,
  writePackagedSmokeResult,
} from '../dist/main/packagedSmoke.js';
import { readDesktopElectronVersion } from './read-desktop-electron-version.mjs';
import { preparePackagedReleaseCandidateSmoke } from './packaged-release-candidate.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const executablePath = resolve(
  scriptDirectory,
  '../out/Eky-win32-x64/Eky.exe',
);
const smokeTimeoutMilliseconds = 120_000;
const childEnvironment = { ...process.env };
const smokeToken = randomBytes(16).toString('hex');
const smokeRootDirectory = resolve(
  resolvePackagedSmokeTempPath(tmpdir()),
  'eky-desktop-smoke',
  smokeToken,
);
const smokeResultPath = resolve(
  smokeRootDirectory,
  'result/desktop-smoke-result.json',
);
const expectedElectronVersion = await readDesktopElectronVersion();
const scriptArguments = process.argv.slice(2);
const releaseCandidateSmoke = scriptArguments.includes('--release-candidate');

if (
  scriptArguments.some((argument) => argument !== '--release-candidate') ||
  scriptArguments.filter((argument) => argument === '--release-candidate')
    .length > 1
) {
  throw new Error('Unsupported packaged smoke argument.');
}

delete childEnvironment.ELECTRON_RUN_AS_NODE;
childEnvironment.ELECTRON_ENABLE_SECURITY_WARNINGS = 'true';
childEnvironment.EKY_DESKTOP_SMOKE_TOKEN = smokeToken;

async function readSmokeResult() {
  try {
    return readPackagedSmokeResult(
      JSON.parse(await readFile(smokeResultPath, 'utf8')),
    );
  } catch {
    return undefined;
  }
}

try {
  if (releaseCandidateSmoke) {
    await preparePackagedReleaseCandidateSmoke({
      desktopDirectory: resolve(scriptDirectory, '..'),
      repositoryRoot: resolve(scriptDirectory, '../../..'),
      smokeUserDataPath: resolve(smokeRootDirectory, 'user-data'),
    });
  }
  await writePackagedSmokeResult(
    {
      enabled: true,
      phase: 'initial',
      root: smokeRootDirectory,
      userDataPath: undefined,
    },
    { stage: 'startup', status: 'started' },
  );
  await runSmokePhase(['--desktop-smoke'], 'restoreRestart');
  await runSmokePhase(
    ['--desktop-smoke', '--desktop-smoke-restored'],
    'shutdown',
  );
  console.log('Packaged Windows smoke check passed.');
} finally {
  await rm(smokeRootDirectory, {
    force: true,
    maxRetries: 20,
    recursive: true,
    retryDelay: 100,
  });
}

async function runSmokePhase(argumentsList, expectedStage) {
  await new Promise((resolveSmoke, rejectSmoke) => {
    const processHandle = spawn(
      executablePath,
      argumentsList,
      {
        env: childEnvironment,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const timer = setTimeout(async () => {
      processHandle.kill();
      const smokeResult = await readSmokeResult();

      rejectSmoke(new Error(createPackagedSmokeTimeoutMessage(smokeResult)));
    }, smokeTimeoutMilliseconds);

    processHandle.once('error', () => {
      clearTimeout(timer);
      rejectSmoke(
        new Error('Packaged desktop smoke process could not be started.'),
      );
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

      if (
        code !== 0 ||
        smokeResult.stage !== expectedStage ||
        (expectedStage === 'shutdown' &&
          (smokeResult.status !== 'ok' ||
            smokeResult.electronVersion !== expectedElectronVersion)) ||
        (expectedStage === 'restoreRestart' &&
          smokeResult.status !== 'started')
      ) {
        rejectSmoke(
          new Error(createPackagedSmokeFailureMessage(smokeResult, code)),
        );
        return;
      }

      resolveSmoke();
    });
  });
}

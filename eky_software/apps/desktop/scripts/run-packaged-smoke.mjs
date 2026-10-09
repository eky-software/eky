import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
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
import { observeSmokeOutput } from './packagedSmokeFailureEvidence.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const executablePath = resolve(
  scriptDirectory,
  '../out/Eky-win32-x64/Eky.exe',
);
const smokeTimeoutMilliseconds = 120_000;
export async function runPackagedSmoke({ releaseCandidateSmoke = false, legacyPreparation, workspaceRecoveryPreparation } = {}) {
  if (legacyPreparation !== undefined && workspaceRecoveryPreparation !== undefined) {
    throw new Error('PACKAGED_SMOKE_PREPARATION_CONFLICT');
  }
  const preparation = legacyPreparation ?? workspaceRecoveryPreparation;
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
  const phaseOutputs = [];
  let smokeSucceeded = false;

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
    await preparation?.prepare({ smokeToken, smokeRootDirectory });
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
    const scenarioSwitches = legacyPreparation === undefined ? [] : ['--desktop-smoke-legacy-invoice'];
    await runSmokePhase(['--desktop-smoke', ...scenarioSwitches], 'restoreRestart');
    await preparation?.afterRestoreExit({ smokeToken, smokeRootDirectory });
    await runSmokePhase(
      ['--desktop-smoke', '--desktop-smoke-restored', ...scenarioSwitches],
      'shutdown',
    );
    await preparation?.verifySourcePreserved();
    console.log('Packaged Windows smoke check passed.');
    smokeSucceeded = true;
  } catch (error) {
    try {
      await writeFile(resolve(smokeRootDirectory, 'smoke-output.private.json'), JSON.stringify({
        schemaVersion: 1, cleanup: 'notVerified', phases: phaseOutputs.map(read => read()),
      }), { flag: 'wx', mode: 0o600 });
    } catch { console.error('PACKAGED_SMOKE_PRIVATE_EVIDENCE_UNAVAILABLE'); }
    throw error;
  } finally {
    if (smokeSucceeded) await rm(smokeRootDirectory, {
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
      phaseOutputs.push(observeSmokeOutput(processHandle, expectedStage));
      let firstError;
      let exitObserved = false;
      let outputClosed = false;
      let resultChecked = false;
      let settled = false;
      let smokeResult;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (firstError) rejectSmoke(firstError);
        else resolveSmoke();
      };
      const finishAfterClose = () => {
        if (outputClosed && resultChecked) finish();
      };
      // The original phase deadline also bounds stdio drain and result inspection.
      const timer = setTimeout(() => {
        if (settled) return;
        firstError ??= new Error(createPackagedSmokeTimeoutMessage(smokeResult));
        try {
          if (!exitObserved) processHandle.kill();
        } catch {
          // Termination failure must not replace the first error; cleanup stays unverified.
        }
        finish();
      }, smokeTimeoutMilliseconds);

      processHandle.once('error', () => {
        if (settled) return;
        firstError ??= new Error('Packaged desktop smoke process could not be started.');
        resultChecked = true;
        finishAfterClose();
      });
      processHandle.once('exit', async (code) => {
        exitObserved = true;
        if (settled) return;
        // Reserve the observed exit failure before any asynchronous result read.
        const exitError = code !== 0
          ? new Error(createPackagedSmokeFailureMessage(undefined, code)) : undefined;
        firstError ??= exitError;
        smokeResult = await readSmokeResult();
        if (settled) return;
        let failureMessage;
        if (smokeResult === undefined) {
          failureMessage = `Packaged desktop smoke check did not produce a result (code ${String(code)}).`;
        } else if (
          code !== 0 ||
          smokeResult.stage !== expectedStage ||
          (expectedStage === 'shutdown' &&
            (smokeResult.status !== 'ok' ||
              smokeResult.electronVersion !== expectedElectronVersion)) ||
          (expectedStage === 'restoreRestart' &&
            smokeResult.status !== 'started')
        ) {
          failureMessage = createPackagedSmokeFailureMessage(smokeResult, code);
        }
        if (failureMessage !== undefined) {
          if (firstError === undefined) firstError = new Error(failureMessage);
          else if (firstError === exitError) firstError.message = failureMessage;
        }
        resultChecked = true;
        finishAfterClose();
      });
      processHandle.once('close', () => {
        outputClosed = true;
        finishAfterClose();
      });
    });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scriptArguments = process.argv.slice(2);
  if (scriptArguments.some(argument => argument !== '--release-candidate') ||
      scriptArguments.length > 1) throw new Error('Unsupported packaged smoke argument.');
  await runPackagedSmoke({ releaseCandidateSmoke: scriptArguments.includes('--release-candidate') });
}

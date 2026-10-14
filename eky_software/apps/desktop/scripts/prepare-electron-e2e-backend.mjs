import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareProfileInspectionNativeStage } from './prepareProfileInspectionNativeStage.mjs';
import { InspectionNativeCompilationFailure } from '../../backend/scripts/build-profile-inspection-native.mjs';
import { readInspectionNativeBuildFailure, windowsNativeCompilationBinding,
  validateNativePreparationEvidence } from './profileInspection/nativeBuildFailureEvidence.mjs';
import { ordinaryPath } from '../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';
import {
  inspectStagedBetterSqliteRuntime,
  verifyStagedBetterSqliteDatabase,
} from './staged-better-sqlite-runtime.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '../..');
const pnpmCliPath = process.env.npm_execpath;

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: { ...process.env, CI: 'true' },
      shell: false,
      stdio: 'inherit',
      ...options,
    });

    child.once('error', rejectRun);
    child.once('exit', (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${command} exited with code ${String(code)}.`));
    });
  });
}

function runPnpm(args) {
  if (pnpmCliPath === undefined || pnpmCliPath.trim() === '') {
    throw new Error('Run the Electron E2E preparation through pnpm.');
  }
  return run(process.execPath, [pnpmCliPath, ...args]);
}

export async function prepareElectronE2eBackend({
  root = repositoryRoot,
  runPnpmCommand = runPnpm,
  inspectRuntime = inspectStagedBetterSqliteRuntime,
  verifyDatabase = verifyStagedBetterSqliteDatabase,
  prepareNative = prepareProfileInspectionNativeStage,
  environment = process.env,
} = {}) {
  if (!isAbsolute(root)) throw new Error('ELECTRON_E2E_PREPARATION_ROOT_INVALID');
  const backendStage = resolve(root, 'apps/desktop/e2e-backend-stage');
  const nativeStage = resolve(root, 'apps/desktop/e2e-inspection-native-stage');
  await rm(backendStage, { force: true, recursive: true });
  await rm(nativeStage, { force: true, recursive: true });
  await mkdir(backendStage, { recursive: true });
  // The desktop candidate runner imports the packaged backend runtime from
  // backend/dist, so the stage must never reuse an earlier local build.
  await runPnpmCommand(['--filter', '@eky/backend', 'build']);
  await runPnpmCommand([
    '--filter',
    '@eky/backend',
    'deploy',
    '--prod',
    backendStage,
  ]);
  await cp(
    resolve(root, 'apps/backend/e2e-dist'),
    resolve(backendStage, 'e2e-dist'),
    { recursive: true },
  );

  const runtime = await inspectRuntime({ backendStage });
  const sqliteVersion = await verifyDatabase({ backendStage });
  const canonicalRoot = await realpath(root);
  const buildParent = resolve(canonicalRoot, '.eky-local/profile-inspection-native-builds');
  await mkdir(buildParent, { recursive: true, mode: 0o700 });
  await ordinaryPath(canonicalRoot, buildParent, true);
  const buildRoot = await realpath(await mkdtemp(resolve(buildParent, 'e2e-')));
  await ordinaryPath(canonicalRoot, buildRoot, true);
  const identity = await lstat(buildRoot, { bigint: true });
  try {
    await prepareNative({ backendStage, buildRoot, nativeStage });
  } catch (error) {
    const binding = windowsNativeCompilationBinding(environment);
    if (binding && error instanceof InspectionNativeCompilationFailure) {
      try {
        // The existing builder settles its synchronous compiler child before throwing.
        const invocationId = randomUUID();
        const evidence = { schemaVersion: 1, operation: 'electronE2ePreparation', status: 'failed',
          phase: 'nativeCompilation', causeCode: error.message, binding, invocationId,
          nativeCompilationEvidence: error.logSettled
            ? await readInspectionNativeBuildFailure(buildRoot, identity) : { status: 'unverified' } };
        validateNativePreparationEvidence(evidence, binding, invocationId);
        const destination = resolve(canonicalRoot, 'apps/e2e/test-results', `run-${invocationId}`, 'preparation');
        await mkdir(destination, { recursive: true, mode: 0o700 });
        await ordinaryPath(canonicalRoot, destination, true);
        await writeFile(resolve(destination, 'process-output.private.json'), JSON.stringify(evidence),
          { flag: 'wx', mode: 0o600 });
      } catch { /* Optional evidence must not replace the original preparation failure. */ }
    }
    throw error;
  }
  console.log(
    `Validated staged better-sqlite3 ${runtime.version} (SQLite ${sqliteVersion}).`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareElectronE2eBackend();
}

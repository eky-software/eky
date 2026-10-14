import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  rm,
} from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareProfileInspectionNativeStage } from './prepareProfileInspectionNativeStage.mjs';
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
  await prepareNative({
    backendStage,
    buildRoot: resolve(root, '.eky-local/profile-inspection-native-builds/e2e'),
    nativeStage,
  });
  console.log(
    `Validated staged better-sqlite3 ${runtime.version} (SQLite ${sqliteVersion}).`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareElectronE2eBackend();
}

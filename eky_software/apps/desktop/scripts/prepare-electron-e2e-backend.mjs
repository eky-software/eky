import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  rm,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  inspectStagedBetterSqliteRuntime,
  verifyStagedBetterSqliteDatabase,
} from './staged-better-sqlite-runtime.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '../..');
const backendStage = resolve(desktopDirectory, 'e2e-backend-stage');
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

async function prepareElectronE2eBackend() {
  await rm(backendStage, { force: true, recursive: true });
  await mkdir(backendStage, { recursive: true });
  await runPnpm([
    '--filter',
    '@eky/backend',
    'deploy',
    '--prod',
    backendStage,
  ]);
  await cp(
    resolve(repositoryRoot, 'apps/backend/e2e-dist'),
    resolve(backendStage, 'e2e-dist'),
    { recursive: true },
  );

  const runtime = await inspectStagedBetterSqliteRuntime({ backendStage });
  const sqliteVersion = await verifyStagedBetterSqliteDatabase({ backendStage });
  console.log(
    `Validated staged better-sqlite3 ${runtime.version} (SQLite ${sqliteVersion}).`,
  );
}

await prepareElectronE2eBackend();

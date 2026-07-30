import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readDesktopElectronVersion } from './read-desktop-electron-version.mjs';

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

async function findSinglePnpmPackageDirectory(rootDirectory, packageName) {
  const virtualStore = resolve(rootDirectory, 'node_modules/.pnpm');
  const entries = await readdir(virtualStore, { withFileTypes: true });
  const matches = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith(`${packageName}@`),
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(
      `Expected one staged ${packageName} package, found ${String(matches.length)}.`,
    );
  }
  return resolve(virtualStore, matches[0].name);
}

async function hashFile(filePath) {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function prepareElectronE2eBackend() {
  const electronVersion = await readDesktopElectronVersion();
  const workspaceBinding = resolve(
    repositoryRoot,
    'apps/backend/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  );
  const workspaceBindingHashBefore = await hashFile(workspaceBinding);

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

  const betterSqlitePackageDirectory =
    await findSinglePnpmPackageDirectory(backendStage, 'better-sqlite3');
  const prebuildInstallPackageDirectory =
    await findSinglePnpmPackageDirectory(backendStage, 'prebuild-install');
  const betterSqliteModuleDirectory = resolve(
    betterSqlitePackageDirectory,
    'node_modules/better-sqlite3',
  );
  const prebuildInstallEntryPoint = resolve(
    prebuildInstallPackageDirectory,
    'node_modules/prebuild-install/bin.js',
  );

  await run(
    process.execPath,
    [
      prebuildInstallEntryPoint,
      '--arch=x64',
      '--platform=win32',
      '--runtime=electron',
      `--target=${electronVersion}`,
    ],
    { cwd: betterSqliteModuleDirectory },
  );

  const workspaceBindingHashAfter = await hashFile(workspaceBinding);
  if (workspaceBindingHashAfter !== workspaceBindingHashBefore) {
    throw new Error(
      'Electron E2E preparation modified the workspace better-sqlite3 binding.',
    );
  }
}

await prepareElectronE2eBackend();

import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  flipFuses,
  FuseVersion,
  FuseV1Options,
  getCurrentFuseWire,
  FuseState,
} from '@electron/fuses';
import { packager } from '@electron/packager';

import { readDesktopElectronVersion } from './read-desktop-electron-version.mjs';

const electronVersion = await readDesktopElectronVersion();
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '../..');
const stagingRoot = resolve(desktopDirectory, '.stage');
const applicationStage = resolve(stagingRoot, 'application');
const backendStage = resolve(stagingRoot, 'backend');
const desktopRuntimeStage = resolve(stagingRoot, 'desktop-runtime');
const outputDirectory = resolve(desktopDirectory, 'out');
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
    throw new Error('Run the desktop packaging script through pnpm.');
  }

  return run(process.execPath, [pnpmCliPath, ...args]);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function hashFile(filePath) {
  const contents = await readFile(filePath);
  return createHash('sha256').update(contents).digest('hex');
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

async function rebuildStagedBetterSqlite() {
  const betterSqlitePackageDirectory = await findSinglePnpmPackageDirectory(
    backendStage,
    'better-sqlite3',
  );
  const prebuildInstallPackageDirectory = await findSinglePnpmPackageDirectory(
    backendStage,
    'prebuild-install',
  );
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
}

async function assertSafeBackendStage() {
  const files = await listFiles(backendStage);
  const unapprovedKeyringPackagePath = ['@napi-rs', 'keyring'].join('/');
  const forbiddenDependencyFile = files.find((filePath) =>
    relative(backendStage, filePath)
      .replaceAll('\\', '/')
      .toLowerCase()
      .includes(unapprovedKeyringPackagePath),
  );

  if (forbiddenDependencyFile !== undefined) {
    throw new Error(
      `Unapproved keyring dependency in backend stage: ${relative(
        backendStage,
        forbiddenDependencyFile,
      )}`,
    );
  }

  const forbiddenFile = files.find((filePath) => {
    const normalizedPath = relative(backendStage, filePath).replaceAll('\\', '/');
    const fileName = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1);
    const isProjectOwnedFile =
      !normalizedPath.startsWith('node_modules/') ||
      normalizedPath.includes('/node_modules/@eky/');
    const lowerPath = normalizedPath.toLowerCase();
    const containsE2eArtifact =
      lowerPath.startsWith('e2e/') ||
      lowerPath.startsWith('e2e-dist/') ||
      lowerPath.includes('/e2e/') ||
      lowerPath.includes('/e2e-dist/') ||
      lowerPath.includes('e2ebackend') ||
      lowerPath.includes('e2efaultplan');

    return (
      isProjectOwnedFile &&
      (fileName.startsWith('.env') ||
        fileName.endsWith('.sqlite') ||
        fileName.endsWith('.pdf') ||
        fileName.includes('.test.') ||
        containsE2eArtifact ||
        normalizedPath.startsWith('src/') ||
        normalizedPath.includes('/node_modules/@eky/') &&
          normalizedPath.includes('/src/'))
    );
  });

  if (forbiddenFile !== undefined) {
    throw new Error(
      `Forbidden development artifact in backend stage: ${relative(
        backendStage,
        forbiddenFile,
      )}`,
    );
  }
}

async function buildWorkspaceArtifacts() {
  await runPnpm(['--filter', '@eky/permissions', 'build']);
  await runPnpm(['--filter', '@eky/auth', 'build']);
  await runPnpm(['--filter', '@eky/backend', 'build']);
  await runPnpm(['--filter', '@eky/web', 'build']);
  await runPnpm(['--filter', '@eky/desktop', 'build']);
  await runPnpm([
    '--filter',
    '@eky/backend',
    'deploy',
    '--prod',
    backendStage,
  ]);
}

async function prepareApplicationStage(buildInfo) {
  await cp(resolve(desktopDirectory, 'dist'), join(applicationStage, 'dist'), {
    recursive: true,
  });
  await cp(resolve(repositoryRoot, 'apps/web/dist'), join(applicationStage, 'web'), {
    recursive: true,
  });
  await cp(
    resolve(desktopDirectory, 'dist/runtime'),
    join(desktopRuntimeStage, 'runtime'),
    {
      recursive: true,
    },
  );
  await cp(
    resolve(desktopDirectory, 'dist/secrets'),
    join(desktopRuntimeStage, 'secrets'),
    {
      recursive: true,
    },
  );
  await writeFile(
    join(desktopRuntimeStage, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(applicationStage, 'package.json'),
    `${JSON.stringify(
      {
        main: 'dist/main/index.js',
        name: 'eky-desktop',
        productName: 'Eky',
        type: 'module',
        version: buildInfo.appVersion,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(
    join(applicationStage, 'dist', 'build-info.json'),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
    'utf8',
  );
}

async function assertPackagedDiagnosticsArtifacts() {
  for (const relativePath of [
    'dist/diagnostics/desktopDiagnosticsTypes.js',
    'dist/diagnostics/operationalLogFolderCapability.js',
    'dist/build-info.json',
    'dist/main/desktopComposition.js',
    'dist/preload/index.cjs',
    'dist/supportBundle/supportBundleCapability.js',
    'web/index.html',
  ]) {
    await access(resolve(applicationStage, relativePath));
  }
}

async function applyAndVerifyFuses(executablePath) {
  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  });

  const fuseWire = await getCurrentFuseWire(executablePath);
  const expectedFuses = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
    [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
  ]);

  for (const [fuse, expectedState] of expectedFuses) {
    if (fuseWire[fuse] !== expectedState) {
      throw new Error(`Electron fuse ${String(fuse)} was not set as expected.`);
    }
  }
}

async function assertPackagedElectronVersion(packagedPath) {
  const packagedElectronVersion = (
    await readFile(join(packagedPath, 'version'), 'utf8')
  ).trim();

  if (packagedElectronVersion !== electronVersion) {
    throw new Error('Packaged Electron version did not match package metadata.');
  }
}

async function packageWindowsSpike() {
  const workspaceBetterSqliteBinding = resolve(
    repositoryRoot,
    'apps/backend/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  );
  const workspaceBindingHashBeforePackaging = await hashFile(
    workspaceBetterSqliteBinding,
  );
  await rm(stagingRoot, { force: true, recursive: true });
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(stagingRoot, { recursive: true });
  await buildWorkspaceArtifacts();
  const packageBuildInfoModule = await import(
    pathToFileURL(
      resolve(desktopDirectory, 'dist/release/packageBuildInfo.js'),
    ).href
  );
  const desktopPackageMetadata = JSON.parse(
    await readFile(resolve(desktopDirectory, 'package.json'), 'utf8'),
  );
  const appVersion =
    packageBuildInfoModule.readDesktopPackageVersion(desktopPackageMetadata);
  const buildInfo = await packageBuildInfoModule.createPackageBuildInfo({
    appVersion,
    repositoryRoot,
  });
  await assertSafeBackendStage();
  await rebuildStagedBetterSqlite();
  const workspaceBindingHashAfterPackaging = await hashFile(
    workspaceBetterSqliteBinding,
  );

  if (workspaceBindingHashAfterPackaging !== workspaceBindingHashBeforePackaging) {
    throw new Error(
      'Desktop packaging modified the workspace better-sqlite3 binding.',
    );
  }

  await prepareApplicationStage(buildInfo);
  await assertPackagedDiagnosticsArtifacts();

  const packagedPaths = await packager({
    appVersion,
    arch: 'x64',
    asar: true,
    dir: applicationStage,
    electronVersion,
    executableName: 'Eky',
    extraResource: [backendStage, desktopRuntimeStage],
    name: 'Eky',
    out: outputDirectory,
    overwrite: true,
    platform: 'win32',
    prune: false,
    win32metadata: {
      CompanyName: 'Eky',
      FileDescription: 'Eky Local',
      ProductName: 'Eky',
    },
  });

  if (packagedPaths.length !== 1 || packagedPaths[0] === undefined) {
    throw new Error('Expected exactly one packaged Windows application.');
  }

  const packagedPath = packagedPaths[0];
  const executablePath = join(packagedPath, 'Eky.exe');

  await assertPackagedElectronVersion(packagedPath);
  await applyAndVerifyFuses(executablePath);
  console.log(`Packaged Windows spike: ${packagedPath}`);
}

await packageWindowsSpike();

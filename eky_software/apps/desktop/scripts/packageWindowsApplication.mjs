import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  flipFuses,
  FuseVersion,
  FuseV1Options,
  getCurrentFuseWire,
  FuseState,
} from '@electron/fuses';
import { packager } from '@electron/packager';

import { readDesktopElectronVersion } from './read-desktop-electron-version.mjs';
import { INSTALLER_UPGRADE_CODE } from '../installer/installerIdentity.mjs';
import { readInstallerReleaseConfig } from '../installer/installerVersion.mjs';
import { inspectPackageArtifactInventory } from './package-artifact-inventory.mjs';
import {
  assertPilotBuildPreconditions,
  createPilotArtifactManifest,
  readPilotArtifactManifest,
} from './pilot-build-gate.mjs';
import {
  inspectStagedBetterSqliteRuntime,
  verifyStagedBetterSqliteDatabase,
} from './staged-better-sqlite-runtime.mjs';
import { preparePackageBackendStage } from './preparePackageBackendStage.mjs';
const electronVersion = await readDesktopElectronVersion();
const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '../..');
const defaultStagingRoot = resolve(desktopDirectory, '.stage');
const defaultOutputDirectory = resolve(desktopDirectory, 'out');
const pnpmCliPath = process.env.npm_execpath;
const profileSnapshotRuntimeFiles = [
  'electronProfileSnapshotBrokerTransport.js',
  'profileSnapshotBrokerBackend.js',
  'profileSnapshotBrokerProtocol.js',
  'profileSnapshotBrokerTransport.js',
];

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

export function createPackageLayout({ outputDirectory, stagingRoot }) {
  return Object.freeze({
    applicationStage: resolve(stagingRoot, 'application'),
    backendStage: resolve(stagingRoot, 'backend'),
    desktopRuntimeStage: resolve(stagingRoot, 'desktop-runtime'),
    outputDirectory: resolve(outputDirectory),
    stagingRoot: resolve(stagingRoot),
    updateRuntimeStage: resolve(stagingRoot, 'update-runtime'),
  });
}

async function assertSafeBackendStage(backendStage) {
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
}

async function buildWorkspaceArtifacts(backendStage) {
  await runPnpm(['--filter', '@eky/permissions', 'build']);
  await runPnpm(['--filter', '@eky/auth', 'build']);
  await runPnpm(['--filter', '@eky/backend', 'build']);
  await runPnpm(['--filter', '@eky/web', 'build']);
  await runPnpm(['--filter', '@eky/desktop', 'build']);
  await runPnpm([
    '--config.node-linker=hoisted',
    '--filter',
    '@eky/backend',
    'deploy',
    '--prod',
    backendStage,
  ]);
}

async function prepareApplicationStage(
  layout,
  buildInfo,
  packageMode,
  releaseInfo,
) {
  const {
    applicationStage,
    desktopRuntimeStage,
    updateRuntimeStage,
  } = layout;
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
  await cp(
    resolve(desktopDirectory, 'dist/invoicePdfArchive'),
    join(desktopRuntimeStage, 'invoicePdfArchive'),
    {
      recursive: true,
    },
  );
  await mkdir(join(desktopRuntimeStage, 'profileBackup'), {
    recursive: true,
  });
  for (const fileName of profileSnapshotRuntimeFiles) {
    await cp(
      resolve(desktopDirectory, 'dist/profileBackup', fileName),
      join(desktopRuntimeStage, 'profileBackup', fileName),
    );
  }
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
  await writeFile(
    join(applicationStage, 'dist', 'package-mode.json'),
    `${JSON.stringify(packageMode, null, 2)}\n`,
    'utf8',
  );
  if (releaseInfo !== undefined) {
    await writeFile(
      join(applicationStage, 'dist', 'release-info.json'),
      `${JSON.stringify(releaseInfo, null, 2)}\n`,
      'utf8',
    );
  }
  await mkdir(updateRuntimeStage, { recursive: true });
  await cp(
    resolve(
      desktopDirectory,
      'resources/update/inspectWindowsInstallerIdentity.ps1',
    ),
    join(updateRuntimeStage, 'inspectWindowsInstallerIdentity.ps1'),
  );
  await cp(
    resolve(
      desktopDirectory,
      'resources/update/inspectWindowsRegularFile.ps1',
    ),
    join(updateRuntimeStage, 'inspectWindowsRegularFile.ps1'),
  );
  await cp(
    resolve(
      desktopDirectory,
      'resources/update/launchRollbackWindowsInstaller.ps1',
    ),
    join(updateRuntimeStage, 'launchRollbackWindowsInstaller.ps1'),
  );
  await cp(
    resolve(
      desktopDirectory,
      'resources/update/rollbackWindowsInstaller.ps1',
    ),
    join(updateRuntimeStage, 'rollbackWindowsInstaller.ps1'),
  );
}

async function assertPackagedDiagnosticsArtifacts(layout, { hasReleaseInfo }) {
  const {
    applicationStage,
    desktopRuntimeStage,
    updateRuntimeStage,
  } = layout;
  const requiredArtifacts = [
    'dist/diagnostics/desktopDiagnosticsTypes.js',
    'dist/diagnostics/operationalLogFolderCapability.js',
    'dist/build-info.json',
    'dist/package-mode.json',
    'dist/main/desktopComposition.js',
    'dist/preload/index.cjs',
    'dist/profileBackup/passwordWindow/backupPasswordPreload.cjs',
    'dist/supportBundle/supportBundleCapability.js',
    'web/index.html',
  ];
  if (hasReleaseInfo) {
    requiredArtifacts.push('dist/release-info.json');
  }
  for (const relativePath of requiredArtifacts) {
    await access(resolve(applicationStage, relativePath));
  }

  for (const relativePath of [
    'invoicePdfArchive/invoicePdfArchiveBrokerClient.js',
    'invoicePdfArchive/invoicePdfArchiveBrokerProtocol.js',
    'invoicePdfArchive/electronInvoicePdfArchiveBrokerTransport.js',
    ...profileSnapshotRuntimeFiles.map(
      (fileName) => `profileBackup/${fileName}`,
    ),
  ]) {
    await access(resolve(desktopRuntimeStage, relativePath));
  }
  await access(
    resolve(updateRuntimeStage, 'inspectWindowsInstallerIdentity.ps1'),
  );
  await access(resolve(updateRuntimeStage, 'inspectWindowsRegularFile.ps1'));
  await access(
    resolve(updateRuntimeStage, 'launchRollbackWindowsInstaller.ps1'),
  );
  await access(resolve(updateRuntimeStage, 'rollbackWindowsInstaller.ps1'));
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

export async function packageWindowsApplication({
  layout,
  pilotBuild,
  prepareBackendStage,
  reportPackagedPath,
  releaseOverride,
}) {
  const {
    applicationStage,
    backendStage,
    desktopRuntimeStage,
    outputDirectory,
    stagingRoot,
    updateRuntimeStage,
  } = layout;
  await rm(stagingRoot, { force: true, recursive: true });
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(stagingRoot, { recursive: true });
  await buildWorkspaceArtifacts(backendStage);
  await preparePackageBackendStage({
    backendStage,
    prepareBackendStage,
  });
  const packageBuildInfoModule = await import(
    pathToFileURL(
      resolve(desktopDirectory, 'dist/release/packageBuildInfo.js'),
    ).href
  );
  const desktopPackageMetadata = JSON.parse(
    await readFile(resolve(desktopDirectory, 'package.json'), 'utf8'),
  );
  const canonicalAppVersion =
    packageBuildInfoModule.readDesktopPackageVersion(desktopPackageMetadata);
  const canonicalInstallerRelease = await readInstallerReleaseConfig(
    resolve(desktopDirectory, 'installer/installer-release.json'),
    resolve(desktopDirectory, 'package.json'),
  );
  const installerRelease = releaseOverride ?? canonicalInstallerRelease;
  const appVersion = releaseOverride?.appVersion ?? canonicalAppVersion;
  const buildInfo = await packageBuildInfoModule.createPackageBuildInfo({
    appVersion,
    repositoryRoot,
  });
  const packageModeModule = await import(
    pathToFileURL(
      resolve(desktopDirectory, 'dist/release/desktopPackageMode.js'),
    ).href
  );
  const packageMode = packageModeModule.createDesktopPackageModeInfo(
    pilotBuild ? 'pilot' : 'localDevelopment',
  );
  const releaseInfo = pilotBuild
    ? Object.freeze({
        appIdentity: installerRelease.appIdentity,
        appVersion: installerRelease.appVersion,
        architecture: installerRelease.architecture,
        buildRevision: buildInfo.buildRevision,
        msiProductVersion: installerRelease.msiProductVersion,
        platform: installerRelease.platform,
        releaseChannel: installerRelease.releaseChannel,
        schemaVersion: 1,
        upgradeCode: INSTALLER_UPGRADE_CODE,
      })
    : undefined;
  let currentHead;
  if (pilotBuild) {
    currentHead = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        windowsHide: true,
      })
    ).stdout.trim();
    assertPilotBuildPreconditions({ buildInfo, currentHead });
  }
  await assertSafeBackendStage(backendStage);
  await inspectPackageArtifactInventory({
    root: backendStage,
    stage: 'backendStage',
  });
  const runtime = await inspectStagedBetterSqliteRuntime({ backendStage });
  const sqliteVersion = await verifyStagedBetterSqliteDatabase({ backendStage });
  console.log(
    `Validated staged better-sqlite3 ${runtime.version} (SQLite ${sqliteVersion}).`,
  );

  await prepareApplicationStage(layout, buildInfo, packageMode, releaseInfo);
  await assertPackagedDiagnosticsArtifacts(layout, {
    hasReleaseInfo: pilotBuild,
  });
  await inspectPackageArtifactInventory({
    root: applicationStage,
    stage: 'applicationStage',
  });
  await inspectPackageArtifactInventory({
    root: desktopRuntimeStage,
    stage: 'desktopRuntimeStage',
  });
  await inspectPackageArtifactInventory({
    root: updateRuntimeStage,
    stage: 'updateRuntimeStage',
  });

  const packagedPaths = await packager({
    appVersion,
    arch: 'x64',
    asar: true,
    dir: applicationStage,
    electronVersion,
    executableName: 'Eky',
    extraResource: [backendStage, desktopRuntimeStage, updateRuntimeStage],
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
  const packagedInventory = await inspectPackageArtifactInventory({
    root: packagedPath,
    stage: 'packagedApp',
  });
  let manifestPath;
  if (pilotBuild) {
    assertPilotBuildPreconditions({ buildInfo, currentHead });
    const manifest = createPilotArtifactManifest({
      buildInfo,
      inventory: packagedInventory,
    });
    manifestPath = join(
      outputDirectory,
      'Eky-win32-x64.pilot-manifest.json',
    );
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await readPilotArtifactManifest(manifestPath, {
      buildInfo,
      inventory: packagedInventory,
    });
  }
  if (reportPackagedPath) {
    console.log(`Packaged Windows spike: ${packagedPath}`);
  }
  return Object.freeze({
    appVersion,
    buildInfo,
    installerRelease,
    manifestPath,
    packagedInventory,
    packagedPath,
  });
}

export async function packageDefaultWindowsApplication({
  pilotBuild,
  reportPackagedPath,
}) {
  return packageWindowsApplication(
    createDefaultPackageRequest({ pilotBuild, reportPackagedPath }),
  );
}

export function createDefaultPackageRequest({
  pilotBuild,
  reportPackagedPath,
}) {
  return Object.freeze({
    layout: createPackageLayout({
      outputDirectory: defaultOutputDirectory,
      stagingRoot: defaultStagingRoot,
    }),
    pilotBuild,
    reportPackagedPath,
  });
}

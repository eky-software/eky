import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';
import {
  INSTALLER_APP_IDENTITY,
  INSTALLER_UPGRADE_CODE,
  createInstallerProductCode,
} from '../installerIdentity.mjs';
import { readInstallerReleaseConfig } from '../installerVersion.mjs';
import { verifyLocalPilotReleaseBundle } from './createLocalPilotReleaseBundle.mjs';
import {
  HISTORICAL_WINDOWS_INSTALLER_FIXTURE,
  classifyHistoricalWindowsInstallerArtifact,
  createHistoricalWindowsInstallerFixtureProvenance,
  parseHistoricalWindowsInstallerFixtureProvenance,
} from './historicalWindowsInstallerFixtureProvenance.mjs';
import { withMaterializedHistoricalWindowsInstallerSource } from './materializeHistoricalWindowsInstallerSource.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const installerDirectory = resolve(scriptDirectory, '..');
const desktopDirectory = resolve(installerDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '..', '..');
const gitRepositoryRoot = resolve(repositoryRoot, '..');
const exactLocalBundleRoot = join(
  installerDirectory,
  'local-pilot-releases',
  'Eky-0.2.6-x64-local-unsigned-pilot',
);
const exactLocalInstallerFilename = 'Eky-0.2.6-x64.msi';
const exactLocalManifestFilename = 'Eky-0.2.6-x64.manifest.json';
const exactLocalChecksumFilename = 'Eky-0.2.6-x64.sha256.txt';
const maximumJsonBytes = 64 * 1024;
const maximumLegacyWindowsPathLength = 259;
const expectedNodeMajor = 24;
const expectedPnpmVersion = '11.1.3';
const expectedDotnetVersion = '10.0.302';
const expectedElectronVersion = '43.3.0';
const expectedBetterSqliteVersion = '13.0.2';
const expectedWixVersion = '7.0.0';
const lockedInputRelativePaths = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'global.json',
  'apps/backend/package.json',
  'apps/desktop/package.json',
  'apps/desktop/installer/installer-release.json',
  'apps/desktop/installer/installerIdentity.mjs',
  'apps/desktop/installer/Eky.Installer.wixproj',
  'apps/desktop/installer/NuGet.Config',
  'apps/desktop/installer/packages.lock.json',
]);

export const HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE = Object.freeze({
  appIdentity: INSTALLER_APP_IDENTITY,
  appVersion: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.appVersion,
  architecture: 'x64',
  msiProductVersion:
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.msiProductVersion,
  platform: 'win32',
  releaseChannel: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.releaseChannel,
});

export async function verifyExactLocalHistoricalWindowsInstallerFixture({
  inspectInstallerIdentity = inspectWindowsInstallerIdentity,
  localBundleRoot = exactLocalBundleRoot,
} = {}) {
  if (localBundleRoot !== exactLocalBundleRoot) {
    throw new Error('HISTORICAL_FIXTURE_LOCAL_BUNDLE_PATH_INVALID');
  }
  const verified = await verifyLocalPilotReleaseBundle({
    buildRevision: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    bundleDirectory: localBundleRoot,
    release: HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
  });
  const checksum = await readFile(
    join(localBundleRoot, exactLocalChecksumFilename),
    'utf8',
  );
  if (
    checksum !==
    `${HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedLocalMsiSha256}  ${exactLocalInstallerFilename}\n`
  ) {
    throw new Error('HISTORICAL_FIXTURE_LOCAL_CHECKSUM_MISMATCH');
  }
  const classification = classifyHistoricalWindowsInstallerArtifact({
    packageSha256: verified.manifest.packageSha256,
    source: 'local-release',
  });
  const identity = await inspectInstallerIdentity(verified.installerPath);
  validateHistoricalWindowsInstallerIdentity(identity);
  return Object.freeze({
    ...classification,
    appVersion: verified.manifest.appVersion,
    buildRevision: verified.manifest.buildRevision,
    installerPath: verified.installerPath,
    manifestPath: verified.manifestPath,
    packageSha256: verified.manifest.packageSha256,
    packageSize: verified.manifest.packageSize,
    productCode: identity.productCode,
    upgradeCode: identity.upgradeCode,
  });
}

export async function withHistoricalSourceWindowsInstallerFixture(
  task,
  dependencies = {},
) {
  if (typeof task !== 'function') {
    throw new Error('HISTORICAL_FIXTURE_TASK_INVALID');
  }
  return withMaterializedHistoricalWindowsInstallerSource(
    async (materialized) => {
      const source = await validateHistoricalWindowsInstallerSource(
        materialized.workspaceRoot,
      );
      const lockedInputs = await captureHistoricalLockedInputHashes(
        materialized.workspaceRoot,
      );
      await assertHistoricalSourceHasNoInstalledDependencies(
        materialized.workspaceRoot,
      );
      await (
        dependencies.installDependencies ?? installHistoricalDependencies
      )({ workspaceRoot: materialized.workspaceRoot });
      await assertHistoricalDependenciesAreIsolated(materialized.workspaceRoot);
      await assertHistoricalLockedInputsUnchanged({
        expected: lockedInputs,
        workspaceRoot: materialized.workspaceRoot,
      });

      await (dependencies.packageApplication ?? packageHistoricalApplication)({
        workspaceRoot: materialized.workspaceRoot,
      });
      await assertHistoricalPackagedApplicationPathBudget(
        join(
          materialized.workspaceRoot,
          'apps',
          'desktop',
          'out',
          'Eky-win32-x64',
        ),
      );
      await validateHistoricalPackagedApplication(materialized.workspaceRoot);
      await assertHistoricalLockedInputsUnchanged({
        expected: lockedInputs,
        workspaceRoot: materialized.workspaceRoot,
      });

      await (dependencies.restoreInstaller ?? restoreHistoricalInstaller)({
        workspaceRoot: materialized.workspaceRoot,
      });
      await assertHistoricalLockedInputsUnchanged({
        expected: lockedInputs,
        workspaceRoot: materialized.workspaceRoot,
      });

      const built = await (
        dependencies.buildInstallerRelease ?? buildHistoricalInstallerRelease
      )({ workspaceRoot: materialized.workspaceRoot });
      await validateHistoricalInstallerRelease(built);
      const identity = await (
        dependencies.inspectInstallerIdentity ?? inspectWindowsInstallerIdentity
      )(built.installerPath);
      validateHistoricalWindowsInstallerIdentity(identity);
      await assertHistoricalLockedInputsUnchanged({
        expected: lockedInputs,
        workspaceRoot: materialized.workspaceRoot,
      });

      const provenancePath = join(
        materialized.operationRoot,
        'historical-fixture-provenance.json',
      );
      const provenance = createHistoricalWindowsInstallerFixtureProvenance({
        sourceArchiveManifestSha256:
          materialized.provenance.sourceArchiveManifestSha256,
      });
      await writeFile(
        provenancePath,
        `${JSON.stringify(provenance, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      const persistedProvenance = parseHistoricalWindowsInstallerFixtureProvenance(
        await readBoundedJson(provenancePath),
      );
      const classification = classifyHistoricalWindowsInstallerArtifact({
        packageSha256: built.manifest.packageSha256,
        source: 'historical-source-rebuild',
      });
      const fixture = Object.freeze({
        ...classification,
        appVersion: built.manifest.appVersion,
        buildRevision: built.manifest.buildRevision,
        installerPath: built.installerPath,
        manifestPath: built.manifestPath,
        packageSha256: built.manifest.packageSha256,
        packageSize: built.manifest.packageSize,
        productCode: identity.productCode,
        provenance: persistedProvenance,
        provenancePath,
        sourceMetadata: source,
        upgradeCode: identity.upgradeCode,
      });
      return task(fixture);
    },
  );
}

export async function validateHistoricalWindowsInstallerSource(workspaceRoot) {
  await assertContainedHistoricalWorkspaceRoot(workspaceRoot);
  const [
    rootPackage,
    desktopPackage,
    backendPackage,
    globalJson,
    packagesLock,
    release,
    project,
    nugetConfig,
  ] = await Promise.all([
    readBoundedJson(join(workspaceRoot, 'package.json')),
    readBoundedJson(join(workspaceRoot, 'apps/desktop/package.json')),
    readBoundedJson(join(workspaceRoot, 'apps/backend/package.json')),
    readBoundedJson(join(workspaceRoot, 'global.json')),
    readBoundedJson(
      join(workspaceRoot, 'apps/desktop/installer/packages.lock.json'),
    ),
    readInstallerReleaseConfig(
      join(workspaceRoot, 'apps/desktop/installer/installer-release.json'),
      join(workspaceRoot, 'apps/desktop/package.json'),
    ),
    readBoundedText(
      join(workspaceRoot, 'apps/desktop/installer/Eky.Installer.wixproj'),
    ),
    readBoundedText(
      join(workspaceRoot, 'apps/desktop/installer/NuGet.Config'),
    ),
  ]);
  validateHistoricalSourceMetadata({
    backendPackage,
    desktopPackage,
    globalJson,
    nugetConfig,
    packagesLock,
    project,
    release,
    rootPackage,
  });
  const identityModule = await import(
    `${pathToFileURL(
      join(
        workspaceRoot,
        'apps/desktop/installer/installerIdentity.mjs',
      ),
    ).href}?fixture=${Date.now().toString(10)}`
  );
  if (
    identityModule.INSTALLER_APP_IDENTITY !== INSTALLER_APP_IDENTITY ||
    identityModule.INSTALLER_UPGRADE_CODE !== INSTALLER_UPGRADE_CODE ||
    identityModule.createInstallerProductCode(
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.msiProductVersion,
    ) !==
      createInstallerProductCode(
        HISTORICAL_WINDOWS_INSTALLER_FIXTURE.msiProductVersion,
      )
  ) {
    throw new Error('HISTORICAL_FIXTURE_INSTALLER_IDENTITY_MISMATCH');
  }
  return Object.freeze({
    betterSqliteVersion: backendPackage.dependencies['better-sqlite3'],
    dotnetVersion: globalJson.sdk.version,
    electronVersion: desktopPackage.devDependencies.electron,
    nodeRange: rootPackage.engines.node,
    pnpmVersion: rootPackage.packageManager.slice('pnpm@'.length),
    release,
    wixVersion: expectedWixVersion,
  });
}

export function validateHistoricalSourceMetadata({
  backendPackage,
  desktopPackage,
  globalJson,
  nugetConfig,
  packagesLock,
  project,
  release,
  rootPackage,
}) {
  if (
    !isRecord(rootPackage) ||
    rootPackage.packageManager !== `pnpm@${expectedPnpmVersion}` ||
    !isRecord(rootPackage.engines) ||
    rootPackage.engines.node !== '>=24 <25' ||
    !isRecord(desktopPackage) ||
    desktopPackage.version !== HISTORICAL_WINDOWS_INSTALLER_FIXTURE.appVersion ||
    !isRecord(desktopPackage.devDependencies) ||
    desktopPackage.devDependencies.electron !== expectedElectronVersion ||
    !isRecord(backendPackage) ||
    !isRecord(backendPackage.dependencies) ||
    backendPackage.dependencies['better-sqlite3'] !==
      expectedBetterSqliteVersion ||
    !sameJson(globalJson, {
      sdk: {
        allowPrerelease: false,
        rollForward: 'disable',
        version: expectedDotnetVersion,
      },
    }) ||
    !sameJson(packagesLock, {
      dependencies: { 'native,Version=v0.0': {} },
      version: 1,
    }) ||
    !sameJson(release, HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE)
  ) {
    throw new Error('HISTORICAL_FIXTURE_SOURCE_METADATA_MISMATCH');
  }
  if (
    typeof project !== 'string' ||
    !project.includes(`Project Sdk="WixToolset.Sdk/${expectedWixVersion}"`) ||
    !project.includes('<RestoreLockedMode>true</RestoreLockedMode>') ||
    typeof nugetConfig !== 'string' ||
    !nugetConfig.includes(
      '<add key="signatureValidationMode" value="require" />',
    ) ||
    (nugetConfig.match(/<add key="nuget\.org"/gu) ?? []).length !== 1 ||
    !nugetConfig.includes(
      'value="https://api.nuget.org/v3/index.json"',
    ) ||
    !nugetConfig.includes('<package pattern="WixToolset.Sdk" />') ||
    !nugetConfig.includes('<author name="FireGiant">')
  ) {
    throw new Error('HISTORICAL_FIXTURE_TOOLCHAIN_POLICY_MISMATCH');
  }
}

export function validateHistoricalWindowsInstallerIdentity(value) {
  const expectedProductCode = `{${createInstallerProductCode(
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.msiProductVersion,
  )}}`;
  const expectedUpgradeCode = `{${INSTALLER_UPGRADE_CODE}}`;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 5 ||
    value.architecture !== 'x64' ||
    value.packageScope !== 'perUser' ||
    typeof value.productCode !== 'string' ||
    value.productCode.toUpperCase() !== expectedProductCode ||
    value.productVersion !==
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.msiProductVersion ||
    typeof value.upgradeCode !== 'string' ||
    value.upgradeCode.toUpperCase() !== expectedUpgradeCode
  ) {
    throw new Error('HISTORICAL_FIXTURE_INSTALLER_IDENTITY_MISMATCH');
  }
  return Object.freeze({ ...value });
}

export function validateHistoricalPackagedApplicationIdentity({
  buildInfo,
  packageModePresent,
  pilotManifestPresent,
  releaseInfo,
}) {
  const expectedReleaseInfo = {
    ...HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
    buildRevision: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    schemaVersion: 1,
    upgradeCode: INSTALLER_UPGRADE_CODE,
  };
  if (
    !isRecord(buildInfo) ||
    !hasExactKeys(buildInfo, [
      'appVersion',
      'buildCreatedAt',
      'buildDirty',
      'buildRevision',
      'schemaVersion',
    ]) ||
    buildInfo.appVersion !== HISTORICAL_WINDOWS_INSTALLER_FIXTURE.appVersion ||
    typeof buildInfo.buildCreatedAt !== 'string' ||
    !isCanonicalIsoTimestamp(buildInfo.buildCreatedAt) ||
    buildInfo.buildRevision !==
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit ||
    buildInfo.buildDirty !== false ||
    buildInfo.schemaVersion !== 1 ||
    !isRecord(releaseInfo) ||
    !sameJson(releaseInfo, expectedReleaseInfo) ||
    packageModePresent !== false ||
    pilotManifestPresent !== false ||
    !hasExactKeys(releaseInfo, Object.keys(expectedReleaseInfo))
  ) {
    throw new Error('HISTORICAL_FIXTURE_PACKAGE_IDENTITY_MISMATCH');
  }
  return Object.freeze({ buildInfo, releaseInfo });
}

export async function captureHistoricalLockedInputHashes(workspaceRoot) {
  const result = {};
  for (const relativePath of lockedInputRelativePaths) {
    const absolutePath = join(workspaceRoot, ...relativePath.split('/'));
    await assertRegularFile(absolutePath, 'HISTORICAL_FIXTURE_LOCKED_INPUT_INVALID');
    result[relativePath] = (await hashFileSha256(absolutePath)).sha256;
  }
  return Object.freeze(result);
}

export async function assertHistoricalLockedInputsUnchanged({
  expected,
  workspaceRoot,
}) {
  const current = await captureHistoricalLockedInputHashes(workspaceRoot);
  if (!sameJson(current, expected)) {
    throw new Error('HISTORICAL_FIXTURE_LOCKED_INPUT_CHANGED');
  }
}

async function installHistoricalDependencies({ workspaceRoot }) {
  const toolchain = await resolveHistoricalJavaScriptToolchain(workspaceRoot);
  await runProcess(
    process.execPath,
    [toolchain.pnpmCliPath, 'install', '--frozen-lockfile'],
    {
      code: 'HISTORICAL_FIXTURE_FROZEN_INSTALL_FAILED',
      cwd: workspaceRoot,
      environment: process.env,
    },
  );
}

async function packageHistoricalApplication({ workspaceRoot }) {
  const toolchain = await resolveHistoricalJavaScriptToolchain(workspaceRoot);
  await runProcess(
    process.execPath,
    [
      toolchain.pnpmCliPath,
      '--filter',
      '@eky/desktop',
      'package:windows',
    ],
    {
      code: 'HISTORICAL_FIXTURE_PACKAGE_FAILED',
      cwd: workspaceRoot,
      environment: {
        ...process.env,
        EKY_BUILD_REVISION:
          HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
      },
    },
  );
}

async function restoreHistoricalInstaller({ workspaceRoot }) {
  const dotnetExecutable = process.env.EKY_DOTNET_EXE ?? 'dotnet';
  await assertHistoricalDotnetToolchain({
    dotnetExecutable,
    workspaceRoot,
  });
  await runProcess(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(
        workspaceRoot,
        'apps/desktop/installer/scripts/verifyLockedInstallerRestore.ps1',
      ),
      '-DotnetExecutable',
      dotnetExecutable,
    ],
    {
      code: 'HISTORICAL_FIXTURE_LOCKED_RESTORE_FAILED',
      cwd: workspaceRoot,
      environment: process.env,
    },
  );
}

async function buildHistoricalInstallerRelease({ workspaceRoot }) {
  const dotnetExecutable = process.env.EKY_DOTNET_EXE ?? 'dotnet';
  const releaseModule = await import(
    `${pathToFileURL(
      join(
        workspaceRoot,
        'apps/desktop/installer/scripts/releaseWindowsInstaller.mjs',
      ),
    ).href}?fixture=${Date.now().toString(10)}`
  );
  const previousDotnetExecutable = process.env.EKY_DOTNET_EXE;
  process.env.EKY_DOTNET_EXE = dotnetExecutable;
  try {
    return await releaseModule.createWindowsInstallerRelease({
      buildRevision: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    });
  } finally {
    if (previousDotnetExecutable === undefined) {
      delete process.env.EKY_DOTNET_EXE;
    } else {
      process.env.EKY_DOTNET_EXE = previousDotnetExecutable;
    }
  }
}

async function validateHistoricalInstallerRelease(built) {
  if (
    !isRecord(built) ||
    !isRecord(built.manifest) ||
    !sameJson(built.release, HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE) ||
    typeof built.installerPath !== 'string' ||
    typeof built.manifestPath !== 'string'
  ) {
    throw new Error('HISTORICAL_FIXTURE_INSTALLER_RELEASE_INVALID');
  }
  const manifest = await readInstallerManifest(built.manifestPath);
  await verifyInstallerManifestPackage({
    expectedBuildRevision:
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    expectedRelease: HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
    installerPath: built.installerPath,
    manifest,
  });
  if (
    manifest.packageSha256 !== built.manifest.packageSha256 ||
    manifest.packageSize !== built.manifest.packageSize
  ) {
    throw new Error('HISTORICAL_FIXTURE_INSTALLER_RELEASE_INVALID');
  }
}

async function validateHistoricalPackagedApplication(workspaceRoot) {
  const stageRoot = join(workspaceRoot, 'apps/desktop/.stage/application/dist');
  const buildInfo = await readBoundedJson(join(stageRoot, 'build-info.json'));
  const releaseInfo = await readBoundedJson(join(stageRoot, 'release-info.json'));
  const outputRoot = join(workspaceRoot, 'apps/desktop/out');
  await assertRegularFile(
    join(outputRoot, 'Eky-win32-x64/Eky.exe'),
    'HISTORICAL_FIXTURE_PACKAGE_OUTPUT_INVALID',
  );
  const packageModePresent =
    (await lstat(join(stageRoot, 'package-mode.json')).catch(() => null)) !==
    null;
  const pilotManifestPresent =
    (await lstat(
      join(outputRoot, 'Eky-win32-x64.pilot-manifest.json'),
    ).catch(() => null)) !== null;
  validateHistoricalPackagedApplicationIdentity({
    buildInfo,
    packageModePresent,
    pilotManifestPresent,
    releaseInfo,
  });
}

async function inspectWindowsInstallerIdentity(installerPath) {
  await assertRegularFile(
    installerPath,
    'HISTORICAL_FIXTURE_INSTALLER_ARTIFACT_INVALID',
  );
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(
          desktopDirectory,
          'resources/update/inspectWindowsInstallerIdentity.ps1',
        ),
        '-MsiPath',
        installerPath,
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: maximumJsonBytes,
        windowsHide: true,
      },
    ));
  } catch {
    throw new Error('HISTORICAL_FIXTURE_INSTALLER_INSPECTION_FAILED');
  }
  try {
    return validateHistoricalWindowsInstallerIdentity(JSON.parse(stdout));
  } catch {
    throw new Error('HISTORICAL_FIXTURE_INSTALLER_INSPECTION_FAILED');
  }
}

async function resolveHistoricalJavaScriptToolchain(workspaceRoot) {
  if (Number(process.versions.node.split('.')[0]) !== expectedNodeMajor) {
    throw new Error('HISTORICAL_FIXTURE_NODE_VERSION_MISMATCH');
  }
  const pnpmCliPath = process.env.npm_execpath;
  if (
    typeof pnpmCliPath !== 'string' ||
    pnpmCliPath.length === 0 ||
    !isAbsolute(pnpmCliPath)
  ) {
    throw new Error('HISTORICAL_FIXTURE_PNPM_UNAVAILABLE');
  }
  await assertRegularFile(
    pnpmCliPath,
    'HISTORICAL_FIXTURE_PNPM_UNAVAILABLE',
  );
  let version;
  try {
    version = (
      await execFileAsync(process.execPath, [pnpmCliPath, '--version'], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        maxBuffer: 1024,
        windowsHide: true,
      })
    ).stdout.trim();
  } catch {
    throw new Error('HISTORICAL_FIXTURE_PNPM_UNAVAILABLE');
  }
  if (version !== expectedPnpmVersion) {
    throw new Error('HISTORICAL_FIXTURE_PNPM_VERSION_MISMATCH');
  }
  return Object.freeze({ pnpmCliPath, version });
}

async function assertHistoricalDotnetToolchain({
  dotnetExecutable,
  workspaceRoot,
}) {
  if (
    typeof dotnetExecutable !== 'string' ||
    dotnetExecutable.length === 0 ||
    (!isAbsolute(dotnetExecutable) && dotnetExecutable !== 'dotnet')
  ) {
    throw new Error('HISTORICAL_FIXTURE_DOTNET_UNAVAILABLE');
  }
  let version;
  try {
    version = (
      await execFileAsync(dotnetExecutable, ['--version'], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        maxBuffer: 1024,
        windowsHide: true,
      })
    ).stdout.trim();
  } catch {
    throw new Error('HISTORICAL_FIXTURE_DOTNET_UNAVAILABLE');
  }
  if (version !== expectedDotnetVersion) {
    throw new Error('HISTORICAL_FIXTURE_DOTNET_VERSION_MISMATCH');
  }
}

async function assertHistoricalSourceHasNoInstalledDependencies(workspaceRoot) {
  if (
    (await lstat(join(workspaceRoot, 'node_modules')).catch(() => null)) !==
    null
  ) {
    throw new Error('HISTORICAL_FIXTURE_NODE_MODULES_PRESENT');
  }
}

async function assertHistoricalDependenciesAreIsolated(workspaceRoot) {
  const nodeModulesPath = join(workspaceRoot, 'node_modules');
  const metadata = await lstat(nodeModulesPath).catch(() => null);
  if (metadata === null || metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('HISTORICAL_FIXTURE_DEPENDENCY_INSTALL_INVALID');
  }
  const canonicalWorkspaceRoot = await realpath(workspaceRoot);
  const canonicalNodeModules = await realpath(nodeModulesPath);
  assertContainedPath(canonicalWorkspaceRoot, canonicalNodeModules);
}

async function assertContainedHistoricalWorkspaceRoot(workspaceRoot) {
  const historicalStageRoot = join(
    repositoryRoot,
    'apps',
    'desktop',
    '.stage',
    'w6b',
    'historical-source',
  );
  const resolvedRoot = resolve(workspaceRoot);
  const relativeRoot = relative(historicalStageRoot, resolvedRoot);
  const segments = relativeRoot.split(sep);
  if (
    segments.length !== 3 ||
    !/^[0-9a-f]{16}$/u.test(segments[0] ?? '') ||
    segments[1] !== 's' ||
    segments[2] !== 'eky_software' ||
    join(historicalStageRoot, ...segments) !== resolvedRoot
  ) {
    throw new Error('HISTORICAL_FIXTURE_WORKSPACE_ROOT_INVALID');
  }
}

async function assertHistoricalPackagedApplicationPathBudget(root) {
  const canonicalRoot = await realpath(root).catch(() => null);
  if (canonicalRoot === null) {
    throw new Error('HISTORICAL_FIXTURE_PACKAGE_OUTPUT_INVALID');
  }
  const pending = [canonicalRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) {
      throw new Error('HISTORICAL_FIXTURE_PACKAGE_OUTPUT_INVALID');
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) {
        throw new Error('HISTORICAL_FIXTURE_PACKAGE_OUTPUT_INVALID');
      }
      const canonicalPath = await realpath(entryPath);
      assertContainedPath(canonicalRoot, canonicalPath);
      if (canonicalPath.length > maximumLegacyWindowsPathLength) {
        throw new Error('HISTORICAL_FIXTURE_WINDOWS_PATH_BUDGET_EXCEEDED');
      }
      if (metadata.isDirectory()) {
        pending.push(canonicalPath);
      } else if (!metadata.isFile()) {
        throw new Error('HISTORICAL_FIXTURE_PACKAGE_OUTPUT_INVALID');
      }
    }
  }
}

async function readBoundedJson(path) {
  try {
    return JSON.parse(await readBoundedText(path));
  } catch {
    throw new Error('HISTORICAL_FIXTURE_JSON_INVALID');
  }
}

async function readBoundedText(path) {
  await assertRegularFile(path, 'HISTORICAL_FIXTURE_INPUT_MISSING');
  const bytes = await readFile(path);
  if (bytes.length < 1 || bytes.length > maximumJsonBytes) {
    throw new Error('HISTORICAL_FIXTURE_INPUT_INVALID');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('HISTORICAL_FIXTURE_INPUT_INVALID');
  }
}

async function assertRegularFile(path, code) {
  const metadata = await lstat(path).catch(() => null);
  if (
    metadata === null ||
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size < 1
  ) {
    throw new Error(code);
  }
}

async function hashFileSha256(path) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return Object.freeze({ sha256: hash.digest('hex'), size });
}

function assertContainedPath(root, candidate) {
  const relativePath = relative(root, candidate);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(root, relativePath) !== candidate
  ) {
    throw new Error('HISTORICAL_FIXTURE_CONTAINMENT_FAILED');
  }
}

function runProcess(command, args, { code, cwd, environment }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...environment, CI: 'true' },
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', () => rejectPromise(new Error(code)));
    child.once('exit', (exitCode, signal) => {
      if (exitCode === 0 && signal === null) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(code));
    });
  });
}

function sameJson(left, right) {
  return (
    JSON.stringify(canonicalizeJson(left)) ===
    JSON.stringify(canonicalizeJson(right))
  );
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    );
  }
  return value;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}

function isCanonicalIsoTimestamp(value) {
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

export const HISTORICAL_WINDOWS_INSTALLER_FIXTURE_INTERNALS = Object.freeze({
  exactLocalBundleRoot,
  exactLocalInstallerFilename,
  exactLocalManifestFilename,
  gitRepositoryRoot,
  lockedInputRelativePaths,
});

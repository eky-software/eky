import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  INSTALLER_APP_IDENTITY,
  INSTALLER_UPGRADE_CODE,
  createInstallerProductCode,
} from '../installerIdentity.mjs';
import { readInstallerReleaseConfig } from '../installerVersion.mjs';
import { HISTORICAL_WINDOWS_INSTALLER_FIXTURE } from './historicalWindowsInstallerFixtureProvenance.mjs';
import {
  HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY,
  sameHistoricalFixtureJson,
  validateHistoricalSourceMetadata,
} from './historicalWindowsInstallerFixturePolicy.mjs';

const execFileAsync = promisify(execFile);

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
    readHistoricalFixtureJson(join(workspaceRoot, 'package.json')),
    readHistoricalFixtureJson(join(workspaceRoot, 'apps/desktop/package.json')),
    readHistoricalFixtureJson(join(workspaceRoot, 'apps/backend/package.json')),
    readHistoricalFixtureJson(join(workspaceRoot, 'global.json')),
    readHistoricalFixtureJson(
      join(workspaceRoot, 'apps/desktop/installer/packages.lock.json'),
    ),
    readInstallerReleaseConfig(
      join(workspaceRoot, 'apps/desktop/installer/installer-release.json'),
      join(workspaceRoot, 'apps/desktop/package.json'),
    ),
    readHistoricalFixtureText(
      join(workspaceRoot, 'apps/desktop/installer/Eky.Installer.wixproj'),
    ),
    readHistoricalFixtureText(
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
    wixVersion:
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY.expectedWixVersion,
  });
}

export async function captureHistoricalLockedInputHashes(workspaceRoot) {
  const result = {};
  for (const relativePath of
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY.lockedInputRelativePaths) {
    const absolutePath = join(workspaceRoot, ...relativePath.split('/'));
    await assertHistoricalFixtureRegularFile(
      absolutePath,
      'HISTORICAL_FIXTURE_LOCKED_INPUT_INVALID',
    );
    result[relativePath] =
      (await hashHistoricalFixtureFileSha256(absolutePath)).sha256;
  }
  return Object.freeze(result);
}

export async function assertHistoricalLockedInputsUnchanged({
  expected,
  workspaceRoot,
}) {
  const current = await captureHistoricalLockedInputHashes(workspaceRoot);
  if (!sameHistoricalFixtureJson(current, expected)) {
    throw new Error('HISTORICAL_FIXTURE_LOCKED_INPUT_CHANGED');
  }
}

export async function resolveHistoricalJavaScriptToolchain(workspaceRoot) {
  if (
    Number(process.versions.node.split('.')[0]) !==
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY.expectedNodeMajor
  ) {
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
  await assertHistoricalFixtureRegularFile(
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
  if (
    version !==
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY.expectedPnpmVersion
  ) {
    throw new Error('HISTORICAL_FIXTURE_PNPM_VERSION_MISMATCH');
  }
  return Object.freeze({ pnpmCliPath, version });
}

export async function assertHistoricalDotnetToolchain({
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
  if (
    version !==
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY.expectedDotnetVersion
  ) {
    throw new Error('HISTORICAL_FIXTURE_DOTNET_VERSION_MISMATCH');
  }
}

export async function assertHistoricalSourceHasNoInstalledDependencies(
  workspaceRoot,
) {
  if (
    (await lstat(join(workspaceRoot, 'node_modules')).catch(() => null)) !==
    null
  ) {
    throw new Error('HISTORICAL_FIXTURE_NODE_MODULES_PRESENT');
  }
}

export async function assertHistoricalDependenciesAreIsolated(workspaceRoot) {
  const nodeModulesPath = join(workspaceRoot, 'node_modules');
  const metadata = await lstat(nodeModulesPath).catch(() => null);
  if (
    metadata === null ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory()
  ) {
    throw new Error('HISTORICAL_FIXTURE_DEPENDENCY_INSTALL_INVALID');
  }
  const canonicalWorkspaceRoot = await realpath(workspaceRoot);
  const canonicalNodeModules = await realpath(nodeModulesPath);
  assertHistoricalFixtureContainedPath(
    canonicalWorkspaceRoot,
    canonicalNodeModules,
  );
}

export async function readHistoricalFixtureJson(path) {
  try {
    return JSON.parse(await readHistoricalFixtureText(path));
  } catch {
    throw new Error('HISTORICAL_FIXTURE_JSON_INVALID');
  }
}

export async function assertHistoricalFixtureRegularFile(path, code) {
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

export function assertHistoricalFixtureContainedPath(root, candidate) {
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

export function runHistoricalToolchainProcess(
  command,
  args,
  { code, cwd, environment },
) {
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

async function assertContainedHistoricalWorkspaceRoot(workspaceRoot) {
  const historicalStageRoot = join(
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY.repositoryRoot,
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

async function readHistoricalFixtureText(path) {
  await assertHistoricalFixtureRegularFile(
    path,
    'HISTORICAL_FIXTURE_INPUT_MISSING',
  );
  const bytes = await readFile(path);
  if (
    bytes.length < 1 ||
    bytes.length >
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY.maximumJsonBytes
  ) {
    throw new Error('HISTORICAL_FIXTURE_INPUT_INVALID');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('HISTORICAL_FIXTURE_INPUT_INVALID');
  }
}

async function hashHistoricalFixtureFileSha256(path) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return Object.freeze({ sha256: hash.digest('hex'), size });
}

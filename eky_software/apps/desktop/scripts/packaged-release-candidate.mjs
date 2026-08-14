import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { inspectPackageArtifactInventory } from './package-artifact-inventory.mjs';
import { readPilotArtifactManifest } from './pilot-build-gate.mjs';

const execFileAsync = promisify(execFile);
const numericVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const revisionPattern = /^[0-9a-f]{7,40}$/;

export function selectPreviousReleaseIdentity(currentVersion, history) {
  const parsedCurrent = parseNumericVersion(currentVersion);

  for (const entry of history) {
    if (!isReleaseHistoryEntry(entry)) {
      throw new Error('RELEASE_CANDIDATE_HISTORY_INVALID');
    }
    const parsedVersion = parseNumericVersion(entry.appVersion);
    const comparison = compareNumericVersions(parsedVersion, parsedCurrent);

    if (comparison === 0) {
      continue;
    }
    if (comparison > 0) {
      throw new Error('RELEASE_CANDIDATE_HISTORY_INVALID');
    }
    return Object.freeze({
      appVersion: entry.appVersion,
      buildRevision: entry.buildRevision,
    });
  }

  throw new Error('RELEASE_CANDIDATE_PREVIOUS_RELEASE_UNAVAILABLE');
}

export function createPriorAcceptedBuildMetadata(identity, acceptedAt) {
  if (
    !isReleaseHistoryEntry(identity) ||
    typeof acceptedAt !== 'string' ||
    !isUtcTimestamp(acceptedAt)
  ) {
    throw new Error('RELEASE_CANDIDATE_ACCEPTED_BUILD_INVALID');
  }

  return Object.freeze({
    acceptedAt,
    appVersion: identity.appVersion,
    buildRevision: identity.buildRevision,
    formatVersion: 1,
    releaseChannel: 'pilot',
  });
}

export async function preparePackagedReleaseCandidateSmoke(input) {
  const desktopDirectory = resolve(input.desktopDirectory);
  const repositoryRoot = resolve(input.repositoryRoot);
  const packageRoot = resolve(desktopDirectory, 'out/Eky-win32-x64');
  const manifestPath = resolve(
    desktopDirectory,
    'out/Eky-win32-x64.pilot-manifest.json',
  );
  const packageMetadata = JSON.parse(
    await readFile(resolve(desktopDirectory, 'package.json'), 'utf8'),
  );
  const currentVersion = readPackageVersion(packageMetadata);
  const currentHead = (
    await readGit(repositoryRoot, ['rev-parse', 'HEAD'])
  ).trim();
  const status = await readGit(repositoryRoot, ['status', '--porcelain']);

  if (status !== '') {
    throw new Error('RELEASE_CANDIDATE_WORKTREE_DIRTY');
  }

  const inventory = await inspectPackageArtifactInventory({
    root: packageRoot,
    stage: 'packagedApp',
  });
  const buildRevision = currentHead.slice(0, 12);
  await readPilotArtifactManifest(manifestPath, {
    buildInfo: {
      appVersion: currentVersion,
      buildDirty: false,
      buildRevision,
    },
    inventory,
  });

  const packagePathPrefix = (
    await readGit(repositoryRoot, ['rev-parse', '--show-prefix'])
  ).trim();
  const packagePath = `${packagePathPrefix}apps/desktop/package.json`;
  const revisions = (
    await readGit(repositoryRoot, [
      'log',
      '--first-parent',
      '--format=%H',
      '--',
      `:(top)${packagePath}`,
    ])
  )
    .trim()
    .split(/\r?\n/u)
    .filter((revision) => revision !== '');
  const history = [];

  for (const revision of revisions) {
    const historicalPackage = JSON.parse(
      await readGit(repositoryRoot, ['show', `${revision}:${packagePath}`]),
    );
    history.push({
      appVersion: readPackageVersion(historicalPackage),
      buildRevision: revision.slice(0, 12),
    });
  }

  const previousRelease = selectPreviousReleaseIdentity(
    currentVersion,
    history,
  );
  const acceptedBuild = createPriorAcceptedBuildMetadata(
    previousRelease,
    new Date().toISOString(),
  );
  const updateStateRoot = resolve(input.smokeUserDataPath, 'update-state');
  const acceptedBuildPath = resolve(
    updateStateRoot,
    'accepted-build-v1.json',
  );

  assertPathBelowRoot(acceptedBuildPath, input.smokeUserDataPath);
  await mkdir(updateStateRoot, { mode: 0o700, recursive: true });
  await writeFile(
    acceptedBuildPath,
    `${JSON.stringify(acceptedBuild)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );

  return Object.freeze({
    currentVersion,
    previousVersion: previousRelease.appVersion,
  });
}

function readPackageVersion(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('version' in value) ||
    typeof value.version !== 'string'
  ) {
    throw new Error('RELEASE_CANDIDATE_PACKAGE_VERSION_INVALID');
  }
  parseNumericVersion(value.version);
  return value.version;
}

function parseNumericVersion(value) {
  if (typeof value !== 'string' || !numericVersionPattern.test(value)) {
    throw new Error('RELEASE_CANDIDATE_VERSION_INVALID');
  }
  return value.split('.').map((part) => Number.parseInt(part, 10));
}

function compareNumericVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

function isReleaseHistoryEntry(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    typeof value.appVersion === 'string' &&
    numericVersionPattern.test(value.appVersion) &&
    typeof value.buildRevision === 'string' &&
    revisionPattern.test(value.buildRevision)
  );
}

function assertPathBelowRoot(path, root) {
  const relativePath = relative(resolve(root), resolve(path));
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('RELEASE_CANDIDATE_PATH_INVALID');
  }
}

function isUtcTimestamp(value) {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

async function readGit(repositoryRoot, args) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.stdout;
  } catch {
    throw new Error('RELEASE_CANDIDATE_GIT_IDENTITY_UNAVAILABLE');
  }
}

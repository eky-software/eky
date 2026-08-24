import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  HISTORICAL_WINDOWS_INSTALLER_FIXTURE,
  createHistoricalWindowsInstallerFixtureProvenance,
} from './historicalWindowsInstallerFixtureProvenance.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..', '..', '..');
const gitRepositoryRoot = resolve(repositoryRoot, '..');
const stageRoot = join(
  repositoryRoot,
  'apps',
  'desktop',
  '.stage',
  'w6b',
  'historical-source',
);
const allowedGitModes = new Set(['100644', '100755']);
const fullRevisionPattern = /^[0-9a-f]{40}$/;
const operationIdPattern = /^[0-9a-f]{16}$/;
const maximumManifestBytes = 64 * 1024 * 1024;
const maximumSourceFileBytes = 64 * 1024 * 1024;
const maximumSourceBytes = 512 * 1024 * 1024;
const lfsPointerPrefix = 'version https://git-lfs.github.com/spec/v1\n';

export async function withMaterializedHistoricalWindowsInstallerSource(
  task,
) {
  if (typeof task !== 'function') {
    throw new Error('HISTORICAL_SOURCE_TASK_INVALID');
  }
  const materialized = await materializeHistoricalWindowsInstallerSource();
  try {
    return await task(materialized);
  } finally {
    await removeHistoricalSourceOperation(materialized.operationRoot);
  }
}

export async function materializeHistoricalWindowsInstallerSource() {
  const operationId = randomBytes(8).toString('hex');
  if (!operationIdPattern.test(operationId)) {
    throw new Error('HISTORICAL_SOURCE_OPERATION_ID_INVALID');
  }
  const operationRoot = join(stageRoot, operationId);
  const archivePath = join(operationRoot, 'source.tar');
  const sourceRoot = join(operationRoot, 's');

  try {
    await assertOperationRootIsNew(operationRoot);
    await mkdir(sourceRoot, { recursive: true });
    const manifest = await readApprovedHistoricalTreeManifest();
    await runGit([
      'archive',
      '--format=tar',
      `--output=${archivePath}`,
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    ]);
    await extractArchive({ archivePath, sourceRoot });
    await validateExtractedHistoricalSource({
      entries: manifest.entries,
      sourceRoot,
    });

    return Object.freeze({
      operationRoot,
      provenance: createHistoricalWindowsInstallerFixtureProvenance({
        sourceArchiveManifestSha256: manifest.manifestSha256,
      }),
      sourceRoot,
      workspaceRoot: join(sourceRoot, 'eky_software'),
    });
  } catch (error) {
    await removeHistoricalSourceOperation(operationRoot).catch(() => {});
    if (isSafeHistoricalSourceError(error)) {
      throw error;
    }
    throw new Error('HISTORICAL_SOURCE_MATERIALIZATION_FAILED');
  }
}

export function parseHistoricalGitTreeManifest(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('HISTORICAL_SOURCE_TREE_MANIFEST_INVALID');
  }
  if (buffer.length > maximumManifestBytes || buffer.at(-1) !== 0) {
    throw new Error('HISTORICAL_SOURCE_TREE_MANIFEST_INVALID');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries = [];
  let totalSize = 0;
  let offset = 0;
  while (offset < buffer.length) {
    const terminator = buffer.indexOf(0, offset);
    if (terminator < 0 || terminator === offset) {
      throw new Error('HISTORICAL_SOURCE_TREE_MANIFEST_INVALID');
    }
    let record;
    try {
      record = decoder.decode(buffer.subarray(offset, terminator));
    } catch {
      throw new Error('HISTORICAL_SOURCE_TREE_PATH_INVALID');
    }
    const separatorIndex = record.indexOf('\t');
    if (separatorIndex < 0) {
      throw new Error('HISTORICAL_SOURCE_TREE_MANIFEST_INVALID');
    }
    const header = record.slice(0, separatorIndex).split(/ +/u);
    const path = record.slice(separatorIndex + 1);
    if (header.length !== 4) {
      throw new Error('HISTORICAL_SOURCE_TREE_MANIFEST_INVALID');
    }
    const [mode, type, objectId, sizeText] = header;
    if (
      !allowedGitModes.has(mode) ||
      type !== 'blob' ||
      !fullRevisionPattern.test(objectId)
    ) {
      throw new Error('HISTORICAL_SOURCE_TREE_ENTRY_FORBIDDEN');
    }
    const size = Number(sizeText);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > maximumSourceFileBytes
    ) {
      throw new Error('HISTORICAL_SOURCE_TREE_SIZE_INVALID');
    }
    totalSize += size;
    if (totalSize > maximumSourceBytes) {
      throw new Error('HISTORICAL_SOURCE_TREE_SIZE_INVALID');
    }
    validateHistoricalSourcePath(path);
    entries.push(Object.freeze({ mode, objectId, path, size }));
    offset = terminator + 1;
  }
  const sortedPaths = entries.map((entry) => entry.path).sort();
  if (new Set(sortedPaths).size !== sortedPaths.length) {
    throw new Error('HISTORICAL_SOURCE_TREE_MANIFEST_INVALID');
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    manifestSha256: createHash('sha256').update(buffer).digest('hex'),
    totalSize,
  });
}

export async function validateExtractedHistoricalSource({
  entries,
  sourceRoot,
}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('HISTORICAL_SOURCE_TREE_MANIFEST_INVALID');
  }
  const canonicalRoot = await realpath(sourceRoot).catch(() => {
    throw new Error('HISTORICAL_SOURCE_EXTRACTED_ROOT_INVALID');
  });
  const extractedPaths = await collectExtractedFiles({
    canonicalRoot,
    directory: canonicalRoot,
  });
  const expectedPaths = entries.map((entry) => entry.path).sort();
  if (
    extractedPaths.length !== expectedPaths.length ||
    extractedPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    throw new Error('HISTORICAL_SOURCE_EXTRACTED_INVENTORY_MISMATCH');
  }
  for (const entry of entries) {
    const filePath = join(canonicalRoot, ...entry.path.split('/'));
    const metadata = await lstat(filePath).catch(() => {
      throw new Error('HISTORICAL_SOURCE_EXTRACTED_INVENTORY_MISMATCH');
    });
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size !== entry.size
    ) {
      throw new Error('HISTORICAL_SOURCE_EXTRACTED_FILE_INVALID');
    }
    const bytes = await readFile(filePath);
    if (
      bytes.subarray(0, lfsPointerPrefix.length).toString('utf8') ===
      lfsPointerPrefix
    ) {
      throw new Error('HISTORICAL_SOURCE_LFS_POINTER_FORBIDDEN');
    }
    if (createGitBlobObjectId(bytes) !== entry.objectId) {
      throw new Error('HISTORICAL_SOURCE_EXTRACTED_FILE_MISMATCH');
    }
  }
  return Object.freeze({ fileCount: entries.length });
}

export function createGitBlobObjectId(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error('HISTORICAL_SOURCE_BLOB_INVALID');
  }
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

export function assertApprovedHistoricalSourceIdentity({
  commit,
  isAncestor,
  tree,
}) {
  if (
    commit !== HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit ||
    !fullRevisionPattern.test(commit) ||
    isAncestor !== true
  ) {
    throw new Error('HISTORICAL_SOURCE_COMMIT_INVALID');
  }
  if (
    tree !== HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedTree ||
    !fullRevisionPattern.test(tree)
  ) {
    throw new Error('HISTORICAL_SOURCE_TREE_MISMATCH');
  }
}

async function readApprovedHistoricalTreeManifest() {
  const objectType = (await runGitText([
    'cat-file',
    '-t',
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
  ])).trim();
  if (objectType !== 'commit') {
    throw new Error('HISTORICAL_SOURCE_COMMIT_INVALID');
  }
  const currentHead = (await runGitText(['rev-parse', 'HEAD'])).trim();
  if (!fullRevisionPattern.test(currentHead)) {
    throw new Error('HISTORICAL_SOURCE_CURRENT_REVISION_INVALID');
  }
  let isAncestor = true;
  try {
    await runGit([
      'merge-base',
      '--is-ancestor',
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
      currentHead,
    ]);
  } catch {
    isAncestor = false;
  }
  const tree = (await runGitText([
    'rev-parse',
    `${HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit}^{tree}`,
  ])).trim();
  assertApprovedHistoricalSourceIdentity({
    commit: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    isAncestor,
    tree,
  });
  const { stdout } = await runGit([
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    '--long',
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
  ], { encoding: 'buffer' });
  return parseHistoricalGitTreeManifest(stdout);
}

async function collectExtractedFiles({ canonicalRoot, directory }) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    const metadata = await lstat(entryPath);
    if (metadata.isSymbolicLink()) {
      throw new Error('HISTORICAL_SOURCE_EXTRACTED_LINK_FORBIDDEN');
    }
    const canonicalPath = await realpath(entryPath);
    assertContainedPath(canonicalRoot, canonicalPath);
    if (metadata.isDirectory()) {
      result.push(
        ...(await collectExtractedFiles({
          canonicalRoot,
          directory: canonicalPath,
        })),
      );
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error('HISTORICAL_SOURCE_EXTRACTED_FILE_TYPE_FORBIDDEN');
    }
    const relativePath = relative(canonicalRoot, canonicalPath).split(sep).join('/');
    validateHistoricalSourcePath(relativePath);
    result.push(relativePath);
  }
  return result.sort();
}

function validateHistoricalSourcePath(path) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 512 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f<>:"|?*]/u.test(path)
  ) {
    throw new Error('HISTORICAL_SOURCE_TREE_PATH_INVALID');
  }
  const segments = path.split('/');
  if (
    segments.some((segment) =>
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.endsWith('.') ||
      segment.endsWith(' ') ||
      segment.toLowerCase() === '.git' ||
      segment.toLowerCase() === '.gitmodules' ||
      segment.toLowerCase() === 'node_modules' ||
      isWindowsReservedName(segment)
    )
  ) {
    throw new Error('HISTORICAL_SOURCE_TREE_PATH_INVALID');
  }
}

function isWindowsReservedName(segment) {
  const stem = segment.split('.')[0].toLowerCase();
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(stem);
}

function assertContainedPath(root, candidate) {
  const relativePath = relative(root, candidate);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(root, relativePath) !== candidate
  ) {
    throw new Error('HISTORICAL_SOURCE_CONTAINMENT_FAILED');
  }
}

async function assertOperationRootIsNew(operationRoot) {
  const stageMetadata = await lstat(stageRoot).catch(() => null);
  if (stageMetadata !== null && !stageMetadata.isDirectory()) {
    throw new Error('HISTORICAL_SOURCE_STAGE_ROOT_INVALID');
  }
  const operationMetadata = await lstat(operationRoot).catch(() => null);
  if (operationMetadata !== null) {
    throw new Error('HISTORICAL_SOURCE_OPERATION_ALREADY_EXISTS');
  }
}

async function removeHistoricalSourceOperation(operationRoot) {
  assertContainedOperationRoot(operationRoot);
  await rm(operationRoot, { force: true, recursive: true });
}

function assertContainedOperationRoot(operationRoot) {
  const relativePath = relative(stageRoot, operationRoot);
  if (
    !operationIdPattern.test(relativePath) ||
    join(stageRoot, relativePath) !== operationRoot
  ) {
    throw new Error('HISTORICAL_SOURCE_OPERATION_ROOT_INVALID');
  }
}

async function extractArchive({ archivePath, sourceRoot }) {
  try {
    await execFileAsync(
      process.platform === 'win32' ? 'tar.exe' : 'tar',
      ['-xf', archivePath, '-C', sourceRoot],
      {
        cwd: gitRepositoryRoot,
        encoding: 'buffer',
        maxBuffer: maximumManifestBytes,
        windowsHide: true,
      },
    );
  } catch {
    throw new Error('HISTORICAL_SOURCE_ARCHIVE_EXTRACTION_FAILED');
  }
}

async function runGit(args, { encoding = 'utf8' } = {}) {
  try {
    return await execFileAsync('git', args, {
      cwd: gitRepositoryRoot,
      encoding,
      maxBuffer: maximumManifestBytes,
      windowsHide: true,
    });
  } catch (error) {
    if (error?.code === 1 && args[0] === 'merge-base') {
      throw error;
    }
    throw new Error('HISTORICAL_SOURCE_GIT_COMMAND_FAILED');
  }
}

async function runGitText(args) {
  const { stdout } = await runGit(args);
  return stdout;
}

function isSafeHistoricalSourceError(error) {
  return (
    error instanceof Error &&
    /^HISTORICAL_(FIXTURE|SOURCE)_[A-Z0-9_]+$/u.test(error.message)
  );
}

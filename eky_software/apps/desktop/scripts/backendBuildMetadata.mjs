import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BACKEND_BUILD_METADATA_PATHS = Object.freeze([
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'node_modules/.modules.yaml',
]);

const maximumManifestBytes = 262_144;
const dependencyFields = Object.freeze([
  'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
]);
const sourcePackages = Object.freeze([
  ['@eky/backend', 'apps/backend'],
  ['@eky/auth', 'packages/auth'],
  ['@eky/permissions', 'packages/permissions'],
]);
const sourceSnapshots = new WeakMap();
const errorPrefix = 'BACKEND_BUILD_METADATA_';

class MetadataError extends Error {
  constructor(reason) {
    super(`${errorPrefix}${reason}`);
    this.code = this.message;
  }
}

function fail(reason) {
  throw new MetadataError(reason);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function encodeManifest(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseManifest(bytes, { canonical, expectedName }) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 ||
        bytes.byteLength > maximumManifestBytes) fail('MANIFEST_INVALID');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!isRecord(value) || value.name !== expectedName ||
        !isRecord(value.dependencies ?? {})) fail('MANIFEST_INVALID');
    for (const field of dependencyFields) {
      if (!Object.hasOwn(value, field)) continue;
      if (!isRecord(value[field])) fail('MANIFEST_INVALID');
      for (const [name, specifier] of Object.entries(value[field])) {
        if (name.length === 0 || typeof specifier !== 'string' ||
            specifier.length === 0 || specifier.trim() !== specifier ||
            /[\u0000-\u001f\u007f]/u.test(specifier)) fail('MANIFEST_INVALID');
      }
    }
    // This is the pinned deploy writer's format, not a general JSON format rule.
    if (canonical && !encodeManifest(value).equals(Buffer.from(bytes))) {
      fail('MANIFEST_INVALID');
    }
    return value;
  } catch {
    fail('MANIFEST_INVALID');
  }
}

function isLocalSpecifier(specifier) {
  if (specifier === 'workspace:*') return false;
  return /(?:^|[@(])(?:file|git\+file|link|portal|workspace):/iu.test(specifier) ||
    /\\/u.test(specifier) ||
    /(?:^|[@(])(?:\/|\.{1,2}(?:\/|$)|~(?:\/|$)|[a-z]:)/iu.test(specifier);
}

export function assertBackendManifestHasNoBuildPaths(bytes) {
  const manifest = parseManifest(bytes, { canonical: true, expectedName: '@eky/backend' });
  for (const field of dependencyFields) {
    for (const specifier of Object.values(manifest[field] ?? {})) {
      if (isLocalSpecifier(specifier)) fail('BUILD_PATH');
    }
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFile(left, right) {
  return sameIdentity(left, right) && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink;
}

function contains(root, path) {
  const remainder = relative(root, path);
  return remainder === '' ||
    (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`));
}

async function optionalStat(path) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function inspectDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('STAGE_INVALID');
  const absolutePath = resolve(path);
  const ancestors = [];
  for (let current = absolutePath; ; current = dirname(current)) {
    ancestors.unshift(current);
    if (dirname(current) === current) break;
  }
  const directories = [];
  for (const ancestor of ancestors) {
    const metadata = await lstat(ancestor, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail('STAGE_INVALID');
    directories.push({ path: ancestor, metadata });
  }
  const canonicalPath = await realpath(absolutePath);
  if (relative(absolutePath, canonicalPath) !== '') fail('STAGE_INVALID');
  return { path: canonicalPath, directories };
}

async function assertDirectoryUnchanged(directory) {
  const current = await inspectDirectory(directory.path);
  if (current.directories.length !== directory.directories.length ||
      current.directories.some((entry, index) =>
        !sameIdentity(entry.metadata, directory.directories[index].metadata))) {
    fail('STAGE_INVALID');
  }
}

async function inspectFile(path, { optional = false, singleLink = true } = {}) {
  const metadata = await optionalStat(path);
  if (metadata === undefined) {
    if (!optional) fail('STAGE_INVALID');
    return { path, metadata };
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() ||
      (singleLink && metadata.nlink !== 1n) ||
      relative(path, await realpath(path)) !== '') fail('STAGE_INVALID');
  return { path, metadata };
}

async function assertFileUnchanged(file, options) {
  const current = await inspectFile(file.path, { optional: true, ...options });
  if (file.metadata === undefined ? current.metadata !== undefined :
      current.metadata === undefined || !sameFile(file.metadata, current.metadata)) {
    fail('STAGE_INVALID');
  }
}

async function readManifestFile(path, { singleLink = true } = {}) {
  const file = await inspectFile(path, { singleLink });
  if (file.metadata.size < 2n || file.metadata.size > BigInt(maximumManifestBytes)) {
    fail('MANIFEST_INVALID');
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFile(file.metadata, opened)) fail('STAGE_INVALID');
    const buffer = Buffer.alloc(maximumManifestBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length !== Number(opened.size) || length > maximumManifestBytes ||
        !sameFile(opened, await handle.stat({ bigint: true }))) fail('MANIFEST_INVALID');
    await assertFileUnchanged(file, { singleLink });
    return { ...file, bytes: Buffer.from(buffer.subarray(0, length)) };
  } finally {
    await handle.close();
  }
}

function validateSourceDeclarations(manifests) {
  const expected = [
    ['@eky/auth', '@eky/permissions'],
    ['@eky/permissions'],
    [],
  ];
  for (const [index, manifest] of manifests.entries()) {
    for (const name of expected[index]) {
      if (manifest.dependencies?.[name] !== 'workspace:*') fail('SOURCE_INVALID');
    }
    for (const field of dependencyFields) {
      for (const [name, value] of Object.entries(manifest[field] ?? {})) {
        if (isLocalSpecifier(value) || (value === 'workspace:*' &&
            (field !== 'dependencies' || !expected[index].includes(name)))) {
          fail('SOURCE_INVALID');
        }
      }
    }
  }
}

export async function captureBackendBuildMetadataSource({ repositoryRoot }) {
  try {
    const root = await inspectDirectory(repositoryRoot);
    const files = [];
    const manifests = [];
    for (const [name, path] of sourcePackages) {
      const directory = await inspectDirectory(join(root.path, path));
      const file = await readManifestFile(join(directory.path, 'package.json'), { singleLink: false });
      manifests.push(parseManifest(file.bytes, { canonical: false, expectedName: name }));
      files.push({ ...file, directory });
    }
    validateSourceDeclarations(manifests);
    const mappings = sourcePackages.slice(1).map(([name], index) => ({
      name,
      expected: `${name}@${pathToFileURL(files[index + 1].directory.path).href}`,
      restored: manifests[0].dependencies[name],
    }));
    const snapshot = Object.freeze({});
    sourceSnapshots.set(snapshot, { root, files, mappings });
    return snapshot;
  } catch {
    fail('SOURCE_INVALID');
  }
}

async function assertSourceUnchanged(source) {
  try {
    await assertDirectoryUnchanged(source.root);
    for (const file of source.files) {
      await assertDirectoryUnchanged(file.directory);
      const current = await readManifestFile(file.path, { singleLink: false });
      if (!sameFile(file.metadata, current.metadata) || !file.bytes.equals(current.bytes)) {
        fail('SOURCE_CHANGED');
      }
    }
  } catch {
    fail('SOURCE_CHANGED');
  }
}

function normalizeManifest(bytes, mappings) {
  const manifest = parseManifest(bytes, { canonical: true, expectedName: '@eky/backend' });
  for (const { name, expected, restored } of mappings) {
    const actual = manifest.dependencies?.[name];
    if (actual !== expected && actual !== restored) fail('UNKNOWN_TRANSFORM');
    manifest.dependencies[name] = restored;
  }
  for (const field of dependencyFields) {
    for (const [name, value] of Object.entries(manifest[field] ?? {})) {
      if (value === 'workspace:*' && (field !== 'dependencies' ||
          !mappings.some((mapping) => mapping.name === name))) fail('UNKNOWN_TRANSFORM');
    }
  }
  const normalized = encodeManifest(manifest);
  assertBackendManifestHasNoBuildPaths(normalized);
  return normalized;
}

export async function normalizeBackendBuildMetadata({ backendStage, source }) {
  const snapshot = sourceSnapshots.get(source);
  if (snapshot === undefined) fail('SOURCE_INVALID');
  let mutationStarted = false;
  try {
    const root = await inspectDirectory(backendStage);
    if (snapshot.files.some((file) => contains(root.path, file.path))) fail('STAGE_INVALID');
    const modulesPath = join(root.path, 'node_modules');
    const modules = await optionalStat(modulesPath) === undefined
      ? undefined : await inspectDirectory(modulesPath);
    const manifest = await readManifestFile(join(root.path, 'package.json'));
    const normalized = normalizeManifest(manifest.bytes, snapshot.mappings);
    const metadataFiles = [];
    for (const path of BACKEND_BUILD_METADATA_PATHS) {
      metadataFiles.push(await inspectFile(join(root.path, path), { optional: true }));
    }
    const validateDirectories = async () => {
      await assertDirectoryUnchanged(root);
      if (modules !== undefined) await assertDirectoryUnchanged(modules);
      else if (await optionalStat(modulesPath) !== undefined) fail('STAGE_INVALID');
    };
    const validateBeforeMutation = async () => {
      await validateDirectories();
      await assertSourceUnchanged(snapshot);
      await assertFileUnchanged(manifest);
      for (const file of metadataFiles) await assertFileUnchanged(file);
    };
    await validateBeforeMutation();
    if (!manifest.bytes.equals(normalized)) {
      mutationStarted = true;
      await replaceManifest({ manifest, normalized, root, validateBeforeMutation });
    }
    for (const file of metadataFiles) {
      if (file.metadata === undefined) continue;
      await validateDirectories();
      await assertFileUnchanged(file);
      mutationStarted = true;
      await unlink(file.path);
    }
  } catch (error) {
    if (error instanceof MetadataError) throw error;
    fail(mutationStarted ? 'WRITE_FAILED' : 'STAGE_INVALID');
  }
}

async function replaceManifest({ manifest, normalized, root, validateBeforeMutation }) {
  const temporaryPath = join(root.path, `.backend-build-metadata-${randomUUID()}.tmp`);
  let temporary;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', Number(manifest.metadata.mode & 0o777n));
    temporary = { path: temporaryPath, metadata: await handle.stat({ bigint: true }) };
    await handle.writeFile(normalized);
    await handle.sync();
    temporary.metadata = await handle.stat({ bigint: true });
    await handle.close();
    handle = undefined;
    await validateBeforeMutation();
    await assertFileUnchanged(temporary);
    await rename(temporaryPath, manifest.path);
    temporary = undefined;
  } finally {
    if (handle !== undefined) await handle.close();
    if (temporary !== undefined) {
      await assertDirectoryUnchanged(root);
      const current = await inspectFile(temporaryPath);
      if (!sameIdentity(temporary.metadata, current.metadata)) fail('WRITE_FAILED');
      await unlink(temporaryPath);
    }
  }
}

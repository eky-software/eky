import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function inspectPath(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw new Error('WINDOWS_ACCEPTANCE_PROFILE_INVENTORY_FAILED');
  }
}

function hasSameIdentityAndVersion(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function hashRegularFile(path, expectedMetadata) {
  const hash = createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk);
      size += chunk.length;
    }
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_PROFILE_INVENTORY_FAILED');
  }
  const after = await inspectPath(path);
  if (
    after === null ||
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.nlink !== 1 ||
    !hasSameIdentityAndVersion(expectedMetadata, after) ||
    size !== expectedMetadata.size
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_PROFILE_INVENTORY_UNSTABLE');
  }
  return hash.digest('hex');
}

export async function createClosedDirectoryInventory(root) {
  const rootMetadata = await inspectPath(root);
  if (rootMetadata === null) {
    return Object.freeze([]);
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('WINDOWS_ACCEPTANCE_PROFILE_ROOT_INVALID');
  }

  const entries = [];

  async function walk(directory, relativeDirectory) {
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new Error('WINDOWS_ACCEPTANCE_PROFILE_INVENTORY_FAILED');
    }
    children.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );

    for (const child of children) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${child.name}`
        : child.name;
      const absolutePath = join(directory, child.name);
      const metadata = await inspectPath(absolutePath);
      if (metadata === null || metadata.isSymbolicLink()) {
        throw new Error('WINDOWS_ACCEPTANCE_PROFILE_ENTRY_INVALID');
      }
      if (metadata.isDirectory()) {
        entries.push(Object.freeze({ kind: 'directory', relativePath }));
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!metadata.isFile() || metadata.nlink !== 1) {
        throw new Error('WINDOWS_ACCEPTANCE_PROFILE_ENTRY_INVALID');
      }
      entries.push(
        Object.freeze({
          kind: 'file',
          relativePath,
          size: metadata.size,
          sha256: await hashRegularFile(absolutePath, metadata),
        }),
      );
    }
  }

  await walk(root, '');
  return Object.freeze(entries);
}

export function inventoriesMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

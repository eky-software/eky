import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';

interface DirectoryIdentity {
  readonly path: string;
  readonly metadata: BigIntStats;
}

export interface InvoiceDocumentPathAccess {
  readonly filePath: string;
  readonly directories: readonly DirectoryIdentity[];
}

export async function inspectInvoiceDocumentPath(
  root: string,
  storagePath: string,
  createParents = false,
): Promise<InvoiceDocumentPathAccess> {
  const segments = storagePath.split('/');
  const fileName = segments[segments.length - 1];
  if (fileName === undefined || segments.length < 2 || segments.some((segment) => !isSafeSegment(segment))) {
    throw new InvoiceDocumentIntegrityError();
  }
  const directories: DirectoryIdentity[] = [];
  let path = resolve(root);
  if (createParents) await ensureDirectory(path);
  directories.push({ path, metadata: await inspectDirectory(path) });
  for (const segment of segments.slice(0, -1)) {
    await assertDirectoriesUnchanged(directories);
    path = join(path, segment);
    if (createParents) {
      try { await mkdir(path); } catch (error) {
        if (!hasFileErrorCode(error, 'EEXIST')) throw error;
      }
    }
    directories.push({ path, metadata: await inspectDirectory(path) });
  }
  await assertDirectoriesUnchanged(directories);
  return { filePath: join(path, fileName), directories };
}

export async function assertInvoiceDocumentPathUnchanged(access: InvoiceDocumentPathAccess): Promise<void> {
  await assertDirectoriesUnchanged(access.directories);
}

export function sameInvoiceDocumentFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

export function hasFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function assertDirectoriesUnchanged(directories: readonly DirectoryIdentity[]): Promise<void> {
  for (const directory of directories) {
    if (!sameInvoiceDocumentFile(directory.metadata, await inspectDirectory(directory.path))) {
      throw new InvoiceDocumentIntegrityError();
    }
  }
}

async function inspectDirectory(path: string): Promise<BigIntStats> {
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || !pathsEqual(path, await realpath(path))) {
    throw new InvoiceDocumentIntegrityError();
  }
  return metadata;
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    await inspectDirectory(path);
  } catch (error) {
    if (!hasFileErrorCode(error, 'ENOENT')) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    await ensureDirectory(parent);
    const parentMetadata = await inspectDirectory(parent);
    try { await mkdir(path); } catch (mkdirError) {
      if (!hasFileErrorCode(mkdirError, 'EEXIST')) throw mkdirError;
    }
    if (!sameInvoiceDocumentFile(parentMetadata, await inspectDirectory(parent))) {
      throw new InvoiceDocumentIntegrityError();
    }
    await inspectDirectory(path);
  }
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function isSafeSegment(segment: string): boolean {
  return segment.length > 0 && segment !== '.' && segment !== '..'
    && !/[\\<>:"|?*\u0000-\u001f\u007f]/u.test(segment)
    && !/[. ]$/u.test(segment)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment);
}

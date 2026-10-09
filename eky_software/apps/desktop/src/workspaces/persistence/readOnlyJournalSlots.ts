import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  CrashSafeFileSlotError,
  createNodeCrashSafeFileSlotFileSystem,
} from './crashSafeFileSlot.js';

export interface ReadOnlyJournalSlotPaths {
  readonly backupPath: string;
  readonly currentPath: string;
  readonly nextPath: string;
}

export async function hasAnyJournalSlot(
  paths: Readonly<ReadOnlyJournalSlotPaths>,
): Promise<boolean> {
  const presence = await Promise.all([
    inspectSlotPresence(paths.currentPath),
    inspectSlotPresence(paths.nextPath),
    inspectSlotPresence(paths.backupPath),
  ]);
  return presence.some(Boolean);
}

export async function hasTerminalJournalConflict<T>(
  paths: Readonly<ReadOnlyJournalSlotPaths>,
  maximumBytes: number,
  parse: (value: unknown) => Readonly<T>,
  isTerminal: (value: Readonly<T>) => boolean,
): Promise<boolean> {
  const [currentExists, nextExists, backupExists] = await Promise.all([
    inspectSlotPresence(paths.currentPath),
    inspectSlotPresence(paths.nextPath),
    inspectSlotPresence(paths.backupPath),
  ]);
  if (nextExists || backupExists) return true;
  if (!currentExists) return false;
  // readSlot is a bounded read, unlike the byte store's recoverAndRead.
  const bytes = await createNodeCrashSafeFileSlotFileSystem({
    ...paths,
    directoryPath: dirname(paths.currentPath),
  }, maximumBytes).readSlot('current');
  if (bytes === undefined) {
    throw new CrashSafeFileSlotError('invalid');
  }
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const current = parse(JSON.parse(source));
  return !isTerminal(current);
}

async function inspectSlotPresence(path: string): Promise<boolean> {
  if (!isAbsolute(path) || path.includes('\0')) {
    throw new CrashSafeFileSlotError('invalid');
  }
  await assertJournalParent(dirname(path));
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function assertJournalParent(path: string): Promise<void> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      const parent = dirname(path);
      if (parent !== path) return assertJournalParent(parent);
    }
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new CrashSafeFileSlotError('invalid');
  }
  const actual = await realpath(path);
  const expected = resolve(path);
  const samePath = process.platform === 'win32'
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected;
  if (!samePath) throw new CrashSafeFileSlotError('invalid');
}

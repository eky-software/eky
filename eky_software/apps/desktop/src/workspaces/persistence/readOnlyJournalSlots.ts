import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  CrashSafeFileSlotError,
  createNodeCrashSafeFileSlotFileSystem,
  type CrashSafeFileSlot,
  type CrashSafeFileSlotIdentity,
} from './crashSafeFileSlot.js';

export interface ReadOnlyJournalSlotPaths {
  readonly backupPath: string;
  readonly currentPath: string;
  readonly nextPath: string;
}

export interface ReadOnlyJournalSlotRecord<T> {
  readonly bytes: Uint8Array;
  readonly value: Readonly<T>;
  readonly identity?: Readonly<CrashSafeFileSlotIdentity>;
}

export type ReadOnlyJournalSlots<T> = Readonly<Record<
  CrashSafeFileSlot, ReadOnlyJournalSlotRecord<T> | undefined
>>;

// A non-repairing observation, not an atomic snapshot or mutation authority.
// The installation owner must bind and revalidate it before changing files.
export async function readOnlyJournalSlots<T>(
  paths: Readonly<ReadOnlyJournalSlotPaths>,
  maximumBytes: number,
  parse: (value: unknown) => Readonly<T>,
  options: Readonly<{ includeIdentity?: boolean }> = {},
): Promise<ReadOnlyJournalSlots<T>> {
  const fileSystem = createNodeCrashSafeFileSlotFileSystem({
    ...paths, directoryPath: dirname(paths.currentPath),
  }, maximumBytes);
  const result: Record<CrashSafeFileSlot, ReadOnlyJournalSlotRecord<T> | undefined> = {
    current: undefined, next: undefined, backup: undefined,
  };
  for (const slot of ['current', 'next', 'backup'] as const) {
    const existed = await inspectSlotPresence(paths[`${slot}Path`]);
    let identity: Readonly<CrashSafeFileSlotIdentity> | undefined;
    const bytes = await fileSystem.readSlot(slot, options.includeIdentity
      ? value => { identity = Object.freeze({ ...value }); } : undefined);
    if (bytes === undefined) {
      if (existed) throw new CrashSafeFileSlotError('invalid');
      continue;
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (options.includeIdentity && identity === undefined) throw new CrashSafeFileSlotError('invalid');
    result[slot] = Object.freeze({ bytes, value: parse(JSON.parse(source)),
      ...(identity === undefined ? {} : { identity }) });
  }
  return Object.freeze(result);
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

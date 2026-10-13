import { promises as fileSystem, type BigIntStats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  profileInspectionDocumentBindingsFileName,
  profileInspectionMaximumCatalogBytes,
  profileInspectionMaximumDocumentCount,
} from '../../runtime/profileInspectionDocumentBindings.js';
import { readWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { profileSnapshotArtifactCatalogLogicalPath } from '../createProfileBackupSourceEntries.js';
import type { ProfileRestoreActivationJournal } from './profileRestoreActivationJournal.js';

export type ProfileRestoreCleanupRole = 'rollback' | 'staging';

interface CleanupEntry {
  readonly path: string;
  readonly name: string;
  readonly parent: CleanupEntry | undefined;
  readonly kind: 'file' | 'directory';
  readonly identity: string;
  readonly children: readonly string[];
}

const maximumChildIndexBytes = String(profileInspectionMaximumCatalogBytes).length + 1;

export function measureProfileRestoreCleanupEntry(entry: Pick<CleanupEntry, 'name' | 'kind' | 'identity' | 'children'>): number {
  // Count the compact row and child references, not repeated absolute prefixes.
  return Buffer.byteLength(JSON.stringify([entry.name, entry.kind, entry.identity])) +
    entry.children.length * maximumChildIndexBytes;
}

export interface ProfileRestoreTerminalCleanupRoot {
  readonly role: ProfileRestoreCleanupRole;
  readonly root: string;
  readonly anchorRoot: string;
  readonly anchorIdentity: string;
  readonly identity: string | undefined;
  readonly entries: readonly CleanupEntry[];
}

export interface ProfileRestoreTerminalCleanupCensus {
  readonly journal: Readonly<ProfileRestoreActivationJournal>;
  readonly roots: readonly ProfileRestoreTerminalCleanupRoot[];
}

/** Filesystem census only. Neither a content receipt nor a native deletion grant. */
export async function readProfileRestoreTerminalCleanupRoot(input: {
  readonly role: ProfileRestoreCleanupRole;
  readonly root: string;
  readonly journal: Readonly<ProfileRestoreActivationJournal>;
}): Promise<ProfileRestoreTerminalCleanupRoot> {
  const root = resolve(input.root);
  let anchorRoot = dirname(root);
  while (await readOptionalEntry(anchorRoot) === undefined) {
    const parent = dirname(anchorRoot);
    if (parent === anchorRoot) throw invalid();
    anchorRoot = parent;
  }
  const anchorIdentity = await readWorkspaceProcessReservationIdentity(anchorRoot);
  const first = await readOptionalEntry(root);
  if (first === undefined) {
    if (input.journal.phase !== 'accepted') throw invalid();
    await assertProfileRestoreCleanupRootAbsent({ root, anchorRoot, anchorIdentity });
    return Object.freeze({ role: input.role, root, anchorRoot, anchorIdentity, identity: undefined, entries: Object.freeze([]) });
  }
  if (first.kind !== 'directory') throw invalid();
  const identity = await readWorkspaceProcessReservationIdentity(root);
  const entries: CleanupEntry[] = [];
  const pending: { parent: CleanupEntry | undefined; name: string }[] = [{ parent: undefined, name: '' }];
  let metadataBytes = 0;
  let documentCount = 0;
  while (pending.length !== 0) {
    const next = pending.pop()!;
    const path = next.parent === undefined ? root : join(next.parent.path, next.name);
    const relative = relativeEntryPath(next.parent, next.name).join('/');
    const entry = await readOptionalEntry(path);
    if (entry === undefined || !allowedEntry(input, relative, entry.kind)) throw invalid();
    const children = entry.kind === 'directory' ? (await fileSystem.readdir(path)).sort() : [];
    const captured = captureEntry(root, next.parent, next.name, entry, children);
    metadataBytes += measureProfileRestoreCleanupEntry(captured);
    if (entry.kind === 'file' && relative.endsWith('.pdf')) documentCount += 1;
    if (documentCount > profileInspectionMaximumDocumentCount ||
        metadataBytes > profileInspectionMaximumCatalogBytes) throw invalid();
    entries.push(captured);
    for (const child of children) {
      if (!safeComponent(child)) throw invalid();
      pending.push({ parent: captured, name: child });
    }
    await assertProfileRestoreCleanupEntry(captured);
  }
  if (await readWorkspaceProcessReservationIdentity(root) !== identity ||
      await readWorkspaceProcessReservationIdentity(anchorRoot) !== anchorIdentity) throw invalid();
  return Object.freeze({ role: input.role, root, anchorRoot, anchorIdentity, identity, entries: Object.freeze(entries) });
}

export async function assertProfileRestoreCleanupEntry(entry: CleanupEntry, removed: ReadonlySet<string> = new Set()): Promise<void> {
  await assertProfileRestoreCleanupEntryIdentity(entry);
  if (entry.kind === 'directory') {
    const children = (await fileSystem.readdir(entry.path)).sort();
    const expected = entry.children.filter(name => !removed.has(join(entry.path, name)));
    if (children.length !== expected.length || children.some((name, index) => name !== expected[index])) throw invalid();
  }
}

export async function assertProfileRestoreCleanupEntryIdentity(entry: CleanupEntry): Promise<void> {
  const current = await readOptionalEntry(entry.path);
  if (current === undefined || current.kind !== entry.kind || current.identity !== entry.identity) throw invalid();
}

export async function assertProfileRestoreCleanupRootAbsent(root: Pick<ProfileRestoreTerminalCleanupRoot,
  'root' | 'anchorRoot' | 'anchorIdentity'>): Promise<void> {
  if (await readWorkspaceProcessReservationIdentity(root.anchorRoot) !== root.anchorIdentity ||
      await readOptionalEntry(root.root) !== undefined) throw invalid();
  if (await readWorkspaceProcessReservationIdentity(root.anchorRoot) !== root.anchorIdentity) throw invalid();
}

async function readOptionalEntry(path: string): Promise<Pick<CleanupEntry, 'kind' | 'identity'> | undefined> {
  let first: BigIntStats;
  try { first = await fileSystem.lstat(path, { bigint: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const kind = first.isDirectory() ? 'directory' : first.isFile() ? 'file' : undefined;
  if (kind === undefined || first.isSymbolicLink() || first.ino <= 0n || first.dev < 0n ||
      (kind === 'file' && first.nlink !== 1n)) throw invalid();
  const canonical = await fileSystem.realpath(path);
  if (process.platform === 'win32' ? canonical.toLowerCase() !== path.toLowerCase() : canonical !== path) throw invalid();
  const after = await fileSystem.lstat(path, { bigint: true });
  const identity = fingerprint(first, kind);
  if (after.isSymbolicLink() || (kind === 'file' ? !after.isFile() || after.nlink !== 1n : !after.isDirectory()) ||
      fingerprint(after, kind) !== identity) throw invalid();
  return Object.freeze({ kind, identity });
}

function captureEntry(root: string, parent: CleanupEntry | undefined, name: string,
  entry: Pick<CleanupEntry, 'kind' | 'identity'>, children: string[]): CleanupEntry {
  return Object.freeze({
    name, parent, ...entry, children: Object.freeze(children),
    get path() { return join(root, ...relativeEntryPath(parent, name)); },
  });
}

function relativeEntryPath(parent: CleanupEntry | undefined, name: string): string[] {
  const segments = name === '' ? [] : [name];
  for (let ancestor = parent; ancestor !== undefined; ancestor = ancestor.parent) {
    if (ancestor.name !== '') segments.push(ancestor.name);
  }
  return segments.reverse();
}

function fingerprint(metadata: BigIntStats, kind: CleanupEntry['kind']): string {
  return kind === 'directory' ? `${metadata.dev}:${metadata.ino}`
    : `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}`;
}

function allowedEntry(input: { role: ProfileRestoreCleanupRole; journal: Readonly<ProfileRestoreActivationJournal> },
  path: string, kind: CleanupEntry['kind']): boolean {
  if (path === '') return kind === 'directory';
  if (input.role === 'rollback') {
    if (['data', 'storage'].includes(path)) return kind === 'directory';
    if (path === 'data/eky.sqlite') return input.journal.hadActiveDatabase && kind === 'file';
    if (path === 'storage/invoices') return input.journal.hadActiveDocuments && kind === 'directory';
    if (path.startsWith('storage/invoices/')) {
      return input.journal.hadActiveDocuments && (kind === 'directory' || path.endsWith('.pdf'));
    }
    return false;
  }
  if (path === profileInspectionDocumentBindingsFileName || path === profileSnapshotArtifactCatalogLogicalPath) return kind === 'file';
  if (['activation', 'activation/storage', 'artifacts', 'artifacts/invoicing', 'artifacts/invoicing/invoice-documents'].includes(path)) {
    return kind === 'directory';
  }
  return kind === 'file' && /^artifacts\/invoicing\/invoice-documents\/[a-f0-9]{64}\.pdf$/.test(path);
}

function safeComponent(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..' && !value.includes('\\') && !value.includes('/') && !value.includes('\0');
}

function invalid(): Error { return new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID'); }

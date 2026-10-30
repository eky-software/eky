import { promises as fileSystem, type BigIntStats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { profileInspectionDocumentBindingsFileName, profileInspectionMaximumCatalogBytes } from '../../runtime/profileInspectionDocumentBindings.js';
import { createWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';

const failureCode = 'WORKSPACE_CANDIDATE_INSPECTION_CLEANUP_FAILED';
const databaseFileName = 'profile.sqlite';
const databaseNames = [databaseFileName, `${databaseFileName}-wal`, `${databaseFileName}-shm`];

export interface WorkspaceInspectionCopyCreationIdentity {
  readonly rootIdentity: string;
  readonly parentIdentity: string;
}

export interface WorkspaceInspectionCopyReadAuthority {
  assertCurrent(): void;
  assertMainOwned(): Promise<void>;
  readonly signal: AbortSignal;
}

/** Main keeps the receipt locally; the child's path never authorizes deletion. */
export class WorkspaceCandidateInspectionCopy {
  private rootIdentity: BigIntStats | undefined;
  private parentIdentity: BigIntStats | undefined;
  private creationIdentity: Readonly<WorkspaceInspectionCopyCreationIdentity> | undefined;
  private removedCreationIdentity: Readonly<WorkspaceInspectionCopyCreationIdentity> | undefined;

  constructor(readonly root: string, private readonly kind?: 'coldRestoreContent') {}

  async prepare(signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.rootIdentity !== undefined || !isCanonicalAbsolutePath(this.root)) throw new Error(failureCode);
    const parent = dirname(this.root);
    this.parentIdentity = await inspectDirectory(parent);
    if (signal.aborted) throw new Error(failureCode);
    await fileSystem.mkdir(this.root, { mode: 0o700 });
    this.rootIdentity = await inspectDirectory(this.root);
    assertIdentity(this.parentIdentity, await inspectDirectory(parent));
    if (signal.aborted) throw new Error(failureCode);
    this.creationIdentity = Object.freeze({
      rootIdentity: createWorkspaceProcessReservationIdentity(this.rootIdentity),
      parentIdentity: createWorkspaceProcessReservationIdentity(this.parentIdentity),
    });
  }

  captureCreationIdentity(): Readonly<WorkspaceInspectionCopyCreationIdentity> {
    if (this.creationIdentity === undefined) throw new Error(failureCode);
    return this.creationIdentity;
  }

  /** Readonly pre-grant proof; never recaptures identities from the current path. */
  async assertEmptyCreationCurrent(authority: Readonly<WorkspaceInspectionCopyReadAuthority>): Promise<void> {
    const receipt = this.captureCreationIdentity();
    const checkCurrent = authority.assertCurrent.bind(authority);
    const checkMainOwned = authority.assertMainOwned.bind(authority);
    const signal = authority.signal;
    const assertCurrent = () => {
      if (signal.aborted || this.creationIdentity !== receipt) throw new Error(failureCode);
      checkCurrent();
    };
    for (let pass = 0; pass < 2; pass += 1) {
      assertCurrent();
      await checkMainOwned();
      assertCurrent();
      await this.assertOwnedDirectory(assertCurrent);
      assertCurrent();
      const names = await fileSystem.readdir(this.root);
      assertCurrent();
      if (names.length !== 0) throw new Error(failureCode);
    }
    await this.assertOwnedDirectory(assertCurrent);
    assertCurrent();
  }

  /** Metadata cleanup only: the original owner must have acknowledged its own rmdir. */
  async assertRemovedCreationCurrent(authority: Readonly<WorkspaceInspectionCopyReadAuthority>): Promise<void> {
    const receipt = this.removedCreationIdentity;
    if (receipt === undefined) throw new Error(failureCode);
    const checkCurrent = authority.assertCurrent.bind(authority);
    const checkMainOwned = authority.assertMainOwned.bind(authority);
    const signal = authority.signal;
    const assertCurrent = () => {
      if (signal.aborted || this.removedCreationIdentity !== receipt || this.creationIdentity !== undefined) throw new Error(failureCode);
      checkCurrent();
    };
    for (let pass = 0; pass < 2; pass += 1) {
      assertCurrent();
      await checkMainOwned();
      assertCurrent();
      assertIdentity(this.parentIdentity!, await inspectDirectory(dirname(this.root), assertCurrent));
      assertCurrent();
      await this.assertCopyAbsent(assertCurrent);
    }
    assertIdentity(this.parentIdentity!, await inspectDirectory(dirname(this.root), assertCurrent));
    assertCurrent();
    await this.assertCopyAbsent(assertCurrent);
    assertCurrent();
  }

  async discard(assertMainOwned: () => Promise<void>, signal: AbortSignal): Promise<void> {
    if (this.rootIdentity === undefined || this.parentIdentity === undefined) throw new Error(failureCode);
    if (signal.aborted) throw new Error(failureCode);
    await assertMainOwned();
    await this.assertOwnedDirectory();
    const names = await fileSystem.readdir(this.root);
    const allowedNames = new Set([...databaseNames,
      ...(this.kind === 'coldRestoreContent' ? [profileInspectionDocumentBindingsFileName] : [])]);
    if (!names.includes(databaseFileName) || names.length > allowedNames.size ||
        names.some(name => !allowedNames.has(name))) throw new Error(failureCode);
    const identities = new Map<string, BigIntStats>();
    for (const name of names) {
      const path = join(this.root, name);
      const metadata = await fileSystem.lstat(path, { bigint: true });
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n ||
          !pathsEqual(await fileSystem.realpath(path), path) ||
          (name.endsWith('-wal') && metadata.size !== 0n) ||
          (name === profileInspectionDocumentBindingsFileName && metadata.size > BigInt(profileInspectionMaximumCatalogBytes))) throw new Error(failureCode);
      identities.set(name, metadata);
    }
    await assertMainOwned();
    await this.assertOwnedDirectory();
    if (signal.aborted) throw new Error(failureCode);
    const currentNames = await fileSystem.readdir(this.root);
    if (currentNames.length !== names.length || currentNames.some(name => !identities.has(name))) throw new Error(failureCode);
    for (const name of names) {
      const current = await fileSystem.lstat(join(this.root, name), { bigint: true });
      const expected = identities.get(name)!;
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1n ||
          current.size !== expected.size || current.mtimeNs !== expected.mtimeNs || current.ctimeNs !== expected.ctimeNs) {
        throw new Error(failureCode);
      }
      assertIdentity(expected, current);
    }
    if (signal.aborted) throw new Error(failureCode);
    // Never recursively remove an entry which appeared after validation.
    for (const name of names) {
      if (signal.aborted) throw new Error(failureCode);
      await fileSystem.unlink(join(this.root, name));
    }
    if (signal.aborted) throw new Error(failureCode);
    await fileSystem.rmdir(this.root);
    this.removedCreationIdentity = this.creationIdentity;
    this.creationIdentity = undefined;
  }

  /** Only a caller with proven child exit may use the unused-copy terminal. */
  async discardAfterExit(assertMainOwned: () => Promise<void>, signal: AbortSignal, requireEmpty = false): Promise<void> {
    if (this.rootIdentity === undefined || this.parentIdentity === undefined || signal.aborted) throw new Error(failureCode);
    await this.assertOwnedDirectory();
    const initialNames = await fileSystem.readdir(this.root);
    if (signal.aborted) throw new Error(failureCode);
    if (initialNames.length !== 0) {
      if (requireEmpty) throw new Error(failureCode);
      await this.discard(assertMainOwned, signal);
      return;
    }
    await assertMainOwned();
    await this.assertOwnedDirectory();
    const checkedNames = await fileSystem.readdir(this.root);
    if (signal.aborted || checkedNames.length !== 0) throw new Error(failureCode);
    await assertMainOwned();
    await this.assertOwnedDirectory();
    const finalNames = await fileSystem.readdir(this.root);
    if (signal.aborted || finalNames.length !== 0) throw new Error(failureCode);
    // rmdir rejects an entry arriving after the final empty-directory check.
    await fileSystem.rmdir(this.root);
    this.removedCreationIdentity = this.creationIdentity;
    this.creationIdentity = undefined;
  }

  private async assertOwnedDirectory(assertCurrent?: () => void): Promise<void> {
    assertCurrent?.();
    assertIdentity(this.parentIdentity!, await inspectDirectory(dirname(this.root), assertCurrent));
    assertCurrent?.();
    assertIdentity(this.rootIdentity!, await inspectDirectory(this.root, assertCurrent));
    assertCurrent?.();
  }

  private async assertCopyAbsent(assertCurrent: () => void): Promise<void> {
    assertCurrent();
    let absent = false;
    try { await fileSystem.lstat(this.root, { bigint: true }); }
    catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
      absent = true;
    }
    assertCurrent();
    if (!absent) throw new Error(failureCode);
  }
}

async function inspectDirectory(path: string, assertCurrent?: () => void): Promise<BigIntStats> {
  assertCurrent?.();
  const metadata = await fileSystem.lstat(path, { bigint: true });
  assertCurrent?.();
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(failureCode);
  const canonical = await fileSystem.realpath(path);
  assertCurrent?.();
  if (!pathsEqual(canonical, path) ||
      (process.platform !== 'win32' && (metadata.mode & 0o077n) !== 0n)) throw new Error(failureCode);
  if (assertCurrent !== undefined) {
    // The readonly publication proof must not return pre-realpath identity.
    const after = await fileSystem.lstat(path, { bigint: true });
    assertCurrent();
    if (!after.isDirectory() || after.isSymbolicLink() ||
        (process.platform !== 'win32' && (after.mode & 0o077n) !== 0n)) throw new Error(failureCode);
    assertIdentity(metadata, after);
  }
  return metadata;
}

function assertIdentity(expected: BigIntStats, actual: BigIntStats): void {
  if (expected.dev !== actual.dev || expected.ino !== actual.ino) throw new Error(failureCode);
}

function pathsEqual(first: string, second: string): boolean {
  return process.platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second;
}

function isCanonicalAbsolutePath(path: string): boolean {
  return typeof path === 'string' && pathsEqual(resolve(path), path);
}

import { promises as fileSystem, type BigIntStats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { profileInspectionDocumentBindingsFileName, profileInspectionMaximumCatalogBytes } from '../../runtime/profileInspectionDocumentBindings.js';

const failureCode = 'WORKSPACE_CANDIDATE_INSPECTION_CLEANUP_FAILED';
const databaseFileName = 'profile.sqlite';
const databaseNames = [databaseFileName, `${databaseFileName}-wal`, `${databaseFileName}-shm`];

/** Main keeps the receipt locally; the child's path never authorizes deletion. */
export class WorkspaceCandidateInspectionCopy {
  private rootIdentity: BigIntStats | undefined;
  private parentIdentity: BigIntStats | undefined;

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
  }

  private async assertOwnedDirectory(): Promise<void> {
    assertIdentity(this.parentIdentity!, await inspectDirectory(dirname(this.root)));
    assertIdentity(this.rootIdentity!, await inspectDirectory(this.root));
  }
}

async function inspectDirectory(path: string): Promise<BigIntStats> {
  const metadata = await fileSystem.lstat(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      !pathsEqual(await fileSystem.realpath(path), path) ||
      (process.platform !== 'win32' && (metadata.mode & 0o077n) !== 0n)) throw new Error(failureCode);
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

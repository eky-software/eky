import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotMutationGuard } from '../persistence/crashSafeFileSlot.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { checkedDeletionAuthority, deletionDataRecord, deletionDigest, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryCommitment, captureDeletionInventoryHeader, deletionInventoryReadChunkBytes, deletionInventoryFormatVersion,
  type WorkspaceDeletionInventoryHeader, type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { assertDeletionInventoryFile, deletionInventoryFileIdentity, deletionInventoryPathsEqual,
  inspectDeletionInventoryFile, openWorkspaceDeletionInventoryFile, workspaceDeletionInventoryDirectoryReads,
  sameDeletionInventoryFile, withDeletionInventoryFile, type OpenWorkspaceDeletionInventoryFile,
  type WorkspaceDeletionInventoryDirectoryReads,
  type WorkspaceDeletionInventoryFile } from './workspaceDeletionInventoryFile.js';
import { assertDeletionInventoryRecords, encodeDeletionInventory, inspectDeletionInventory } from './workspaceDeletionInventoryStream.js';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';

export const workspaceDeletionInventoriesDirectoryName = 'workspace-deletion-inventories';
export const workspaceDeletionInventoryFileName = 'inventory.jsonl';
const invalidCode = 'WORKSPACE_DELETE_INVENTORY_INVALID';

export interface WorkspaceDeletionInventoryAuthority {
  assertAuthority(): void;
  assertExternalSelection(): Promise<void>;
}

interface InventoryGuard extends CrashSafeFileSlotMutationGuard {
  assertExternalSelection(): Promise<void>;
}

export function createWorkspaceDeletionInventoryPaths(userDataRoot: string, operationId: string) {
  if (typeof userDataRoot !== 'string' || userDataRoot.includes('\0') || !isAbsolute(userDataRoot) ||
      !deletionInventoryPathsEqual(resolve(userDataRoot), userDataRoot)) return invalidDeletionData(invalidCode);
  const state = createWorkspaceDeletionJournalPaths(userDataRoot);
  const parentPath = join(state.directoryPath, workspaceDeletionInventoriesDirectoryName);
  const directoryPath = join(parentPath, validateWorkspaceBackupReplacementOperationId(operationId));
  const currentPath = join(directoryPath, workspaceDeletionInventoryFileName);
  return Object.freeze({ parentPath, directoryPath, currentPath,
    nextPath: `${currentPath}.next`, backupPath: `${currentPath}.backup` });
}

function captureInventorySelection(value: unknown) {
  deletionDataRecord(value, ['target', 'inventory', 'inventoryFileIdentity', 'operationRootIdentity', 'operationParentIdentity'], invalidCode);
  return Object.freeze({ target: captureDeletionInventoryHeader(value.target),
    inventory: captureDeletionInventoryCommitment(value.inventory),
    inventoryFileIdentity: deletionDigest(value.inventoryFileIdentity, invalidCode),
    operationRootIdentity: deletionDigest(value.operationRootIdentity, invalidCode),
    operationParentIdentity: deletionDigest(value.operationParentIdentity, invalidCode) });
}
export type WorkspaceDeletionInventorySelection = ReturnType<typeof captureInventorySelection>;

export class WorkspaceDeletionInventoryStore {
  private readonly paths: ReturnType<typeof createWorkspaceDeletionInventoryPaths>;
  private readonly fileSystem: CrashSafeFileSlotFileSystem;
  private activeOperation = false;

  constructor(private readonly userDataRoot: string, private readonly operationId: string,
    private readonly openFile: OpenWorkspaceDeletionInventoryFile = openWorkspaceDeletionInventoryFile,
    fileSystem?: CrashSafeFileSlotFileSystem,
    private readonly directories: WorkspaceDeletionInventoryDirectoryReads = workspaceDeletionInventoryDirectoryReads) {
    this.paths = createWorkspaceDeletionInventoryPaths(userDataRoot, operationId);
    this.fileSystem = fileSystem ?? createNodeCrashSafeFileSlotFileSystem(this.paths, Number.MAX_SAFE_INTEGER);
  }

  publish(value: unknown, records: AsyncIterable<WorkspaceDeletionInventoryRecord>, authority: WorkspaceDeletionInventoryAuthority) {
    return this.exclusive(async () => {
      const target = captureDeletionInventoryHeader(value);
      if (target.operationId !== this.operationId) return invalidDeletionData(invalidCode);
      const guard = this.guard(authority);
      await guard.beforeMutation();
      const state = createWorkspaceDeletionJournalPaths(this.userDataRoot);
      await createNodeCrashSafeFileSlotFileSystem(state, 1).prepareDirectory(guard);
      const parent = { directoryPath: this.paths.parentPath, currentPath: this.paths.currentPath,
        nextPath: this.paths.nextPath, backupPath: this.paths.backupPath };
      const parentFileSystem = createNodeCrashSafeFileSlotFileSystem(parent, 1);
      await parentFileSystem.prepareDirectory(guard);
      guard.assertAuthority();
      const operationParentIdentity = await this.directories.identity(this.paths.parentPath, guard.assertAuthority);
      await guard.beforeMutation();
      if (await this.directories.identity(this.paths.parentPath, guard.assertAuthority) !== operationParentIdentity) {
        return invalidDeletionData(invalidCode);
      }
      await guard.assertExternalSelection();
      // Exclusive creation is the original root receipt; an interrupted prior directory is never adopted here.
      await mkdir(this.paths.directoryPath, { mode: 0o700 });
      guard.assertAuthority();
      const operationRootIdentity = await this.directories.identity(this.paths.directoryPath, guard.assertAuthority);
      const selectedGuard = this.guard(authority, { operationRootIdentity, operationParentIdentity });
      await parentFileSystem.syncDirectory(selectedGuard);
      await selectedGuard.beforeMutation();
      await this.assertNames([], selectedGuard);
      const file = await this.openFile(this.paths.nextPath, 'wx');
      const written = await withDeletionInventoryFile(file, async () => {
        selectedGuard.assertAuthority();
        const created = await file.stat();
        selectedGuard.assertAuthority();
        assertDeletionInventoryFile(created);
        if (created.size !== 0n) return invalidDeletionData(invalidCode);
        const inventoryFileIdentity = deletionInventoryFileIdentity(created);
        const hash = createHash('sha256');
        let byteLength = 0;
        let recordCount = -1;
        for await (const bytes of encodeDeletionInventory(target, records)) {
          selectedGuard.assertAuthority();
          let offset = 0;
          while (offset < bytes.byteLength) {
            await selectedGuard.beforeMutation();
            const actual = await inspectDeletionInventoryFile(this.paths.nextPath, selectedGuard.assertAuthority);
            if (deletionInventoryFileIdentity(actual) !== inventoryFileIdentity || actual.size !== BigInt(byteLength + offset)) {
              return invalidDeletionData(invalidCode);
            }
            await selectedGuard.assertExternalSelection();
            const count = await file.write(bytes.subarray(offset), byteLength + offset);
            selectedGuard.assertAuthority();
            if (!Number.isSafeInteger(count) || count < 1 || count > bytes.byteLength - offset) return invalidDeletionData(invalidCode);
            offset += count;
          }
          byteLength += bytes.byteLength;
          if (!Number.isSafeInteger(byteLength)) return invalidDeletionData(invalidCode);
          recordCount++;
          hash.update(bytes);
        }
        await selectedGuard.beforeMutation();
        await file.sync();
        selectedGuard.assertAuthority();
        const inventory = captureDeletionInventoryCommitment({ formatVersion: deletionInventoryFormatVersion,
          byteLength, recordCount, sha256: hash.digest('hex') });
        return captureInventorySelection({ target, inventory, inventoryFileIdentity, operationRootIdentity, operationParentIdentity });
      });
      await this.readAt('next', written, selectedGuard);
      const publishGuard = { ...selectedGuard, beforeMutation: async () => {
        await selectedGuard.beforeMutation();
        await this.assertNames([`${workspaceDeletionInventoryFileName}.next`], selectedGuard);
        await this.readAt('next', written, selectedGuard);
      } };
      await this.fileSystem.moveSlot('next', 'current', publishGuard);
      await this.fileSystem.syncDirectory(selectedGuard);
      await this.assertNames([workspaceDeletionInventoryFileName], selectedGuard);
      await this.readAt('current', written, selectedGuard);
      return written;
    });
  }

  inspect(value: unknown, authority: WorkspaceDeletionInventoryAuthority) {
    return this.exclusive(async () => {
      const selected = captureInventorySelection(value);
      if (selected.target.operationId !== this.operationId) return invalidDeletionData(invalidCode);
      const guard = this.guard(authority, selected);
      await guard.beforeMutation();
      await this.assertNames([workspaceDeletionInventoryFileName], guard);
      return this.readAt('current', selected, guard);
    });
  }

  assertRecords(value: unknown, records: AsyncIterable<WorkspaceDeletionInventoryRecord>,
    authority: WorkspaceDeletionInventoryAuthority) {
    return this.exclusive(async () => {
      const selected = captureInventorySelection(value);
      if (selected.target.operationId !== this.operationId) return invalidDeletionData(invalidCode);
      await this.readAt('current', selected, this.guard(authority, selected), records);
    });
  }

  private guard(authority: WorkspaceDeletionInventoryAuthority,
    identities?: Pick<WorkspaceDeletionInventorySelection, 'operationRootIdentity' | 'operationParentIdentity'>): InventoryGuard {
    const assertAuthority = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
    const assertExternalSelection = async () => {
      assertAuthority();
      await authority.assertExternalSelection();
      assertAuthority();
    };
    return { assertAuthority, assertExternalSelection, beforeMutation: async () => {
      await assertExternalSelection();
      if (identities !== undefined) {
        if (await this.directories.identity(this.paths.parentPath, assertAuthority) !== identities.operationParentIdentity ||
            await this.directories.identity(this.paths.directoryPath, assertAuthority) !== identities.operationRootIdentity) {
          return invalidDeletionData(invalidCode);
        }
      }
      await assertExternalSelection();
    } };
  }

  private async readAt(slot: 'current' | 'next', selected: WorkspaceDeletionInventorySelection, guard: InventoryGuard,
    expectedRecords?: AsyncIterable<WorkspaceDeletionInventoryRecord>) {
    await guard.beforeMutation();
    const path = slot === 'current' ? this.paths.currentPath : this.paths.nextPath;
    const names = [slot === 'current' ? workspaceDeletionInventoryFileName : `${workspaceDeletionInventoryFileName}.next`];
    await this.assertNames(names, guard);
    const before = await inspectDeletionInventoryFile(path, guard.assertAuthority);
    if (deletionInventoryFileIdentity(before) !== selected.inventoryFileIdentity || before.size !== BigInt(selected.inventory.byteLength)) {
      return invalidDeletionData(invalidCode);
    }
    guard.assertAuthority();
    const file = await this.openFile(path, 'r');
    const commitment = await withDeletionInventoryFile(file, async () => {
      guard.assertAuthority();
      const opened = await file.stat();
      guard.assertAuthority();
      assertDeletionInventoryFile(opened);
      if (!sameDeletionInventoryFile(before, opened)) return invalidDeletionData(invalidCode);
      const result = await inspectDeletionInventory(this.chunks(file, guard), selected.target, selected.inventory,
        () => this.chunks(file, guard));
      if (expectedRecords !== undefined) {
        await assertDeletionInventoryRecords(this.chunks(file, guard), selected.target, selected.inventory,
          expectedRecords, guard.assertAuthority);
      }
      guard.assertAuthority();
      const after = await file.stat();
      guard.assertAuthority();
      assertDeletionInventoryFile(after);
      const current = await inspectDeletionInventoryFile(path, guard.assertAuthority);
      if (!sameDeletionInventoryFile(opened, after) || !sameDeletionInventoryFile(after, current)) return invalidDeletionData(invalidCode);
      return result;
    });
    await guard.beforeMutation();
    await this.assertNames(names, guard);
    const afterClose = await inspectDeletionInventoryFile(path, guard.assertAuthority);
    if (!sameDeletionInventoryFile(before, afterClose)) return invalidDeletionData(invalidCode);
    await guard.assertExternalSelection();
    return commitment;
  }

  private async *chunks(file: WorkspaceDeletionInventoryFile, guard: CrashSafeFileSlotMutationGuard) {
    const bytes = Buffer.alloc(deletionInventoryReadChunkBytes);
    let offset = 0;
    while (true) {
      guard.assertAuthority();
      const count = await file.read(bytes, offset);
      guard.assertAuthority();
      if (!Number.isSafeInteger(count) || count < 0 || count > bytes.byteLength) return invalidDeletionData(invalidCode);
      if (count === 0) return;
      yield bytes.subarray(0, count);
      offset += count;
      if (!Number.isSafeInteger(offset)) return invalidDeletionData(invalidCode);
    }
  }

  private async assertNames(expected: readonly string[], guard: InventoryGuard) {
    const names = await this.directories.names(this.paths.directoryPath);
    guard.assertAuthority();
    if (names.length !== expected.length || names.some(name => !expected.includes(name))) invalidDeletionData(invalidCode);
    await guard.assertExternalSelection();
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.activeOperation) return invalidDeletionData(invalidCode);
    this.activeOperation = true;
    try { return await work(); } finally { this.activeOperation = false; }
  }
}

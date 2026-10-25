import { isDeepStrictEqual } from 'node:util';

import {
  CrashSafeByteSlotStore,
  CrashSafeByteSlotStoreError,
} from '../persistence/crashSafeByteSlotStore.js';
import {
  CrashSafeFileSlotError,
  createNodeCrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotIdentity,
} from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlotRecord } from '../persistence/readOnlyJournalSlots.js';
import {
  assertWorkspaceFirstStartMigrationJournalTransition,
  parseWorkspaceFirstStartMigrationJournalBytes,
  serializeWorkspaceFirstStartMigrationJournal,
  validateWorkspaceFirstStartMigrationJournal,
  WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES,
} from './workspaceFirstStartMigrationJournalCodec.js';
import {
  WorkspaceFirstStartMigrationJournalStoreError,
  WorkspaceFirstStartMigrationJournalValidationError,
} from './workspaceFirstStartMigrationJournalError.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from './workspaceFirstStartMigrationJournalPaths.js';
import type {
  WorkspaceFirstStartMigrationJournalPort,
  WorkspaceFirstStartMigrationJournalV1,
  WorkspaceFirstStartPreparedCancellation,
} from './workspaceFirstStartMigrationJournalTypes.js';

export interface WorkspaceFirstStartMigrationJournalStoreOptions {
  readonly userDataPath: string;
  readonly fileSystem?: CrashSafeFileSlotFileSystem;
}

export class WorkspaceFirstStartMigrationJournalStore
  implements WorkspaceFirstStartMigrationJournalPort {
  private readonly byteStore: CrashSafeByteSlotStore;
  private readonly fileSystem: CrashSafeFileSlotFileSystem;
  private activeOperation = false;

  constructor(
    options: Readonly<WorkspaceFirstStartMigrationJournalStoreOptions>,
  ) {
    const paths = createWorkspaceFirstStartMigrationJournalPaths(
      options.userDataPath,
    );
    const fileSystem =
      options.fileSystem ??
      createNodeCrashSafeFileSlotFileSystem(
        paths,
        WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES,
      );
    this.byteStore = new CrashSafeByteSlotStore(fileSystem);
    this.fileSystem = fileSystem;
  }

  read(): Promise<
    Readonly<WorkspaceFirstStartMigrationJournalV1> | undefined
  > {
    return this.runExclusive(() => this.recoverAndRead());
  }

  inspect(): Promise<ReadOnlyJournalSlotRecord<WorkspaceFirstStartMigrationJournalV1> | undefined> {
    return this.runExclusive(async () => {
      let identity: Readonly<CrashSafeFileSlotIdentity> | undefined;
      const current = await this.fileSystem.readSlot('current', value => { identity = Object.freeze({ ...value }); });
      if (await this.fileSystem.readSlot('next') !== undefined || await this.fileSystem.readSlot('backup') !== undefined) {
        throw new WorkspaceFirstStartMigrationJournalValidationError();
      }
      if (current === undefined) return undefined;
      if (identity === undefined) throw new WorkspaceFirstStartMigrationJournalValidationError();
      return Object.freeze({ bytes: Uint8Array.from(current), identity,
        value: parseWorkspaceFirstStartMigrationJournalBytes(current) });
    });
  }

  write(value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const next = validateWorkspaceFirstStartMigrationJournal(value);
      const current = await this.recoverAndRead();
      assertWorkspaceFirstStartMigrationJournalTransition(current, next);
      try {
        await this.byteStore.replace(
          serializeWorkspaceFirstStartMigrationJournal(next),
          current !== undefined,
        );
      } catch (error) {
        throw this.mapStoreError(error);
      }
    });
  }

  discardPrepared(operationId: string, selection?: WorkspaceFirstStartPreparedCancellation): Promise<void> {
    if (selection !== undefined) return this.discardSelectedPreparation(operationId, selection);
    return this.removeMatching(operationId, 'prepared');
  }

  private discardSelectedPreparation(operationId: string, selection: WorkspaceFirstStartPreparedCancellation): Promise<void> {
    const assertAuthority = selection.assertCurrent.bind(selection);
    const assertExternalSelection = selection.assertExternalSelection.bind(selection);
    return this.runExclusive(async () => {
      const bytes = Uint8Array.from(selection.selected.bytes);
      const identity = selection.selected.identity;
      const journal = parseWorkspaceFirstStartMigrationJournalBytes(bytes);
      if (identity === undefined || !isDeepStrictEqual(journal, selection.selected.value) ||
          journal.operationId !== operationId || journal.state !== 'prepared') {
        throw new WorkspaceFirstStartMigrationJournalValidationError();
      }
      // Preserve the admitted observation, never adopt a replacement at deletion.
      await this.byteStore.clearSelected({
        expectedSlots: { current: bytes, next: undefined, backup: undefined },
        expectedIdentities: { current: identity, next: undefined, backup: undefined },
        assertAuthority, assertExternalSelection });
    });
  }

  removeTransitioned(operationId: string): Promise<void> {
    return this.removeMatching(operationId, 'registryTransitioned');
  }

  private removeMatching(
    operationId: string,
    expectedState: 'prepared' | 'registryTransitioned',
  ): Promise<void> {
    return this.runExclusive(async () => {
      const current = await this.recoverAndRead();
      if (
        current === undefined ||
        current.operationId !== operationId ||
        current.state !== expectedState
      ) {
        throw new WorkspaceFirstStartMigrationJournalValidationError();
      }
      try {
        await this.byteStore.clear();
      } catch (error) {
        throw this.mapStoreError(error);
      }
    });
  }

  private async recoverAndRead(): Promise<
    Readonly<WorkspaceFirstStartMigrationJournalV1> | undefined
  > {
    try {
      return await this.byteStore.recoverAndRead(
        parseWorkspaceFirstStartMigrationJournalBytes,
      );
    } catch (error) {
      throw this.mapStoreError(error);
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeOperation) {
      throw new WorkspaceFirstStartMigrationJournalStoreError('busy');
    }
    this.activeOperation = true;
    try {
      return await operation();
    } finally {
      this.activeOperation = false;
    }
  }

  private mapStoreError(error: unknown): Error {
    if (
      error instanceof WorkspaceFirstStartMigrationJournalValidationError ||
      error instanceof WorkspaceFirstStartMigrationJournalStoreError
    ) {
      return error;
    }
    if (error instanceof CrashSafeFileSlotError) {
      return error.failure === 'invalid'
        ? new WorkspaceFirstStartMigrationJournalValidationError()
        : new WorkspaceFirstStartMigrationJournalStoreError('unavailable');
    }
    if (error instanceof CrashSafeByteSlotStoreError) {
      return new WorkspaceFirstStartMigrationJournalStoreError('unavailable');
    }
    return new WorkspaceFirstStartMigrationJournalStoreError('unavailable');
  }
}

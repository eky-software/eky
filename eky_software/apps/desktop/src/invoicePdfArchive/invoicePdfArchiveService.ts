import { basename } from 'node:path';

import { InvoicePdfArchiveConfigStore } from './invoicePdfArchiveConfig.js';
import { probeInvoicePdfArchiveDirectory } from './invoicePdfArchiveDirectoryProbe.js';
import {
  copyInvoicePdfToArchive,
  type LoadInvoicePdfArchiveDocument,
} from './invoicePdfArchiveFileCopy.js';
import { InvoicePdfArchiveJournalStore } from './invoicePdfArchiveJournal.js';
import {
  InvoicePdfArchiveError,
  type InvoicePdfArchiveSafeErrorCode,
  type InvoicePdfArchiveStatus,
  type InvoicePdfArchiveTask,
} from './invoicePdfArchiveTypes.js';
import type { ResolveInvoicePdfArchiveDirectory } from './workspaceInvoicePdfArchiveDirectory.js';

const maximumAutomaticRetryTasks = 10;
export const archiveDrainMilliseconds = 5_000;
export type ArchiveDrainResult = 'drained' | 'timedOut' | 'ioUncertain';
const retryDelaysMilliseconds = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  6 * 60 * 60_000,
] as const;

export interface InvoicePdfArchiveObserver {
  copyFailed(input: {
    attemptCount: number;
    durationMs: number;
    errorCode: InvoicePdfArchiveSafeErrorCode;
  }): void;
  copySucceeded(input: {
    attemptCount: number;
    durationMs: number;
  }): void;
  taskQueued(): void;
}

export class InvoicePdfArchiveService {
  private operationQueue = Promise.resolve();
  private sealed = false;
  private ioCompletionUncertain = false;
  private drainTask: Promise<ArchiveDrainResult> | undefined;
  private readonly waitingOperations = new Set<() => void>();

  constructor(
    private readonly dependencies: {
      configStore: InvoicePdfArchiveConfigStore;
      journalStore: InvoicePdfArchiveJournalStore;
      loadDocument: LoadInvoicePdfArchiveDocument;
      now?: () => Date;
      observer?: InvoicePdfArchiveObserver;
      probeDirectory?: (directoryPath: string) => Promise<void>;
      resolveArchiveDirectory?: ResolveInvoicePdfArchiveDirectory;
    },
  ) {}

  sealAndDrain(): Promise<ArchiveDrainResult> {
    if (this.drainTask !== undefined) return this.drainTask;
    this.sealed = true;
    for (const cancel of this.waitingOperations) cancel();
    this.waitingOperations.clear();
    const deadline = performance.now() + archiveDrainMilliseconds;
    this.drainTask = new Promise<ArchiveDrainResult>((resolve) => {
      let finished = false;
      const finish = (result: ArchiveDrainResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => finish('timedOut'), archiveDrainMilliseconds);
      void this.operationQueue.then(() => finish(
        performance.now() >= deadline ? 'timedOut' :
          this.ioCompletionUncertain ? 'ioUncertain' : 'drained',
      ));
    });
    return this.drainTask;
  }

  async chooseDirectory(directoryPath: string): Promise<InvoicePdfArchiveStatus> {
    return this.runExclusive(async () => {
      const archiveDirectory = await this.resolveArchiveDirectory(directoryPath);
      this.assertOpen();
      await (
        this.dependencies.probeDirectory ?? probeInvoicePdfArchiveDirectory
      )(archiveDirectory);
      this.assertOpen();
      await this.dependencies.configStore.enable(directoryPath);
      await this.retryPendingInternal(false);
      return this.getStatusInternal();
    });
  }

  async disable(): Promise<InvoicePdfArchiveStatus> {
    return this.runExclusive(async () => {
      await this.dependencies.configStore.disable();
      return this.getStatusInternal();
    });
  }

  async getDirectoryPath(): Promise<string | null> {
    return this.runExclusive(async () => {
      try {
        return (await this.dependencies.configStore.read())?.directoryPath ?? null;
      } catch (error) {
        this.observeFailure(error);
        return null;
      }
    });
  }

  async getOpenDirectoryPath(): Promise<string | null> {
    return this.runExclusive(async () => {
      try {
        const configuredRoot =
          (await this.dependencies.configStore.read())?.directoryPath ?? null;
        return configuredRoot === null
          ? null
          : await this.resolveArchiveDirectory(configuredRoot);
      } catch (error) {
        this.observeFailure(error);
        return null;
      }
    });
  }

  async getStatus(): Promise<InvoicePdfArchiveStatus> {
    return this.runExclusive(() => this.getStatusInternal());
  }

  async queueTask(
    task: InvoicePdfArchiveTask,
  ): Promise<{ archived: boolean; queued: boolean }> {
    return this.runExclusive(async () => {
      const config = await this.dependencies.configStore
        .read()
        .catch((error) => { this.observeFailure(error); return 'invalid' as const; });

      this.assertOpen();
      if (config === null) {
        return { archived: false, queued: false };
      }

      const queued = await this.dependencies.journalStore.queue(task);

      if (!queued) {
        const current = await this.dependencies.journalStore.get();
        return {
          archived: !current.tasks.some(
            (candidate) =>
              candidate.deliveryEventId === task.deliveryEventId,
          ),
          queued: false,
        };
      }

      this.dependencies.observer?.taskQueued();
      const archived = await this.attemptTask(task);
      return { archived, queued: true };
    });
  }

  async retryPending(
    automatic = false,
  ): Promise<InvoicePdfArchiveStatus> {
    return this.runExclusive(async () => {
      await this.retryPendingInternal(automatic);
      return this.getStatusInternal();
    });
  }

  private async attemptTask(task: InvoicePdfArchiveTask): Promise<boolean> {
    if (this.sealed) return false;
    let config;

    try {
      config = await this.dependencies.configStore.read();
    } catch (error) {
      const code = this.observeFailure(error);
      if (this.ioCompletionUncertain) throw error;
      await this.recordFailure(task, code);
      return false;
    }

    if (config === null || this.sealed) {
      return false;
    }

    const startedAt = Date.now();

    try {
      const archiveDirectory = await this.resolveArchiveDirectory(
        config.directoryPath,
      );
      if (this.sealed) return false;
      await copyInvoicePdfToArchive({
        directoryPath: archiveDirectory,
        loadDocument: this.dependencies.loadDocument,
        task,
      });
      const archivedAt = this.now().toISOString();
      await this.dependencies.journalStore.recordSuccess(
        task.taskId,
        archivedAt,
      );
      this.dependencies.observer?.copySucceeded({
        attemptCount: task.attemptCount + 1,
        durationMs: Date.now() - startedAt,
      });
      return true;
    } catch (error) {
      const errorCode = this.observeFailure(error);
      if (this.ioCompletionUncertain) throw error;
      await this.recordFailure(task, errorCode);
      this.dependencies.observer?.copyFailed({
        attemptCount: task.attemptCount + 1,
        durationMs: Date.now() - startedAt,
        errorCode,
      });
      return false;
    }
  }

  private async getStatusInternal(): Promise<InvoicePdfArchiveStatus> {
    const journal = await this.dependencies.journalStore.get();

    try {
      const config = await this.dependencies.configStore.read();
      return {
        displayName:
          config === null ? null : basename(config.directoryPath),
        enabled: config !== null,
        lastArchivedAt: journal.lastArchivedAt,
        lastSafeErrorCode: journal.lastSafeErrorCode,
        pendingCount: journal.tasks.length,
      };
    } catch (error) {
      return {
        displayName: null,
        enabled: false,
        lastArchivedAt: journal.lastArchivedAt,
        lastSafeErrorCode: this.observeFailure(error),
        pendingCount: journal.tasks.length,
      };
    }
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }

  private resolveArchiveDirectory(directoryPath: string): Promise<string> {
    return this.dependencies.resolveArchiveDirectory?.(directoryPath) ??
      Promise.resolve(directoryPath);
  }

  private async recordFailure(
    task: InvoicePdfArchiveTask,
    errorCode: InvoicePdfArchiveSafeErrorCode,
  ): Promise<void> {
    const delayIndex = Math.min(
      task.attemptCount,
      retryDelaysMilliseconds.length - 1,
    );
    const retryDelay =
      retryDelaysMilliseconds[delayIndex] ??
      6 * 60 * 60_000;
    const nextAttemptAt = new Date(
      this.now().getTime() + retryDelay,
    ).toISOString();
    await this.dependencies.journalStore.recordFailure(task.taskId, {
      errorCode,
      nextAttemptAt,
    });
  }

  private async retryPendingInternal(automatic: boolean): Promise<void> {
    const journal = await this.dependencies.journalStore.get();
    const now = this.now().getTime();
    const eligible = journal.tasks.filter(
      (task) =>
        (!automatic ||
          task.lastSafeErrorCode !== 'ARCHIVE_FILE_CONFLICT') &&
        (!automatic || Date.parse(task.nextAttemptAt) <= now),
    );
    const tasks = automatic
      ? eligible.slice(0, maximumAutomaticRetryTasks)
      : eligible;

    for (const task of tasks) {
      if (this.sealed) break;
      await this.attemptTask(task);
    }
  }

  private runExclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (this.sealed || this.ioCompletionUncertain) return Promise.reject(
      new InvoicePdfArchiveError('ARCHIVE_REQUEST_FAILED', false),
    );
    let cancel!: () => void;
    const cancelledBeforeStart = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new InvoicePdfArchiveError('ARCHIVE_REQUEST_FAILED', false));
    });
    this.waitingOperations.add(cancel);
    const result = this.operationQueue.then(async () => {
      this.waitingOperations.delete(cancel);
      this.assertOpen();
      try { return await operation(); }
      catch (error) { this.observeFailure(error); throw error; }
    });
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return Promise.race([result, cancelledBeforeStart]);
  }

  private assertOpen(): void {
    if (this.sealed || this.ioCompletionUncertain) {
      throw new InvoicePdfArchiveError('ARCHIVE_REQUEST_FAILED', false);
    }
  }

  private observeFailure(error: unknown): InvoicePdfArchiveSafeErrorCode {
    if (error instanceof InvoicePdfArchiveError && error.ioCompletionUncertain) {
      this.ioCompletionUncertain = true;
    }
    return readSafeErrorCode(error);
  }
}

function readSafeErrorCode(
  error: unknown,
): InvoicePdfArchiveSafeErrorCode {
  return error instanceof InvoicePdfArchiveError
    ? error.code
    : 'ARCHIVE_STORAGE_FAILED';
}

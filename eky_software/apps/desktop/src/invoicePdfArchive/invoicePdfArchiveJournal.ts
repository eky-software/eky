import { InvoicePdfArchiveAtomicJsonFile } from './invoicePdfArchiveAtomicJsonFile.js';
import { requireInvoicePdfArchiveJournalFilePath } from './invoicePdfArchivePaths.js';
import {
  invoicePdfArchiveSchemaVersion,
  isInvoicePdfArchiveSafeErrorCode,
  maximumArchivedInvoicePdfBytes,
  InvoicePdfArchiveError,
  type InvoicePdfArchiveJournal,
  type InvoicePdfArchiveSafeErrorCode,
  type InvoicePdfArchiveTask,
} from './invoicePdfArchiveTypes.js';

const identifierPattern = /^[A-Za-z0-9._:-]{1,200}$/;
const invoiceNumberPattern = /^\d{1,50}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const maximumPendingTasks = 10_000;

export class InvoicePdfArchiveJournalStore {
  private readonly file: InvoicePdfArchiveAtomicJsonFile<InvoicePdfArchiveJournal>;

  constructor(filePath: string) {
    this.file = new InvoicePdfArchiveAtomicJsonFile(
      requireInvoicePdfArchiveJournalFilePath(filePath),
      parseInvoicePdfArchiveJournal,
      'ARCHIVE_JOURNAL_INVALID',
    );
  }

  async get(): Promise<InvoicePdfArchiveJournal> {
    return (await this.file.read()) ?? createEmptyJournal();
  }

  async queue(task: InvoicePdfArchiveTask): Promise<boolean> {
    const validTask = parseInvoicePdfArchiveTask(task);
    const journal = await this.get();

    if (
      journal.tasks.some(
        (current) =>
          current.taskId === validTask.taskId ||
          current.deliveryEventId === validTask.deliveryEventId,
      )
    ) {
      return false;
    }
    if (journal.tasks.length >= maximumPendingTasks) {
      throw new InvoicePdfArchiveError('ARCHIVE_STORAGE_FAILED', true);
    }

    await this.file.write({
      ...journal,
      tasks: [...journal.tasks, validTask],
    });
    return true;
  }

  async recordFailure(
    taskId: string,
    input: {
      errorCode: InvoicePdfArchiveSafeErrorCode;
      nextAttemptAt: string;
    },
  ): Promise<void> {
    const journal = await this.get();
    const nextAttemptAt = requireIsoTimestamp(input.nextAttemptAt);
    let found = false;
    const tasks = journal.tasks.map((task) => {
      if (task.taskId !== taskId) {
        return task;
      }

      found = true;
      return {
        ...task,
        attemptCount: task.attemptCount + 1,
        lastSafeErrorCode: input.errorCode,
        nextAttemptAt,
      };
    });

    if (!found) {
      return;
    }

    await this.file.write({
      ...journal,
      lastSafeErrorCode: input.errorCode,
      tasks,
    });
  }

  async recordSuccess(taskId: string, archivedAt: string): Promise<void> {
    const journal = await this.get();
    const tasks = journal.tasks.filter((task) => task.taskId !== taskId);

    if (tasks.length === journal.tasks.length) {
      return;
    }

    await this.file.write({
      ...journal,
      lastArchivedAt: requireIsoTimestamp(archivedAt),
      lastSafeErrorCode: null,
      tasks,
    });
  }
}

export function createEmptyJournal(): InvoicePdfArchiveJournal {
  return {
    lastArchivedAt: null,
    lastSafeErrorCode: null,
    schemaVersion: invoicePdfArchiveSchemaVersion,
    tasks: [],
  };
}

export function parseInvoicePdfArchiveJournal(
  value: unknown,
): InvoicePdfArchiveJournal {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'lastArchivedAt',
      'lastSafeErrorCode',
      'schemaVersion',
      'tasks',
    ]) ||
    value.schemaVersion !== invoicePdfArchiveSchemaVersion ||
    !isNullableTimestamp(value.lastArchivedAt) ||
    !isNullableSafeErrorCode(value.lastSafeErrorCode) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > maximumPendingTasks
  ) {
    throw new InvoicePdfArchiveError('ARCHIVE_JOURNAL_INVALID', false);
  }

  const tasks = value.tasks.map(parseInvoicePdfArchiveTask);
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const eventIds = new Set(tasks.map((task) => task.deliveryEventId));

  if (taskIds.size !== tasks.length || eventIds.size !== tasks.length) {
    throw new InvoicePdfArchiveError('ARCHIVE_JOURNAL_INVALID', false);
  }

  return {
    lastArchivedAt: value.lastArchivedAt,
    lastSafeErrorCode: value.lastSafeErrorCode,
    schemaVersion: invoicePdfArchiveSchemaVersion,
    tasks,
  };
}

export function parseInvoicePdfArchiveTask(
  value: unknown,
): InvoicePdfArchiveTask {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'attemptCount',
      'createdAt',
      'deliveryEventId',
      'documentId',
      'expectedPdfSha256',
      'expectedPdfSize',
      'invoiceId',
      'invoiceKind',
      'invoiceNumber',
      'lastSafeErrorCode',
      'nextAttemptAt',
      'schemaVersion',
      'taskId',
    ]) ||
    value.schemaVersion !== invoicePdfArchiveSchemaVersion ||
    !isIdentifier(value.taskId) ||
    !isIdentifier(value.deliveryEventId) ||
    !isIdentifier(value.documentId) ||
    !isIdentifier(value.invoiceId) ||
    typeof value.invoiceNumber !== 'string' ||
    !invoiceNumberPattern.test(value.invoiceNumber) ||
    (value.invoiceKind !== 'standard' && value.invoiceKind !== 'credit') ||
    typeof value.expectedPdfSha256 !== 'string' ||
    !sha256Pattern.test(value.expectedPdfSha256) ||
    typeof value.expectedPdfSize !== 'number' ||
    !Number.isSafeInteger(value.expectedPdfSize) ||
    value.expectedPdfSize < 1 ||
    value.expectedPdfSize > maximumArchivedInvoicePdfBytes ||
    typeof value.attemptCount !== 'number' ||
    !Number.isSafeInteger(value.attemptCount) ||
    value.attemptCount < 0 ||
    !isNullableSafeErrorCode(value.lastSafeErrorCode) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.nextAttemptAt)
  ) {
    throw new InvoicePdfArchiveError('ARCHIVE_JOURNAL_INVALID', false);
  }

  return {
    attemptCount: value.attemptCount,
    createdAt: value.createdAt,
    deliveryEventId: value.deliveryEventId,
    documentId: value.documentId,
    expectedPdfSha256: value.expectedPdfSha256,
    expectedPdfSize: value.expectedPdfSize,
    invoiceId: value.invoiceId,
    invoiceKind: value.invoiceKind,
    invoiceNumber: value.invoiceNumber,
    lastSafeErrorCode: value.lastSafeErrorCode,
    nextAttemptAt: value.nextAttemptAt,
    schemaVersion: invoicePdfArchiveSchemaVersion,
    taskId: value.taskId,
  };
}

function requireIsoTimestamp(value: string): string {
  if (!isIsoTimestamp(value)) {
    throw new InvoicePdfArchiveError('ARCHIVE_JOURNAL_INVALID', false);
  }
  return value;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifierPattern.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isoTimestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function isNullableSafeErrorCode(
  value: unknown,
): value is InvoicePdfArchiveSafeErrorCode | null {
  return value === null || isInvoicePdfArchiveSafeErrorCode(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

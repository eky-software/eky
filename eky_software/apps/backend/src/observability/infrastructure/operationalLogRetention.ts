import {
  lstatSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { basename } from 'node:path';

import { listKnownOperationalLogFiles } from './operationalLogFiles.js';

const detailedLogBudgetBytes = 500 * 1024 * 1024;
const fileNamePattern =
  /^(backend-info|backend-warning-error|backend-security)-(\d{4}-(?:0[1-9]|1[0-2]))-00[1-4]\.jsonl$/;

export interface OperationalLogRetentionResult {
  deletedByteCount: number;
  deletedFileCount: number;
  oldestRemainingMonth?: string;
}

export function maintainOperationalLogs(options: {
  activeFilePaths?: ReadonlySet<string>;
  logsRoot: string;
  now?: Date;
}): OperationalLogRetentionResult {
  const now = options.now ?? new Date();
  const activeFilePaths = options.activeFilePaths ?? new Set<string>();
  const candidates = listKnownOperationalLogFiles(options.logsRoot)
    .map(readCandidate)
    .filter((candidate): candidate is LogFileCandidate => candidate !== null);
  const result: OperationalLogRetentionResult = {
    deletedByteCount: 0,
    deletedFileCount: 0,
  };

  for (const candidate of candidates) {
    if (
      !activeFilePaths.has(candidate.filePath) &&
      isPastRetention(candidate, now)
    ) {
      removeCandidate(candidate, result);
    }
  }

  const remaining = candidates
    .filter((candidate) => candidate.exists)
    .sort(compareOldestFirst);
  let totalByteCount = remaining.reduce(
    (sum, candidate) => sum + candidate.byteCount,
    0,
  );

  for (const candidate of remaining) {
    if (totalByteCount <= detailedLogBudgetBytes) {
      break;
    }
    if (activeFilePaths.has(candidate.filePath)) {
      continue;
    }

    removeCandidate(candidate, result);
    totalByteCount -= candidate.byteCount;
  }

  const oldestRemainingMonth = candidates
    .filter((candidate) => candidate.exists)
    .sort(compareOldestFirst)[0]?.month;
  if (oldestRemainingMonth !== undefined) {
    result.oldestRemainingMonth = oldestRemainingMonth;
  }

  return result;
}

interface LogFileCandidate {
  byteCount: number;
  exists: boolean;
  filePath: string;
  month: string;
  stream: 'backend-info' | 'backend-warning-error' | 'backend-security';
}

function readCandidate(filePath: string): LogFileCandidate | null {
  const match = fileNamePattern.exec(basename(filePath));
  if (match === null) {
    return null;
  }
  const stream = match[1];
  const month = match[2];
  if (
    month === undefined ||
    !isKnownStream(stream)
  ) {
    return null;
  }

  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return null;
  }

  return {
    byteCount: statSync(filePath).size,
    exists: true,
    filePath,
    month,
    stream,
  };
}

function isKnownStream(
  value: string | undefined,
): value is LogFileCandidate['stream'] {
  return (
    value === 'backend-info' ||
    value === 'backend-warning-error' ||
    value === 'backend-security'
  );
}

function isPastRetention(candidate: LogFileCandidate, now: Date): boolean {
  const retainedMonths = candidate.stream === 'backend-info' ? 12 : 24;
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - retainedMonths, 1),
  );
  const cutoffMonth = cutoff.toISOString().slice(0, 7);
  const currentMonth = now.toISOString().slice(0, 7);

  return candidate.month < cutoffMonth && candidate.month <= currentMonth;
}

function removeCandidate(
  candidate: LogFileCandidate,
  result: OperationalLogRetentionResult,
): void {
  if (!candidate.exists) {
    return;
  }

  try {
    unlinkSync(candidate.filePath);
    candidate.exists = false;
    result.deletedByteCount += candidate.byteCount;
    result.deletedFileCount += 1;
  } catch {
    // Maintenance is best effort and must not stop the application.
  }
}

function compareOldestFirst(
  left: LogFileCandidate,
  right: LogFileCandidate,
): number {
  return left.month.localeCompare(right.month) ||
    left.filePath.localeCompare(right.filePath);
}

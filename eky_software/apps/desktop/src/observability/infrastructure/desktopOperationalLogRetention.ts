import {
  lstatSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

const detailedLogBudgetBytes = 500 * 1024 * 1024;
const knownFilePattern =
  /^(backend-info|backend-warning-error|backend-security|desktop-info|desktop-warning-error|desktop-security)-(\d{4}-(?:0[1-9]|1[0-2]))-00[1-4]\.jsonl$/;

export interface DesktopOperationalLogRetentionResult {
  deletedByteCount: number;
  deletedFileCount: number;
  oldestRemainingMonth?: string;
}

interface LogCandidate {
  byteCount: number;
  exists: boolean;
  filePath: string;
  month: string;
  stream: string;
}

export function maintainDesktopOperationalLogs(options: {
  logsRoot: string;
  now?: Date;
}): DesktopOperationalLogRetentionResult {
  const logsRoot = requireAbsoluteRoot(options.logsRoot);
  const now = options.now ?? new Date();
  const candidates = listCandidates(logsRoot);
  const result: DesktopOperationalLogRetentionResult = {
    deletedByteCount: 0,
    deletedFileCount: 0,
  };

  for (const candidate of candidates) {
    if (isPastRetention(candidate, now)) {
      removeCandidate(candidate, result);
    }
  }

  const remaining = candidates
    .filter((candidate) => candidate.exists)
    .sort(compareOldestFirst);
  let totalBytes = remaining.reduce(
    (total, candidate) => total + candidate.byteCount,
    0,
  );

  for (const candidate of remaining) {
    if (totalBytes <= detailedLogBudgetBytes) {
      break;
    }

    removeCandidate(candidate, result);
    totalBytes -= candidate.byteCount;
  }

  const oldestRemainingMonth = candidates
    .filter((candidate) => candidate.exists)
    .sort(compareOldestFirst)[0]?.month;

  return oldestRemainingMonth === undefined
    ? result
    : { ...result, oldestRemainingMonth };
}

function listCandidates(logsRoot: string): LogCandidate[] {
  const candidates: LogCandidate[] = [];

  for (const directoryName of ['backend', 'desktop', 'security']) {
    const directory = join(logsRoot, directoryName);
    let directoryStats: ReturnType<typeof lstatSync>;

    try {
      directoryStats = lstatSync(directory);
    } catch {
      continue;
    }

    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      continue;
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        continue;
      }

      const filePath = join(directory, entry.name);
      const match = knownFilePattern.exec(basename(filePath));
      const stream = match?.[1];
      const month = match?.[2];

      if (stream === undefined || month === undefined) {
        continue;
      }

      candidates.push({
        byteCount: statSync(filePath).size,
        exists: true,
        filePath,
        month,
        stream,
      });
    }
  }

  return candidates;
}

function isPastRetention(candidate: LogCandidate, now: Date): boolean {
  const retainedMonths = candidate.stream.endsWith('-info') ? 12 : 24;
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - retainedMonths, 1),
  );
  const currentMonth = now.toISOString().slice(0, 7);

  return (
    candidate.month < cutoff.toISOString().slice(0, 7) &&
    candidate.month <= currentMonth
  );
}

function removeCandidate(
  candidate: LogCandidate,
  result: DesktopOperationalLogRetentionResult,
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
    // Retention is best effort and must not stop desktop startup.
  }
}

function compareOldestFirst(left: LogCandidate, right: LogCandidate): number {
  return (
    left.month.localeCompare(right.month) ||
    left.filePath.localeCompare(right.filePath)
  );
}

function requireAbsoluteRoot(logsRoot: string): string {
  const absolute = resolve(logsRoot);
  if (absolute !== logsRoot) {
    throw new Error('Desktop logs root must be an absolute normalized path.');
  }
  return absolute;
}

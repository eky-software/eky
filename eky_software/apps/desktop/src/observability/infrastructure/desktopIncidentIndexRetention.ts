import {
  type Dirent,
  lstatSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export const desktopIncidentIndexBudgetBytes = 25 * 1024 * 1024;

const filePattern =
  /^(?:backend|desktop)-incident-index-(\d{4})\.jsonl$/;

interface IncidentIndexCandidate {
  byteCount: number;
  exists: boolean;
  filePath: string;
  year: number;
}

export function maintainDesktopIncidentIndex(options: {
  activeYear?: number;
  logsRoot: string;
  now?: Date;
}): {
  deletedByteCount: number;
  deletedFileCount: number;
  // Includes future files; an unknown census is saturated to block writes.
  totalByteCount: number;
} {
  const { candidates, capacityUnknown } = listCandidates(options.logsRoot);
  const currentYear = (options.now ?? new Date()).getUTCFullYear();
  let deletedByteCount = 0;
  let deletedFileCount = 0;

  for (const candidate of candidates) {
    if (
      candidate.year < currentYear - 10 &&
      candidate.year !== options.activeYear &&
      removeCandidate(candidate)
    ) {
      deletedByteCount += candidate.byteCount;
      deletedFileCount += 1;
    }
  }

  let totalByteCount = candidates
    .filter((candidate) => candidate.exists)
    .reduce((total, candidate) => total + candidate.byteCount, 0);
  // The writer's capacity total still includes future files; deletion does not.
  let retentionByteCount = candidates
    .filter((candidate) => candidate.exists && candidate.year <= currentYear)
    .reduce((total, candidate) => total + candidate.byteCount, 0);

  for (const candidate of candidates.sort(
    (left, right) =>
      left.year - right.year || left.filePath.localeCompare(right.filePath),
  )) {
    if (retentionByteCount <= desktopIncidentIndexBudgetBytes) {
      break;
    }
    if (
      candidate.year <= currentYear &&
      candidate.year !== options.activeYear &&
      removeCandidate(candidate)
    ) {
      totalByteCount -= candidate.byteCount;
      retentionByteCount -= candidate.byteCount;
      deletedByteCount += candidate.byteCount;
      deletedFileCount += 1;
    }
  }

  return {
    deletedByteCount,
    deletedFileCount,
    // An incomplete census must not admit an index write.
    totalByteCount: capacityUnknown
      ? Math.max(totalByteCount, desktopIncidentIndexBudgetBytes)
      : totalByteCount,
  };
}

function listCandidates(logsRoot: string): {
  candidates: IncidentIndexCandidate[];
  capacityUnknown: boolean;
} {
  const root = requireAbsoluteRoot(logsRoot);
  const directory = join(root, 'incident-index');
  let directoryStats: ReturnType<typeof lstatSync>;

  try {
    directoryStats = lstatSync(directory);
  } catch (error) {
    return { candidates: [], capacityUnknown: !isMissingFile(error) };
  }

  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    return { candidates: [], capacityUnknown: true };
  }

  const candidates: IncidentIndexCandidate[] = [];
  let capacityUnknown = false;
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return { candidates, capacityUnknown: true };
  }

  for (const entry of entries) {
    const match = filePattern.exec(entry.name);
    const year = Number(match?.[1]);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !Number.isInteger(year)
    ) {
      continue;
    }

    const filePath = join(directory, entry.name);
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(filePath);
    } catch (error) {
      capacityUnknown ||= !isMissingFile(error);
      continue;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      capacityUnknown = true;
      continue;
    }
    candidates.push({
      byteCount: stats.size,
      exists: true,
      filePath,
      year,
    });
  }

  return { candidates, capacityUnknown };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function removeCandidate(candidate: IncidentIndexCandidate): boolean {
  if (!candidate.exists) {
    return false;
  }

  try {
    unlinkSync(candidate.filePath);
    candidate.exists = false;
    return true;
  } catch {
    return false;
  }
}

function requireAbsoluteRoot(logsRoot: string): string {
  const absolute = resolve(logsRoot);
  if (absolute !== logsRoot) {
    throw new Error('Desktop incident index root must be absolute.');
  }
  return absolute;
}

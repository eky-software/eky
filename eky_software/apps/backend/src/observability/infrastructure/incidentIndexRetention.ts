import {
  lstatSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export const incidentIndexBudgetBytes = 25 * 1024 * 1024;

const filePattern =
  /^(?:backend|desktop)-incident-index-(\d{4})\.jsonl$/;

interface IncidentIndexCandidate {
  byteCount: number;
  exists: boolean;
  filePath: string;
  year: number;
}

export function maintainIncidentIndex(options: {
  activeYear?: number;
  logsRoot: string;
  now?: Date;
}): {
  deletedByteCount: number;
  deletedFileCount: number;
  totalByteCount: number;
} {
  const candidates = listIncidentIndexCandidates(options.logsRoot);
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

  for (const candidate of candidates.sort(
    (left, right) => left.year - right.year,
  )) {
    if (totalByteCount <= incidentIndexBudgetBytes) {
      break;
    }
    if (
      candidate.year !== options.activeYear &&
      removeCandidate(candidate)
    ) {
      totalByteCount -= candidate.byteCount;
      deletedByteCount += candidate.byteCount;
      deletedFileCount += 1;
    }
  }

  return { deletedByteCount, deletedFileCount, totalByteCount };
}

function listIncidentIndexCandidates(logsRoot: string): IncidentIndexCandidate[] {
  const root = resolve(logsRoot);
  if (root !== logsRoot) {
    throw new Error('Incident index root must be absolute and normalized.');
  }

  const directory = join(root, 'incident-index');
  let directoryStats: ReturnType<typeof lstatSync>;

  try {
    directoryStats = lstatSync(directory);
  } catch {
    return [];
  }

  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    return [];
  }

  const candidates: IncidentIndexCandidate[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
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
    candidates.push({
      byteCount: statSync(filePath).size,
      exists: true,
      filePath,
      year,
    });
  }

  return candidates;
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

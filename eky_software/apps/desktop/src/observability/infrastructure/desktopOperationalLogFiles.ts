import {
  lstatSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const maximumSegmentBytes = 5 * 1024 * 1024;
const maximumSegmentsPerMonth = 4;

export type DesktopOperationalLogStream =
  | 'desktop-info'
  | 'desktop-warning-error'
  | 'desktop-security';

export function selectDesktopOperationalLogFile(input: {
  lineByteCount: number;
  logsRoot: string;
  month: string;
  stream: DesktopOperationalLogStream;
}): { filePath: string; outcome: 'selected' } | {
  outcome: 'capacityReached';
} {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
    throw new Error('Desktop operational log month is invalid.');
  }
  if (
    !Number.isSafeInteger(input.lineByteCount) ||
    input.lineByteCount <= 0 ||
    input.lineByteCount > maximumSegmentBytes
  ) {
    throw new Error('Desktop operational log line size is invalid.');
  }

  const logsRoot = resolve(input.logsRoot);
  if (logsRoot !== input.logsRoot) {
    throw new Error('Desktop logs root must be an absolute normalized path.');
  }

  const directory = join(
    logsRoot,
    input.stream === 'desktop-security' ? 'security' : 'desktop',
  );
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const directoryStats = lstatSync(directory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new Error('Desktop log directory is not safe.');
  }

  for (let segment = 1; segment <= maximumSegmentsPerMonth; segment += 1) {
    const filePath = join(
      directory,
      `${input.stream}-${input.month}-${String(segment).padStart(3, '0')}.jsonl`,
    );
    const size = getSafeFileSize(filePath);
    if (size === undefined || size + input.lineByteCount <= maximumSegmentBytes) {
      return { filePath, outcome: 'selected' };
    }
  }

  return { outcome: 'capacityReached' };
}

function getSafeFileSize(filePath: string): number | undefined {
  try {
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('Desktop log target is not a safe regular file.');
    }
    return statSync(filePath).size;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
}

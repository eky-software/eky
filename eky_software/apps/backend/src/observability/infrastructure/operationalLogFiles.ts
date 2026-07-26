import {
  lstatSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export const operationalLogSegmentMaximumBytes = 5 * 1024 * 1024;
export const operationalLogSegmentsPerMonth = 4;

const fileNamePattern =
  /^(backend-info|backend-warning-error|backend-security)-(\d{4}-(?:0[1-9]|1[0-2]))-(00[1-4])\.jsonl$/;

export type BackendOperationalLogStream =
  | 'backend-info'
  | 'backend-warning-error'
  | 'backend-security';

export interface SelectedOperationalLogFile {
  filePath: string;
  outcome: 'selected';
}

export interface OperationalLogCapacityReached {
  outcome: 'capacityReached';
}

export function selectMonthlyOperationalLogFile(input: {
  lineByteCount: number;
  logsRoot: string;
  month: string;
  stream: BackendOperationalLogStream;
}): OperationalLogCapacityReached | SelectedOperationalLogFile {
  assertKnownMonth(input.month);
  assertSafeLineByteCount(input.lineByteCount);

  const directory = getOperationalLogDirectory(input.logsRoot, input.stream);
  ensureSafeDirectory(directory);

  for (
    let segment = 1;
    segment <= operationalLogSegmentsPerMonth;
    segment += 1
  ) {
    const fileName = `${input.stream}-${input.month}-${String(segment).padStart(3, '0')}.jsonl`;
    const filePath = join(directory, fileName);

    if (!isExistingSafeRegularFile(filePath)) {
      return { filePath, outcome: 'selected' };
    }

    const size = statSync(filePath).size;
    if (size + input.lineByteCount <= operationalLogSegmentMaximumBytes) {
      return { filePath, outcome: 'selected' };
    }
  }

  return { outcome: 'capacityReached' };
}

export function listKnownOperationalLogFiles(logsRoot: string): string[] {
  const absoluteLogsRoot = requireAbsoluteRoot(logsRoot);
  const directories = ['backend', 'security'];
  const files: string[] = [];

  for (const directoryName of directories) {
    const directory = join(absoluteLogsRoot, directoryName);
    if (!isExistingSafeDirectory(directory)) {
      continue;
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        fileNamePattern.test(entry.name)
      ) {
        files.push(join(directory, entry.name));
      }
    }
  }

  return files.sort();
}

function getOperationalLogDirectory(
  logsRoot: string,
  stream: BackendOperationalLogStream,
): string {
  const root = requireAbsoluteRoot(logsRoot);
  return join(root, stream === 'backend-security' ? 'security' : 'backend');
}

function requireAbsoluteRoot(logsRoot: string): string {
  const absolute = resolve(logsRoot);
  if (absolute !== logsRoot) {
    throw new Error('Operational logs root must be an absolute normalized path.');
  }

  return absolute;
}

function ensureSafeDirectory(directory: string): void {
  mkdirSync(directory, { mode: 0o700, recursive: true });
  if (!isExistingSafeDirectory(directory)) {
    throw new Error('Operational log directory is not a safe directory.');
  }
}

function isExistingSafeDirectory(directory: string): boolean {
  try {
    const stats = lstatSync(directory);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function isExistingSafeRegularFile(filePath: string): boolean {
  try {
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error('Operational log target is not a safe regular file.');
    }
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

function assertKnownMonth(month: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Operational log month is invalid.');
  }
}

function assertSafeLineByteCount(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > operationalLogSegmentMaximumBytes
  ) {
    throw new Error('Operational log line size is invalid.');
  }
}

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { maintainOperationalLogs } from './operationalLogRetention.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('maintainOperationalLogs', () => {
  it('applies stream-specific retention and ignores future files', () => {
    const logsRoot = createLogsRoot();
    writeLog(logsRoot, 'backend', 'backend-info-2024-01-001.jsonl');
    writeLog(
      logsRoot,
      'backend',
      'backend-warning-error-2025-01-001.jsonl',
    );
    writeLog(
      logsRoot,
      'security',
      'backend-security-2028-01-001.jsonl',
    );

    const result = maintainOperationalLogs({
      logsRoot,
      now: new Date('2026-07-26T20:00:00.000Z'),
    });

    expect(result).toMatchObject({
      deletedByteCount: 2,
      deletedFileCount: 1,
      oldestRemainingMonth: '2025-01',
    });
  });

  it('does not delete a caller-declared active file', () => {
    const logsRoot = createLogsRoot();
    const activeFile = writeLog(
      logsRoot,
      'backend',
      'backend-info-2020-01-001.jsonl',
    );

    expect(
      maintainOperationalLogs({
        activeFilePaths: new Set([activeFile]),
        logsRoot,
        now: new Date('2026-07-26T20:00:00.000Z'),
      }),
    ).toEqual({
      deletedByteCount: 0,
      deletedFileCount: 0,
      oldestRemainingMonth: '2020-01',
    });
  });
});

function createLogsRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'eky-retention-'));
  temporaryDirectories.push(directory);
  return join(directory, 'logs');
}

function writeLog(
  logsRoot: string,
  directoryName: 'backend' | 'security',
  fileName: string,
): string {
  const directory = join(logsRoot, directoryName);
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, fileName);
  writeFileSync(filePath, 'x\n', 'utf8');
  return filePath;
}

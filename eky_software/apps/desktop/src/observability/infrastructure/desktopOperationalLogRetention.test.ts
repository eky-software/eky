import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { maintainDesktopOperationalLogs } from './desktopOperationalLogRetention.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('maintainDesktopOperationalLogs', () => {
  it('retains info and warning/security streams for their own periods', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-desktop-retention-'));
    temporaryDirectories.push(root);
    const logsRoot = join(root, 'logs');

    writeLog(logsRoot, 'desktop', 'desktop-info-2024-01-001.jsonl');
    writeLog(
      logsRoot,
      'desktop',
      'desktop-warning-error-2024-01-001.jsonl',
    );
    writeLog(
      logsRoot,
      'security',
      'backend-security-2028-01-001.jsonl',
    );

    expect(
      maintainDesktopOperationalLogs({
        logsRoot,
        now: new Date('2026-07-26T20:00:00.000Z'),
      }),
    ).toMatchObject({
      deletedByteCount: 2,
      deletedFileCount: 1,
      oldestRemainingMonth: '2024-01',
    });
  });
});

function writeLog(
  logsRoot: string,
  directoryName: 'desktop' | 'security',
  fileName: string,
): void {
  const directory = join(logsRoot, directoryName);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, fileName), 'x\n', 'utf8');
}

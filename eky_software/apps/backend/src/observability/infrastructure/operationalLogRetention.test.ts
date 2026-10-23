import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { maintainOperationalLogs } from './operationalLogRetention.js';

const temporaryDirectories: string[] = [];
const now = new Date('2026-07-26T20:00:00.000Z');
const io = vi.hoisted(() => ({
  byteCounts: new Map<string, number>(),
  directoryErrors: new Map<string, string>(),
  disappearingFiles: new Set<string>(),
  metadataErrors: new Map<string, string>(),
  unlinkErrors: new Map<string, string>(),
  unsafePaths: new Map<string, 'symlink' | 'directory'>(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    lstatSync: vi.fn((...args: Parameters<typeof actual.lstatSync>) => {
      const path = String(args[0]);
      const code = io.metadataErrors.get(path);
      if (code !== undefined) {
        throw Object.assign(new Error('Synthetic metadata failure.'), { code });
      }
      if (io.disappearingFiles.delete(path)) {
        actual.unlinkSync(path);
      }
      const stats = actual.lstatSync(...args);
      if (stats === undefined) {
        return stats;
      }
      const byteCount = io.byteCounts.get(path);
      if (byteCount !== undefined) {
        Object.assign(stats, { size: byteCount });
      }
      if (io.unsafePaths.has(path)) {
        Object.assign(stats, {
          isFile: () => false,
          isSymbolicLink: () => io.unsafePaths.get(path) === 'symlink',
        });
      }
      return stats;
    }),
    readdirSync: vi.fn((...args: Parameters<typeof actual.readdirSync>) => {
      const code = io.directoryErrors.get(String(args[0]));
      if (code !== undefined) {
        throw Object.assign(new Error('Synthetic directory failure.'), { code });
      }
      return actual.readdirSync(...args);
    }),
    unlinkSync: vi.fn((path: Parameters<typeof actual.unlinkSync>[0]) => {
      const code = io.unlinkErrors.get(String(path));
      if (code !== undefined) {
        throw Object.assign(new Error('Synthetic unlink failure.'), { code });
      }
      actual.unlinkSync(path);
    }),
  };
});

beforeEach(() => {
  for (const control of Object.values(io)) {
    control.clear();
  }
  vi.clearAllMocks();
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('maintainOperationalLogs', () => {
  it('retains the exact monthly cutoffs for info and warning/security', () => {
    const logsRoot = createLogsRoot();
    const expiredInfo = writeLog(logsRoot, 'backend', 'backend-info-2025-06-001.jsonl');
    const retainedInfo = writeLog(logsRoot, 'backend', 'backend-info-2025-07-001.jsonl');
    const expiredWarning = writeLog(logsRoot, 'backend', 'backend-warning-error-2024-06-001.jsonl');
    const retainedWarning = writeLog(logsRoot, 'backend', 'backend-warning-error-2024-07-001.jsonl');
    const expiredSecurity = writeLog(logsRoot, 'security', 'backend-security-2024-06-001.jsonl');
    const retainedSecurity = writeLog(logsRoot, 'security', 'backend-security-2024-07-001.jsonl');

    expect(maintainOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 6,
      deletedFileCount: 3,
      oldestRemainingMonth: '2024-07',
    });
    for (const path of [expiredInfo, expiredWarning, expiredSecurity]) {
      expect(existsSync(path)).toBe(false);
    }
    for (const path of [retainedInfo, retainedWarning, retainedSecurity]) {
      expect(existsSync(path)).toBe(true);
    }
  });

  it('does not delete future files when all eligible quota deletions fail', () => {
    const logsRoot = createLogsRoot();
    const oldest = writeLog(logsRoot, 'backend', 'backend-info-2025-08-001.jsonl');
    const current = writeLog(logsRoot, 'backend', 'backend-info-2026-07-001.jsonl');
    const future = writeLog(logsRoot, 'security', 'backend-security-2027-01-001.jsonl');
    for (const path of [oldest, current]) {
      io.byteCounts.set(path, 300 * 1024 * 1024);
      io.unlinkErrors.set(path, 'EIO');
    }
    io.byteCounts.set(future, 600 * 1024 * 1024);

    expect(maintainOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 0,
      deletedFileCount: 0,
      oldestRemainingMonth: '2025-08',
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[oldest], [current]]);
    expect(existsSync(future)).toBe(true);
  });

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

  it('excludes future months from quota pressure and deletion', () => {
    const logsRoot = createLogsRoot();
    const retained = writeLog(logsRoot, 'backend', 'backend-info-2026-06-001.jsonl');
    const current = writeLog(logsRoot, 'backend', 'backend-info-2026-07-001.jsonl');
    const future = writeLog(logsRoot, 'security', 'backend-security-2026-08-001.jsonl');
    io.byteCounts.set(retained, 200 * 1024 * 1024);
    io.byteCounts.set(current, 300 * 1024 * 1024);
    io.byteCounts.set(future, 600 * 1024 * 1024);

    expect(maintainOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 0,
      deletedFileCount: 0,
      oldestRemainingMonth: '2026-06',
    });
    expect(unlinkSync).not.toHaveBeenCalled();
    expect(existsSync(future)).toBe(true);
  });

  it('still evicts eligible history under current quota pressure and protects active files', () => {
    const logsRoot = createLogsRoot();
    const active = writeLog(logsRoot, 'backend', 'backend-info-2025-08-001.jsonl');
    const oldest = writeLog(logsRoot, 'backend', 'backend-info-2025-09-001.jsonl');
    const current = writeLog(logsRoot, 'backend', 'backend-info-2026-07-001.jsonl');
    const future = writeLog(logsRoot, 'security', 'backend-security-2027-01-001.jsonl');
    io.byteCounts.set(active, 200 * 1024 * 1024);
    io.byteCounts.set(oldest, 200 * 1024 * 1024);
    io.byteCounts.set(current, 200 * 1024 * 1024);
    io.byteCounts.set(future, 600 * 1024 * 1024);

    expect(maintainOperationalLogs({ activeFilePaths: new Set([active]), logsRoot, now }))
      .toEqual({
        deletedByteCount: 200 * 1024 * 1024,
        deletedFileCount: 1,
        oldestRemainingMonth: '2025-08',
      });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[oldest]]);
    expect(existsSync(active)).toBe(true);
    expect(existsSync(future)).toBe(true);
  });

  it('does not subtract failed quota deletions and continues with later candidates', () => {
    const logsRoot = createLogsRoot();
    const failed = writeLog(logsRoot, 'backend', 'backend-info-2025-08-001.jsonl');
    const deleted = writeLog(logsRoot, 'backend', 'backend-info-2025-09-001.jsonl');
    const current = writeLog(logsRoot, 'backend', 'backend-info-2026-07-001.jsonl');
    for (const path of [failed, deleted, current]) {
      io.byteCounts.set(path, 200 * 1024 * 1024);
    }
    io.unlinkErrors.set(failed, 'EACCES');

    expect(maintainOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 200 * 1024 * 1024,
      deletedFileCount: 1,
      oldestRemainingMonth: '2025-08',
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[failed], [deleted]]);
    expect(existsSync(failed)).toBe(true);
    expect(existsSync(deleted)).toBe(false);
    expect(existsSync(current)).toBe(true);
  });

  it.each(['EACCES', 'EIO', 'ENOENT'])('survives a %s directory listing failure', (code) => {
    const logsRoot = createLogsRoot();
    const file = writeLog(logsRoot, 'backend', 'backend-info-2020-01-001.jsonl');
    io.directoryErrors.set(join(logsRoot, 'backend'), code);

    expect(maintainOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 0,
      deletedFileCount: 0,
    });
    expect(existsSync(file)).toBe(true);
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it.each(['EACCES', 'EIO', 'ENOENT'])('continues in a healthy directory after a %s listing failure', (code) => {
    const logsRoot = createLogsRoot();
    const blocked = writeLog(logsRoot, 'backend', 'backend-info-2020-01-001.jsonl');
    const healthy = writeLog(logsRoot, 'security', 'backend-security-2020-01-001.jsonl');
    io.directoryErrors.set(join(logsRoot, 'backend'), code);

    expect(maintainOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[healthy]]);
    expect(existsSync(blocked)).toBe(true);
    expect(existsSync(healthy)).toBe(false);
  });

  it.each(['EACCES', 'EIO'])('continues after a %s directory metadata failure', (code) => {
    const logsRoot = createLogsRoot();
    const blocked = writeLog(logsRoot, 'backend', 'backend-info-2020-01-001.jsonl');
    const healthy = writeLog(logsRoot, 'security', 'backend-security-2020-01-001.jsonl');
    io.metadataErrors.set(join(logsRoot, 'backend'), code);

    expect(maintainOperationalLogs({ logsRoot, now }).deletedFileCount).toBe(1);
    expect(existsSync(blocked)).toBe(true);
    expect(existsSync(healthy)).toBe(false);
  });

  it.each(['EACCES', 'EIO', 'ENOENT'])('skips a %s file metadata failure and retains other work', (code) => {
    const logsRoot = createLogsRoot();
    const failed = writeLog(logsRoot, 'backend', 'backend-info-2020-01-001.jsonl');
    const healthy = writeLog(logsRoot, 'backend', 'backend-info-2020-02-001.jsonl');
    io.metadataErrors.set(failed, code);

    expect(maintainOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[healthy]]);
    expect(existsSync(failed)).toBe(true);
  });

  it('ignores a file that disappears after listing', () => {
    const logsRoot = createLogsRoot();
    const missing = writeLog(logsRoot, 'backend', 'backend-info-2020-01-001.jsonl');
    const healthy = writeLog(logsRoot, 'backend', 'backend-info-2020-02-001.jsonl');
    io.disappearingFiles.add(missing);

    expect(maintainOperationalLogs({ logsRoot, now }).deletedFileCount).toBe(1);
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[healthy]]);
    expect(existsSync(missing)).toBe(false);
  });

  it.each(['EACCES', 'EIO', 'ENOENT'])('counts only successful age deletions after %s unlink failure', (code) => {
    const logsRoot = createLogsRoot();
    const failed = writeLog(logsRoot, 'backend', 'backend-info-2020-01-001.jsonl');
    const healthy = writeLog(logsRoot, 'backend', 'backend-info-2020-02-001.jsonl');
    io.unlinkErrors.set(failed, code);

    expect(maintainOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
      oldestRemainingMonth: '2020-01',
    });
    expect(existsSync(failed)).toBe(true);
    expect(existsSync(healthy)).toBe(false);
  });

  it('skips unknown names and files replaced by symlinks or directories after listing', () => {
    const logsRoot = createLogsRoot();
    const unknown = writeLog(logsRoot, 'backend', 'notes.txt');
    const symlink = writeLog(logsRoot, 'backend', 'backend-info-2020-01-001.jsonl');
    const directory = writeLog(logsRoot, 'backend', 'backend-info-2020-02-001.jsonl');
    const unreadable = writeLog(logsRoot, 'backend', 'backend-info-2020-03-001.jsonl');
    const healthy = writeLog(logsRoot, 'security', 'backend-security-2020-01-001.jsonl');
    io.unsafePaths.set(symlink, 'symlink');
    io.unsafePaths.set(directory, 'directory');
    io.metadataErrors.set(unreadable, 'EACCES');

    expect(maintainOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[healthy]]);
    expect(lstatSync).not.toHaveBeenCalledWith(unknown);
    for (const preserved of [unknown, symlink, directory, unreadable]) {
      expect(existsSync(preserved)).toBe(true);
    }
    expect(existsSync(healthy)).toBe(false);
  });

  it('does not traverse a symlinked known directory', () => {
    const logsRoot = createLogsRoot();
    writeLog(logsRoot, 'backend', 'backend-info-2020-01-001.jsonl');
    io.unsafePaths.set(join(logsRoot, 'backend'), 'symlink');

    expect(maintainOperationalLogs({ logsRoot, now }).deletedFileCount).toBe(0);
    expect(readdirSync).not.toHaveBeenCalled();
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it.each(['relative/logs', '/synthetic/logs/../logs'])('rejects invalid root %s before filesystem I/O', (logsRoot) => {
    expect(() => maintainOperationalLogs({ logsRoot, now })).toThrow('absolute normalized');
    expect(lstatSync).not.toHaveBeenCalled();
    expect(readdirSync).not.toHaveBeenCalled();
    expect(unlinkSync).not.toHaveBeenCalled();
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

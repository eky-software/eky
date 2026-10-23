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

import { maintainDesktopOperationalLogs } from './desktopOperationalLogRetention.js';

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

describe('maintainDesktopOperationalLogs', () => {
  it('retains the exact monthly cutoffs for info and warning/security', () => {
    const logsRoot = createLogsRoot();
    const expiredInfo = writeLog(logsRoot, 'desktop', 'desktop-info-2025-06-001.jsonl');
    const retainedInfo = writeLog(logsRoot, 'desktop', 'desktop-info-2025-07-001.jsonl');
    const expiredWarning = writeLog(logsRoot, 'desktop', 'desktop-warning-error-2024-06-001.jsonl');
    const retainedWarning = writeLog(logsRoot, 'desktop', 'desktop-warning-error-2024-07-001.jsonl');
    const expiredSecurity = writeLog(logsRoot, 'security', 'desktop-security-2024-06-001.jsonl');
    const retainedSecurity = writeLog(logsRoot, 'security', 'desktop-security-2024-07-001.jsonl');

    expect(maintainDesktopOperationalLogs({ logsRoot, now })).toEqual({
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
    const oldest = writeLog(logsRoot, 'desktop', 'desktop-info-2025-08-001.jsonl');
    const current = writeLog(logsRoot, 'desktop', 'desktop-info-2026-07-001.jsonl');
    const future = writeLog(logsRoot, 'security', 'desktop-security-2027-01-001.jsonl');
    for (const path of [oldest, current]) {
      io.byteCounts.set(path, 300 * 1024 * 1024);
      io.unlinkErrors.set(path, 'EIO');
    }
    io.byteCounts.set(future, 600 * 1024 * 1024);

    expect(maintainDesktopOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 0,
      deletedFileCount: 0,
      oldestRemainingMonth: '2025-08',
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[oldest], [current]]);
    expect(existsSync(future)).toBe(true);
  });

  it('retains info and warning/security streams for their own periods', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-desktop-retention-'));
    temporaryDirectories.push(root);
    const logsRoot = join(root, 'logs');

    writeLog(logsRoot, 'desktop', 'desktop-info-2024-01-001.jsonl');
    writeLog(
      logsRoot,
      'desktop',
      'desktop-warning-error-2025-01-001.jsonl',
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
      oldestRemainingMonth: '2025-01',
    });
  });

  it('excludes future months from quota pressure and deletion', () => {
    const logsRoot = createLogsRoot();
    const retained = writeLog(logsRoot, 'backend', 'backend-info-2026-06-001.jsonl');
    const current = writeLog(logsRoot, 'desktop', 'desktop-info-2026-07-001.jsonl');
    const future = writeLog(logsRoot, 'security', 'desktop-security-2026-08-001.jsonl');
    io.byteCounts.set(retained, 200 * 1024 * 1024);
    io.byteCounts.set(current, 300 * 1024 * 1024);
    io.byteCounts.set(future, 600 * 1024 * 1024);

    expect(maintainDesktopOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 0,
      deletedFileCount: 0,
      oldestRemainingMonth: '2026-06',
    });
    expect(unlinkSync).not.toHaveBeenCalled();
    expect(existsSync(future)).toBe(true);
  });

  it('still evicts eligible history under current quota pressure', () => {
    const logsRoot = createLogsRoot();
    const oldest = writeLog(logsRoot, 'backend', 'backend-info-2025-08-001.jsonl');
    const retained = writeLog(logsRoot, 'desktop', 'desktop-info-2025-09-001.jsonl');
    const current = writeLog(logsRoot, 'desktop', 'desktop-info-2026-07-001.jsonl');
    const future = writeLog(logsRoot, 'security', 'desktop-security-2027-01-001.jsonl');
    for (const path of [oldest, retained, current]) {
      io.byteCounts.set(path, 200 * 1024 * 1024);
    }
    io.byteCounts.set(future, 600 * 1024 * 1024);

    expect(maintainDesktopOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 200 * 1024 * 1024,
      deletedFileCount: 1,
      oldestRemainingMonth: '2025-09',
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[oldest]]);
    expect(existsSync(current)).toBe(true);
    expect(existsSync(future)).toBe(true);
  });

  it('does not subtract failed quota deletions and continues with later candidates', () => {
    const logsRoot = createLogsRoot();
    const failed = writeLog(logsRoot, 'desktop', 'desktop-info-2025-08-001.jsonl');
    const deleted = writeLog(logsRoot, 'desktop', 'desktop-info-2025-09-001.jsonl');
    const current = writeLog(logsRoot, 'desktop', 'desktop-info-2026-07-001.jsonl');
    for (const path of [failed, deleted, current]) {
      io.byteCounts.set(path, 200 * 1024 * 1024);
    }
    io.unlinkErrors.set(failed, 'EACCES');

    expect(maintainDesktopOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 200 * 1024 * 1024,
      deletedFileCount: 1,
      oldestRemainingMonth: '2025-08',
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[failed], [deleted]]);
    expect(existsSync(failed)).toBe(true);
    expect(existsSync(deleted)).toBe(false);
    expect(existsSync(current)).toBe(true);
  });

  it.each(['EACCES', 'EIO', 'ENOENT'])('continues after a %s directory listing failure', (code) => {
    const logsRoot = createLogsRoot();
    const blocked = writeLog(logsRoot, 'desktop', 'desktop-info-2020-01-001.jsonl');
    const healthy = writeLog(logsRoot, 'security', 'desktop-security-2020-01-001.jsonl');
    io.directoryErrors.set(join(logsRoot, 'desktop'), code);

    expect(maintainDesktopOperationalLogs({ logsRoot, now }).deletedFileCount).toBe(1);
    expect(existsSync(blocked)).toBe(true);
    expect(existsSync(healthy)).toBe(false);
  });

  it.each(['EACCES', 'EIO'])('continues after a %s directory metadata failure', (code) => {
    const logsRoot = createLogsRoot();
    const blocked = writeLog(logsRoot, 'desktop', 'desktop-info-2020-01-001.jsonl');
    const healthy = writeLog(logsRoot, 'backend', 'backend-security-2020-01-001.jsonl');
    io.metadataErrors.set(join(logsRoot, 'desktop'), code);

    expect(maintainDesktopOperationalLogs({ logsRoot, now }).deletedFileCount).toBe(1);
    expect(existsSync(blocked)).toBe(true);
    expect(existsSync(healthy)).toBe(false);
  });

  it.each(['EACCES', 'EIO', 'ENOENT'])('skips a %s file metadata failure and retains other work', (code) => {
    const logsRoot = createLogsRoot();
    const failed = writeLog(logsRoot, 'desktop', 'desktop-info-2020-01-001.jsonl');
    const healthy = writeLog(logsRoot, 'desktop', 'desktop-info-2020-02-001.jsonl');
    io.metadataErrors.set(failed, code);

    expect(maintainDesktopOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[healthy]]);
    expect(existsSync(failed)).toBe(true);
  });

  it('ignores a file that disappears after listing', () => {
    const logsRoot = createLogsRoot();
    const missing = writeLog(logsRoot, 'desktop', 'desktop-info-2020-01-001.jsonl');
    const healthy = writeLog(logsRoot, 'desktop', 'desktop-info-2020-02-001.jsonl');
    io.disappearingFiles.add(missing);

    expect(maintainDesktopOperationalLogs({ logsRoot, now }).deletedFileCount).toBe(1);
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[healthy]]);
    expect(existsSync(missing)).toBe(false);
  });

  it.each(['EACCES', 'EIO', 'ENOENT'])('counts only successful age deletions after %s unlink failure', (code) => {
    const logsRoot = createLogsRoot();
    const failed = writeLog(logsRoot, 'desktop', 'desktop-info-2020-01-001.jsonl');
    const healthy = writeLog(logsRoot, 'desktop', 'desktop-info-2020-02-001.jsonl');
    io.unlinkErrors.set(failed, code);

    expect(maintainDesktopOperationalLogs({ logsRoot, now })).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
      oldestRemainingMonth: '2020-01',
    });
    expect(existsSync(failed)).toBe(true);
    expect(existsSync(healthy)).toBe(false);
  });

  it('skips unknown names and files replaced by symlinks or directories after listing', () => {
    const logsRoot = createLogsRoot();
    const unknown = writeLog(logsRoot, 'desktop', 'notes.txt');
    const symlink = writeLog(logsRoot, 'desktop', 'desktop-info-2020-01-001.jsonl');
    const directory = writeLog(logsRoot, 'desktop', 'desktop-info-2020-02-001.jsonl');
    io.unsafePaths.set(symlink, 'symlink');
    io.unsafePaths.set(directory, 'directory');

    expect(maintainDesktopOperationalLogs({ logsRoot, now }).deletedFileCount).toBe(0);
    expect(unlinkSync).not.toHaveBeenCalled();
    expect(lstatSync).not.toHaveBeenCalledWith(unknown);
  });

  it('does not traverse a symlinked known directory', () => {
    const logsRoot = createLogsRoot();
    writeLog(logsRoot, 'desktop', 'desktop-info-2020-01-001.jsonl');
    io.unsafePaths.set(join(logsRoot, 'desktop'), 'symlink');

    expect(maintainDesktopOperationalLogs({ logsRoot, now }).deletedFileCount).toBe(0);
    expect(readdirSync).not.toHaveBeenCalled();
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it.each(['relative/logs', '/synthetic/logs/../logs'])('rejects invalid root %s before filesystem I/O', (logsRoot) => {
    expect(() => maintainDesktopOperationalLogs({ logsRoot, now })).toThrow('absolute normalized');
    expect(lstatSync).not.toHaveBeenCalled();
    expect(readdirSync).not.toHaveBeenCalled();
    expect(unlinkSync).not.toHaveBeenCalled();
  });
});

function createLogsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-desktop-retention-'));
  temporaryDirectories.push(root);
  return join(root, 'logs');
}

function writeLog(
  logsRoot: string,
  directoryName: 'backend' | 'desktop' | 'security',
  fileName: string,
): string {
  const directory = join(logsRoot, directoryName);
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, fileName);
  writeFileSync(filePath, 'x\n', 'utf8');
  return filePath;
}

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

import {
  incidentIndexBudgetBytes as budgetBytes,
  maintainIncidentIndex,
} from './incidentIndexRetention.js';

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

describe('maintainIncidentIndex', () => {
  it('does not lower observed capacity when another file cannot be inspected', () => {
    const logsRoot = createLogsRoot();
    const unknown = writeIndex(logsRoot, 'backend-incident-index-2015.jsonl');
    const current = writeIndex(logsRoot, 'desktop-incident-index-2026.jsonl');
    const future = writeIndex(logsRoot, 'backend-incident-index-2027.jsonl');
    io.metadataErrors.set(unknown, 'EACCES');
    io.byteCounts.set(current, 30 * 1024 * 1024);
    io.byteCounts.set(future, 30 * 1024 * 1024);

    expect(maintainIncidentIndex({ activeYear: 2026, logsRoot, now })).toEqual({
      deletedByteCount: 0,
      deletedFileCount: 0,
      totalByteCount: 60 * 1024 * 1024,
    });
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it('excludes future years from deletion pressure but includes them in writer capacity', () => {
    const logsRoot = createLogsRoot();
    const history = writeIndex(logsRoot, 'backend-incident-index-2016.jsonl');
    const current = writeIndex(logsRoot, 'desktop-incident-index-2026.jsonl');
    const future = writeIndex(logsRoot, 'backend-incident-index-2027.jsonl');
    io.byteCounts.set(history, 10 * 1024 * 1024);
    io.byteCounts.set(current, budgetBytes - 10 * 1024 * 1024);
    io.byteCounts.set(future, 30 * 1024 * 1024);

    expect(maintainIncidentIndex({ logsRoot, now })).toEqual({
      deletedByteCount: 0,
      deletedFileCount: 0,
      totalByteCount: budgetBytes + 30 * 1024 * 1024,
    });
    expect(unlinkSync).not.toHaveBeenCalled();
    expect(existsSync(history)).toBe(true);
    expect(existsSync(future)).toBe(true);
  });

  it.each([2016, 2026])('evicts eligible history under current quota pressure while protecting active year %s', (activeYear) => {
    const logsRoot = createLogsRoot();
    const oldest = writeIndex(logsRoot, 'backend-incident-index-2016.jsonl');
    const next = writeIndex(logsRoot, 'desktop-incident-index-2017.jsonl');
    const current = writeIndex(logsRoot, 'desktop-incident-index-2026.jsonl');
    const future = writeIndex(logsRoot, 'backend-incident-index-2027.jsonl');
    for (const path of [oldest, next, current]) {
      io.byteCounts.set(path, 10 * 1024 * 1024);
    }
    io.byteCounts.set(future, 30 * 1024 * 1024);
    const deleted = activeYear === 2016 ? next : oldest;

    expect(maintainIncidentIndex({ activeYear, logsRoot, now })).toEqual({
      deletedByteCount: 10 * 1024 * 1024,
      deletedFileCount: 1,
      totalByteCount: 50 * 1024 * 1024,
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[deleted]]);
    expect(existsSync(activeYear === 2016 ? oldest : current)).toBe(true);
    expect(existsSync(future)).toBe(true);
  });

  it('preserves an active expired year and the exact ten-year cutoff', () => {
    const logsRoot = createLogsRoot();
    const active = writeIndex(logsRoot, 'backend-incident-index-2014.jsonl');
    const expired = writeIndex(logsRoot, 'desktop-incident-index-2015.jsonl');
    const cutoff = writeIndex(logsRoot, 'backend-incident-index-2016.jsonl');

    expect(maintainIncidentIndex({ activeYear: 2014, logsRoot, now })).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
      totalByteCount: 4,
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[expired]]);
    expect(existsSync(active)).toBe(true);
    expect(existsSync(cutoff)).toBe(true);
  });

  it.each([
    ['2026-12-31T23:59:59.999Z', 0],
    ['2027-01-01T00:00:00.000Z', 1],
  ] as const)('uses the UTC retention year at %s', (timestamp, deletedFileCount) => {
    const logsRoot = createLogsRoot();
    const cutoff = writeIndex(logsRoot, 'backend-incident-index-2016.jsonl');
    const future = writeIndex(logsRoot, 'desktop-incident-index-2028.jsonl');
    io.byteCounts.set(future, 30 * 1024 * 1024);

    expect(maintainIncidentIndex({ logsRoot, now: new Date(timestamp) })).toEqual({
      deletedByteCount: deletedFileCount * 2,
      deletedFileCount,
      totalByteCount: 30 * 1024 * 1024 + (deletedFileCount === 0 ? 2 : 0),
    });
    expect(existsSync(cutoff)).toBe(deletedFileCount === 0);
    expect(existsSync(future)).toBe(true);
  });

  it('does not subtract failed quota deletions and continues with later candidates', () => {
    const logsRoot = createLogsRoot();
    const failed = writeIndex(logsRoot, 'backend-incident-index-2016.jsonl');
    const deleted = writeIndex(logsRoot, 'desktop-incident-index-2017.jsonl');
    const current = writeIndex(logsRoot, 'desktop-incident-index-2026.jsonl');
    for (const path of [failed, deleted, current]) {
      io.byteCounts.set(path, 10 * 1024 * 1024);
    }
    io.unlinkErrors.set(failed, 'EACCES');

    expect(maintainIncidentIndex({ logsRoot, now })).toEqual({
      deletedByteCount: 10 * 1024 * 1024,
      deletedFileCount: 1,
      totalByteCount: 20 * 1024 * 1024,
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[failed], [deleted]]);
    expect(existsSync(failed)).toBe(true);
    expect(existsSync(deleted)).toBe(false);
    expect(existsSync(current)).toBe(true);
  });

  it('retains the full capacity count when every quota deletion fails', () => {
    const logsRoot = createLogsRoot();
    const oldest = writeIndex(logsRoot, 'backend-incident-index-2016.jsonl');
    const current = writeIndex(logsRoot, 'desktop-incident-index-2026.jsonl');
    for (const path of [oldest, current]) {
      io.byteCounts.set(path, 15 * 1024 * 1024);
      io.unlinkErrors.set(path, 'EIO');
    }
    const future = writeIndex(logsRoot, 'backend-incident-index-2027.jsonl');
    io.byteCounts.set(future, 30 * 1024 * 1024);

    expect(maintainIncidentIndex({ logsRoot, now })).toEqual({
      deletedByteCount: 0,
      deletedFileCount: 0,
      totalByteCount: 60 * 1024 * 1024,
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[oldest], [current]]);
    expect(existsSync(future)).toBe(true);
  });

  for (const operation of ['metadata', 'listing'] as const) {
    it.each(['EACCES', 'EIO', 'ENOENT'])(`survives a %s directory ${operation} failure and preserves unknown capacity`, (code) => {
      const logsRoot = createLogsRoot();
      const file = writeIndex(logsRoot, 'backend-incident-index-2015.jsonl');
      const errors = operation === 'metadata' ? io.metadataErrors : io.directoryErrors;
      errors.set(join(logsRoot, 'incident-index'), code);

      expect(maintainIncidentIndex({ logsRoot, now })).toEqual({
        deletedByteCount: 0,
        deletedFileCount: 0,
        totalByteCount: operation === 'metadata' && code === 'ENOENT' ? 0 : budgetBytes,
      });
      expect(existsSync(file)).toBe(true);
      expect(unlinkSync).not.toHaveBeenCalled();
    });
  }

  it.each(['EACCES', 'EIO', 'ENOENT'])('skips a %s file metadata failure and retains other work', (code) => {
    const logsRoot = createLogsRoot();
    const failed = writeIndex(logsRoot, 'backend-incident-index-2014.jsonl');
    const healthy = writeIndex(logsRoot, 'desktop-incident-index-2015.jsonl');
    io.metadataErrors.set(failed, code);

    expect(maintainIncidentIndex({ logsRoot, now })).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
      totalByteCount: code === 'ENOENT' ? 0 : budgetBytes,
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[healthy]]);
    expect(existsSync(failed)).toBe(true);
  });

  it('ignores a file that disappears after listing without counting it as deleted', () => {
    const logsRoot = createLogsRoot();
    const missing = writeIndex(logsRoot, 'backend-incident-index-2014.jsonl');
    const healthy = writeIndex(logsRoot, 'desktop-incident-index-2015.jsonl');
    io.disappearingFiles.add(missing);

    expect(maintainIncidentIndex({ logsRoot, now })).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
      totalByteCount: 0,
    });
    expect(vi.mocked(unlinkSync).mock.calls).toEqual([[healthy]]);
    expect(existsSync(missing)).toBe(false);
  });

  it.each(['EACCES', 'EIO', 'ENOENT'])('counts only successful age deletions after %s unlink failure', (code) => {
    const logsRoot = createLogsRoot();
    const failed = writeIndex(logsRoot, 'backend-incident-index-2014.jsonl');
    const healthy = writeIndex(logsRoot, 'desktop-incident-index-2015.jsonl');
    io.unlinkErrors.set(failed, code);

    expect(maintainIncidentIndex({ logsRoot, now })).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
      totalByteCount: 2,
    });
    expect(existsSync(failed)).toBe(true);
    expect(existsSync(healthy)).toBe(false);
  });

  it('skips unknown names and files replaced by symlinks or directories after listing', () => {
    const logsRoot = createLogsRoot();
    const unknown = writeIndex(logsRoot, 'notes.txt');
    const symlink = writeIndex(logsRoot, 'backend-incident-index-2014.jsonl');
    const directory = writeIndex(logsRoot, 'desktop-incident-index-2015.jsonl');
    io.unsafePaths.set(symlink, 'symlink');
    io.unsafePaths.set(directory, 'directory');

    expect(maintainIncidentIndex({ logsRoot, now })).toEqual({
      deletedByteCount: 0,
      deletedFileCount: 0,
      totalByteCount: budgetBytes,
    });
    expect(unlinkSync).not.toHaveBeenCalled();
    expect(lstatSync).not.toHaveBeenCalledWith(unknown);
  });

  it('does not traverse a symlinked incident directory', () => {
    const logsRoot = createLogsRoot();
    writeIndex(logsRoot, 'backend-incident-index-2015.jsonl');
    io.unsafePaths.set(join(logsRoot, 'incident-index'), 'symlink');

    expect(maintainIncidentIndex({ logsRoot, now }).totalByteCount).toBe(budgetBytes);
    expect(readdirSync).not.toHaveBeenCalled();
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it('allows capacity in a missing incident directory', () => {
    expect(maintainIncidentIndex({ logsRoot: createLogsRoot(), now })).toEqual({
      deletedByteCount: 0,
      deletedFileCount: 0,
      totalByteCount: 0,
    });
    expect(readdirSync).not.toHaveBeenCalled();
  });

  it.each(['relative/logs', '/synthetic/logs/../logs'])('rejects invalid root %s before filesystem I/O', (logsRoot) => {
    expect(() => maintainIncidentIndex({ logsRoot, now })).toThrow('absolute');
    expect(lstatSync).not.toHaveBeenCalled();
    expect(readdirSync).not.toHaveBeenCalled();
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it('removes index files older than ten years without deleting the active year', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-incident-retention-'));
    temporaryDirectories.push(root);
    const logsRoot = join(root, 'logs');
    const directory = join(logsRoot, 'incident-index');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'backend-incident-index-2015.jsonl'),
      'x\n',
    );
    writeFileSync(
      join(directory, 'desktop-incident-index-2026.jsonl'),
      'y\n',
    );

    expect(
      maintainIncidentIndex({
        activeYear: 2026,
        logsRoot,
        now: new Date('2026-07-26T20:00:00.000Z'),
      }),
    ).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
      totalByteCount: 2,
    });
  });
});

function createLogsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-backend-incident-retention-'));
  temporaryDirectories.push(root);
  return join(root, 'logs');
}

function writeIndex(logsRoot: string, fileName: string): string {
  const directory = join(logsRoot, 'incident-index');
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, fileName);
  writeFileSync(filePath, 'x\n', 'utf8');
  return filePath;
}

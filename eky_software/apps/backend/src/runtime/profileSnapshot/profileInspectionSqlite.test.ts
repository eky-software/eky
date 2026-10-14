import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureProfileInspectionConnection,
  profileInspectionSqliteCacheKiB,
} from './profileInspectionSqlite.js';
import { inspectSqliteProfileConnection } from './inspectSqliteProfileDatabase.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

describe('inspection SQLite resource boundary', () => {
  it('sets and reads back only connection-local limits for a readonly database', async () => {
    const database = await createReadonlyDatabase();
    try {
      const hostHeap = database.pragma('hard_heap_limit', { simple: true });
      configureProfileInspectionConnection(database);
      expect(database.pragma('hard_heap_limit', { simple: true })).toBe(hostHeap);
      expect(database.pragma('trusted_schema', { simple: true })).toBe(0);
      expect(database.pragma('query_only', { simple: true })).toBe(1);
      expect(database.pragma('mmap_size', { simple: true })).toBe(0);
      expect(database.pragma('cache_size', { simple: true })).toBe(-profileInspectionSqliteCacheKiB);
      expect(database.pragma('temp_store', { simple: true })).toBe(2);
      expect(() => database.exec('CREATE TABLE forbidden (id INTEGER)')).toThrow();
    } finally { database.close(); }
  });

  it.each(['trusted_schema', 'query_only', 'mmap_size', 'cache_size', 'temp_store'])(
    'fails closed when %s readback is unavailable', async missing => {
      const database = await createReadonlyDatabase();
      const original = database.pragma.bind(database);
      vi.spyOn(database, 'pragma').mockImplementation((statement, options) =>
        statement === missing ? undefined : original(statement, options));
      try {
        expect(() => configureProfileInspectionConnection(database))
          .toThrow(/^PROFILE_INSPECTION_LIMIT_EXCEEDED$/);
      } finally { database.close(); }
    },
  );

  it('rejects a writable connection before reading schema or history', () => {
    const database = new Database(':memory:');
    const prepare = vi.spyOn(database, 'prepare');
    try {
      expect(() => inspectSqliteProfileConnection(database, process.cwd()))
        .toThrow('PROFILE_SNAPSHOT_DATABASE_INVALID');
      expect(prepare).not.toHaveBeenCalled();
    } finally { database.close(); }
  });

  it('rejects the current unsupported heap runtime without changing the host', async () => {
    const host = new Database(':memory:');
    const before = host.pragma('hard_heap_limit', { simple: true });
    try {
      const moduleUrl = new URL('./profileInspectionSqlite.ts', import.meta.url).href;
      // Node's built-in type stripping loads this exact source, not stale dist.
      // This leaf child cannot spawn descendants; execFile waits for close and
      // kills on its bounded safety timeout. No application data is opened.
      const result = await promisify(execFile)(process.execPath, [
        '--input-type=module', '--eval', `
          import Database from 'better-sqlite3';
          const { initializeProfileInspectionSqliteBudget } =
            await import(process.argv[1]);
          let admissionCode = null;
          try { initializeProfileInspectionSqliteBudget(() => new Database(':memory:')); }
          catch (error) { admissionCode = error.message; }
          const database = new Database(':memory:');
          try {
            const memoryAccountingDisabled = database.pragma('compile_options')
              .some(row => row.compile_options === 'DEFAULT_MEMSTATUS=0');
            // Prove the failed assumption cheaply with trusted synthetic SQL.
            // This is not a passing proof of the approved 256 MiB runtime gate.
            database.pragma('hard_heap_limit = 1048576');
            const heap = database.pragma('hard_heap_limit', { simple: true });
            const allocation = database.prepare('SELECT length(randomblob(2097152)) AS bytes').get().bytes;
            const healthy = database.prepare('SELECT 1 AS ready').get().ready === 1;
            console.log(JSON.stringify({ admissionCode, memoryAccountingDisabled, heap, allocation, healthy }));
          } finally { database.close(); }
        `, moduleUrl,
      ], { cwd: process.cwd(), timeout: 4_000, maxBuffer: 4_096, windowsHide: true });
      expect(JSON.parse(result.stdout)).toEqual({
        admissionCode: 'PROFILE_INSPECTION_LIMIT_EXCEEDED',
        memoryAccountingDisabled: true,
        heap: 1_048_576,
        allocation: 2_097_152,
        healthy: true,
      });
      expect(host.pragma('hard_heap_limit', { simple: true })).toBe(before);
    } finally { host.close(); }
  });
});

async function createReadonlyDatabase(): Promise<Database.Database> {
  const root = await mkdtemp(join(tmpdir(), 'eky-inspection-sqlite-'));
  roots.push(root);
  const path = join(root, 'profile.sqlite');
  const writable = new Database(path);
  writable.exec('CREATE TABLE fixture (id INTEGER);');
  writable.close();
  return new Database(path, { fileMustExist: true, readonly: true });
}

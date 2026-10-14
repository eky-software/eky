import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createActiveProfileInspectionContextReader } from './activeProfileInspectionContext.js';
import { createProfileBackupIdentity } from './inspectSqliteProfileDatabase.js';

const databases: Database.Database[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) if (database.open) database.close();
});

describe('trusted active profile inspection context', () => {
  it('can register before migrations without opening or querying another database', () => {
    const database = openDatabase();
    const prepare = vi.spyOn(database, 'prepare');
    const reader = createActiveProfileInspectionContextReader(database);
    expect(prepare).not.toHaveBeenCalled();
    expect(Object.isFrozen(reader)).toBe(true);
    expect(() => reader.readProfileInspectionContext()).toThrow();
  });

  it('returns only immutable lineage and emptiness, not an active connection or identity fields', () => {
    const database = activeDatabase();
    const result = createActiveProfileInspectionContextReader(database).readProfileInspectionContext();
    expect(result).toEqual({
      activeProfileId: createProfileBackupIdentity('synthetic-company'),
      activeProfileIsEmpty: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    const encoded = JSON.stringify(result);
    for (const excluded of ['synthetic-company', 'synthetic-actor', 'local_runtime_identity', 'installationId']) {
      expect(encoded).not.toContain(excluded);
    }
  });

  it('reads current emptiness without mutating a previous result', () => {
    const database = activeDatabase();
    const reader = createActiveProfileInspectionContextReader(database);
    const first = reader.readProfileInspectionContext();
    database.exec("INSERT INTO business_rows (id, value) VALUES ('row-1', 'synthetic');");
    expect(first.activeProfileIsEmpty).toBe(true);
    expect(reader.readProfileInspectionContext()).toEqual({ ...first, activeProfileIsEmpty: false });
  });

  it('ignores the existing three infrastructure tables when checking business emptiness', () => {
    const database = activeDatabase();
    database.exec(`
      CREATE TABLE schema_migrations (value TEXT);
      CREATE TABLE schema_migration_metadata (value TEXT);
      INSERT INTO schema_migrations VALUES ('synthetic');
      INSERT INTO schema_migration_metadata VALUES ('synthetic');
    `);
    expect(createActiveProfileInspectionContextReader(database).readProfileInspectionContext()
      .activeProfileIsEmpty).toBe(true);
  });

  it('does not materialize business rows in the returned context', () => {
    const database = activeDatabase();
    database.exec("INSERT INTO business_rows VALUES ('row-1', 'private-synthetic-value');");
    const prepare = vi.spyOn(database, 'prepare');
    const result = createActiveProfileInspectionContextReader(database).readProfileInspectionContext();
    expect(result.activeProfileIsEmpty).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-synthetic-value');
    expect(prepare.mock.calls.some(([sql]) => /SELECT 1 AS present .* LIMIT 1/.test(sql))).toBe(true);
    expect(prepare.mock.calls.some(([sql]) => /SELECT \*/.test(sql))).toBe(false);
  });

  it('rejects absent identity instead of guessing a profile', () => {
    const database = activeDatabase();
    database.exec('DELETE FROM local_runtime_identity;');
    expect(() => createActiveProfileInspectionContextReader(database).readProfileInspectionContext())
      .toThrow('Local runtime identity is not configured.');
  });

  it('rejects invalid identity through the existing identity validator', () => {
    const database = activeDatabase();
    database.exec("UPDATE local_runtime_identity SET installation_id = 'invalid';");
    expect(() => createActiveProfileInspectionContextReader(database).readProfileInspectionContext())
      .toThrow('Local runtime identity is invalid.');
  });

  it('does not reopen or substitute a closed active connection', () => {
    const database = activeDatabase();
    const reader = createActiveProfileInspectionContextReader(database);
    database.close();
    expect(() => reader.readProfileInspectionContext()).toThrow();
    expect(database.open).toBe(false);
  });
});

function openDatabase(): Database.Database {
  const database = new Database(':memory:');
  databases.push(database);
  return database;
}

function activeDatabase(): Database.Database {
  const database = openDatabase();
  // Minimal trusted active fixture: this is not an imported-schema acceptance test.
  database.exec(`
    CREATE TABLE local_runtime_identity (
      singleton_key TEXT PRIMARY KEY, actor_id TEXT, company_id TEXT, installation_id TEXT
    );
    INSERT INTO local_runtime_identity VALUES (
      'local-runtime', 'synthetic-actor', 'synthetic-company', '${'a'.repeat(32)}'
    );
    CREATE TABLE business_rows (id TEXT, value TEXT);
  `);
  return database;
}

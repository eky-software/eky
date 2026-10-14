import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { inspectAttestedMigrationHistory } from './inspectAttestedMigrationHistory.js';
import {
  createMigrationChainIdentity, readMigrationManifest, type MigrationManifestEntry,
} from './migrationManifest.js';
import {
  createMigrationMetadataTable, createMigrationTable, recordAppliedMigrationMetadata,
} from './migrationMetadata.js';
import { createHistorical038Schema, historical038Chain } from './migrationSchemaHistory.fixture.js';
import { getMigrationSchemaReference } from './migrationSchemaReference.js';

const databases: Database.Database[] = [];
const manifest = readMigrationManifest(fileURLToPath(new URL('../migrations/', import.meta.url)));
const probeSql = `CREATE TABLE probe (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT 'a b' CHECK(value <> 'forbidden')
);
CREATE INDEX probe_value_index ON probe(value);
CREATE TRIGGER probe_update_guard BEFORE UPDATE ON probe
BEGIN SELECT RAISE(ABORT, 'PROBE_IMMUTABLE'); END;`;

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
});

describe('attested migration history', () => {
  it.each([false, true])('attests historical 038 with frozen published DDL (metadata=%s)', withMetadata => {
    const database = openDatabase();
    createHistorical038Schema(database, manifest, withMetadata);
    expect(inspectAttestedMigrationHistory(database, manifest, {
      ...(!withMetadata ? { legacyPolicy: 'approvedRestore' } as const : {}),
    })).toEqual({
      appliedMigrationNames: manifest.slice(0, 38).map(entry => entry.fileName),
      migrationChainIdentity: historical038Chain,
      profileState: 'existing',
    });
    if (!withMetadata) {
      expect(() => inspectAttestedMigrationHistory(database, manifest))
        .toThrow('MIGRATION_HISTORY_INVALID');
    }
  });

  it('distinguishes empty initialization from initialized zero history', () => {
    const database = openDatabase();
    expect(() => inspectAttestedMigrationHistory(database, manifest))
      .toThrow('MIGRATION_HISTORY_INVALID');
    expect(inspectAttestedMigrationHistory(database, manifest, { allowEmpty: true }))
      .toMatchObject({ profileState: 'empty', appliedMigrationNames: [] });
    createMigrationTable(database);
    createMigrationMetadataTable(database);
    expect(inspectAttestedMigrationHistory(database, manifest))
      .toMatchObject({ profileState: 'existing', appliedMigrationNames: [] });
  });

  it('does not classify a view-only database as empty', () => {
    const database = openDatabase();
    database.exec('CREATE VIEW unexpected_view AS SELECT 1;');
    expect(() => inspectAttestedMigrationHistory(database, manifest, { allowEmpty: true }))
      .toThrow('PROFILE_SCHEMA_UNSUPPORTED');
  });

  it('does not replay pending SQL or change a successfully attested database', () => {
    const prefix = createProbeManifest();
    const database = createProbe(prefix);
    const before = database.serialize();
    const next = Buffer.from('THIS PENDING MIGRATION IS NOT EXECUTABLE');
    const pending = { content: next, fileName: '002_pending.sql' };
    expect(inspectAttestedMigrationHistory(database, [...prefix, {
      ...pending, sourceSha256: createHash('sha256').update(next).digest('hex'),
      chainSha256: createMigrationChainIdentity([...prefix, pending]),
    }])).toMatchObject({ appliedMigrationNames: ['001_probe.sql'] });
    expect(database.serialize()).toEqual(before);
    expect(database.pragma('trusted_schema', { simple: true })).toBe(0);
    expect(database.pragma('query_only', { simple: true })).toBe(0);
    database.pragma('query_only = ON');
    inspectAttestedMigrationHistory(database, prefix);
    expect(database.pragma('query_only', { simple: true })).toBe(1);
  });

  it.each([
    ['constraint', "value <> 'forbidden'", "value <> 'allowed'"],
    ['default', "DEFAULT 'a b'", "DEFAULT 'other'"],
    ['literal whitespace', "DEFAULT 'a b'", "DEFAULT 'a  b'"],
    ['quote spelling', "DEFAULT 'a b'", 'DEFAULT "a b"'],
  ])('rejects changed %s without normalizing stored SQL', (_label, original, replacement) => {
    const prefix = createProbeManifest();
    const database = createProbe(prefix);
    const modified = probeSql.replace(original, replacement);
    expect(modified).not.toBe(probeSql);
    database.exec('DROP TABLE probe;');
    database.exec(modified);
    expect(() => inspectAttestedMigrationHistory(database, prefix))
      .toThrow('PROFILE_SCHEMA_UNSUPPORTED');
  });

  it.each([
    'DROP TRIGGER probe_update_guard;',
    `DROP TRIGGER probe_update_guard;
     CREATE TRIGGER probe_update_guard BEFORE UPDATE ON probe BEGIN SELECT 1; END;`,
    'DROP INDEX probe_value_index; CREATE INDEX probe_value_index ON probe(id);',
    'CREATE INDEX extra_index ON probe(id);',
    'CREATE TABLE extra_table (id TEXT);',
    'CREATE VIRTUAL TABLE extra_virtual USING fts5(content);',
  ])('rejects changed objects before any write: %s', sql => {
    const prefix = createProbeManifest();
    const database = createProbe(prefix);
    database.exec(sql);
    const before = database.serialize();
    expect(() => inspectAttestedMigrationHistory(database, prefix))
      .toThrow('PROFILE_SCHEMA_UNSUPPORTED');
    expect(database.serialize()).toEqual(before);
  });

  it.each(['schema_migrations', 'schema_migration_metadata'])
    ('rejects a forged %s view before it is evaluated', name => {
      const database = openDatabase();
      const probe = vi.fn(() => 'unexpected');
      database.function('unexpected_read', probe);
      if (name === 'schema_migration_metadata') createMigrationTable(database);
      database.exec(`CREATE VIEW ${name} AS SELECT unexpected_read() AS name;`);
      expect(() => inspectAttestedMigrationHistory(database, manifest, {
        legacyPolicy: 'approvedRestore',
      })).toThrow('PROFILE_SCHEMA_UNSUPPORTED');
      expect(probe).not.toHaveBeenCalled();
    });

  it('attests history definitions before preparing any history row query', () => {
    const database = openDatabase();
    database.exec('CREATE TABLE schema_migrations (name TEXT, run_at TEXT);');
    const prepare = vi.spyOn(database, 'prepare');
    expect(() => inspectAttestedMigrationHistory(database, manifest))
      .toThrow('PROFILE_SCHEMA_UNSUPPORTED');
    expect(prepare.mock.calls.every(([sql]) => !sql.includes('FROM main.schema_migrations')))
      .toBe(true);
  });

  it.each(['recorded_at', 'metadata_version'])('bounds corrupted metadata field %s', column => {
    const prefix = createProbeManifest();
    const database = createProbe(prefix);
    database.pragma('ignore_check_constraints = ON');
    database.prepare(`UPDATE schema_migration_metadata SET ${column} = ?`)
      .run(Buffer.alloc(64 * 1024, 65));
    database.pragma('ignore_check_constraints = OFF');
    expect(() => inspectAttestedMigrationHistory(database, prefix))
      .toThrow('MIGRATION_HISTORY_INVALID');
  });

  it('rejects an oversized ledger value, an extra row and oversized schema SQL', () => {
    const prefix = createProbeManifest();
    for (const name of ['999_extra.sql', 'x'.repeat(64 * 1024)]) {
      const database = createProbe(prefix);
      database.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(name, 'synthetic');
      expect(() => inspectAttestedMigrationHistory(database, prefix))
        .toThrow('MIGRATION_HISTORY_INVALID');
    }
    const database = createProbe(prefix);
    database.exec(`CREATE VIEW oversized_view AS SELECT '${'x'.repeat(64 * 1024)}';`);
    expect(() => inspectAttestedMigrationHistory(database, prefix))
      .toThrow('PROFILE_SCHEMA_UNSUPPORTED');
  });

  it('caches by trusted SQL bytes and never lets one caller mutate the reference', () => {
    const prefix = createProbeManifest();
    const original = getMigrationSchemaReference(prefix, true);
    expect(Object.isFrozen(original)).toBe(true);
    expect(original.every(Object.isFrozen)).toBe(true);
    const different = [{ ...prefix[0]!, content: Buffer.from(probeSql.replace("'a b'", "'a  b'")) }];
    const modified = getMigrationSchemaReference(different, true);
    expect(modified).not.toEqual(original);
    expect(getMigrationSchemaReference(prefix, true)).toEqual(original);
  });
});

function openDatabase(): Database.Database {
  const database = new Database(':memory:');
  databases.push(database);
  return database;
}

function createProbeManifest(): MigrationManifestEntry[] {
  const content = Buffer.from(probeSql);
  const entry = { fileName: '001_probe.sql', content };
  return [{ ...entry, sourceSha256: createHash('sha256').update(content).digest('hex'),
    chainSha256: createMigrationChainIdentity([entry]) }];
}

function createProbe(prefix: readonly MigrationManifestEntry[]): Database.Database {
  const database = openDatabase();
  createMigrationTable(database);
  createMigrationMetadataTable(database);
  for (const entry of prefix) {
    database.exec(entry.content.toString('utf8'));
    database.prepare('INSERT INTO schema_migrations VALUES (?, ?)')
      .run(entry.fileName, '2026-08-14T12:00:00.000Z');
    recordAppliedMigrationMetadata(database, { entry, recordedAt: '2026-08-14T12:00:00.000Z',
      releaseIdentity: { appVersion: 'test', buildRevision: 'development' } });
  }
  return database;
}

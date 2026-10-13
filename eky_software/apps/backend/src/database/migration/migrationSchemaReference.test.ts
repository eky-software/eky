import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import { createMigrationSchemaReferences } from './migrationSchemaReference.js';
import { inspectAttestedMigrationHistoryWithReferences } from './inspectAttestedMigrationHistory.js';
import type { MigrationManifestEntry } from './migrationManifest.js';

describe('driver-owned migration schema references', () => {
  it('uses and closes only the provided reference connections with a bounded owner-local cache', () => {
    const connections: Database.Database[] = [];
    const openReference = vi.fn(() => {
      const connection = new Database(':memory:');
      connections.push(connection);
      return connection;
    });
    const references = createMigrationSchemaReferences(openReference);
    const technical = references.getTechnicalSchema();
    expect(references.getTechnicalSchema()).toBe(technical);
    const schema = references.getSchemaReference([], false);
    expect(references.getSchemaReference([], false)).toBe(schema);
    expect(openReference).toHaveBeenCalledTimes(2);
    expect(technical.some(row => row.name === 'schema_migration_metadata')).toBe(true);
    expect(schema.some(row => row.name === 'schema_migration_metadata')).toBe(false);
    expect(connections.every(connection => !connection.open)).toBe(true);
    expect(Object.isFrozen(schema)).toBe(true);
    expect(schema.every(Object.isFrozen)).toBe(true);
  });

  it('does not use another owner or a business-driver cache on a missing connection', () => {
    const first = createMigrationSchemaReferences(() => new Database(':memory:'));
    first.getTechnicalSchema();
    first.getSchemaReference([], false);
    const failure = new Error('EXPLICIT_REFERENCE_FAILURE');
    const rejected = vi.fn(() => { throw failure; });
    const second = createMigrationSchemaReferences(rejected);
    expect(() => second.getTechnicalSchema()).toThrow(failure);
    expect(() => second.getSchemaReference([], false)).toThrow(failure);
    expect(rejected).toHaveBeenCalledTimes(2);
  });

  it('closes a provided connection even when trusted reference execution fails', () => {
    const database = new Database(':memory:');
    const references = createMigrationSchemaReferences(() => database);
    const invalid = [{ fileName: '001_probe.sql', content: Buffer.from('INVALID_SQL'),
      chainSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64) }] satisfies MigrationManifestEntry[];
    expect(() => references.getSchemaReference(invalid, true)).toThrow();
    expect(database.open).toBe(false);
  });

  it('rejects missing references before touching the target database', () => {
    const database = new Database(':memory:');
    try {
      const pragma = vi.spyOn(database, 'pragma');
      const prepare = vi.spyOn(database, 'prepare');
      expect(() => inspectAttestedMigrationHistoryWithReferences(database, [],
        undefined as unknown as ReturnType<typeof createMigrationSchemaReferences>))
        .toThrow(/^PROFILE_INSPECTION_PROTOCOL_INVALID$/);
      expect(pragma).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
    } finally { database.close(); }
  });
});

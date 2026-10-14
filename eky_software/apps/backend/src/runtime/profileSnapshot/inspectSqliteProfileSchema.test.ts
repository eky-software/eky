import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migration/runMigrations.js';
import { readMigrationManifest } from '../../database/migration/migrationManifest.js';
import {
  createHistorical038Schema,
} from '../../database/migration/migrationSchemaHistory.fixture.js';
import { inspectSqliteProfileDatabase } from './inspectSqliteProfileDatabase.js';

const migrationsDirectory = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('profile inspection schema trust boundary', () => {
  it('preserves the legitimate current profile', async () => {
    const path = await createProfile();
    expect(inspectSqliteProfileDatabase(path, migrationsDirectory)).toMatchObject({
      profileId: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it.each([
    'CREATE TABLE unexpected_content (id TEXT);',
    'CREATE VIEW unexpected_view AS SELECT 1 AS id;',
    `CREATE TRIGGER unexpected_trigger AFTER UPDATE ON customers
     BEGIN SELECT 1; END;`,
  ])('rejects an additional object despite a valid migration history: %s', async sql => {
    const path = await createProfile();
    const database = new Database(path);
    try {
      database.exec(sql);
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      database.close();
    }
    expect(() => inspectSqliteProfileDatabase(path, migrationsDirectory))
      .toThrow('PROFILE_SCHEMA_UNSUPPORTED');
  });

  it.each([
    'DROP TRIGGER invoice_revision_update_guard;',
    `DROP TRIGGER invoice_revision_update_guard;
     CREATE TRIGGER invoice_revision_update_guard BEFORE UPDATE ON invoice_content_revisions
     BEGIN SELECT 1; END;`,
    `DROP TABLE local_runtime_identity;
     CREATE VIEW local_runtime_identity AS SELECT missing_untrusted_function() AS company_id;`,
  ])('rejects altered current guards or identity before reading content: %s', async sql => {
    const path = await createProfile();
    const database = new Database(path);
    try {
      database.exec(sql);
    } finally {
      database.close();
    }
    expect(() => inspectSqliteProfileDatabase(path, migrationsDirectory))
      .toThrow('PROFILE_SCHEMA_UNSUPPORTED');
  });

  it.each([false, true])('preserves published 038 inspection and forward migration (metadata=%s)', async withMetadata => {
    const path = await createProfile(false);
    const database = new Database(path);
    try {
      createHistorical038Schema(database, readMigrationManifest(migrationsDirectory), withMetadata);
    } finally {
      database.close();
    }
    const before = inspectSqliteProfileDatabase(path, migrationsDirectory, 'restoreCompatible');
    expect(before.appliedMigrationNames).toHaveLength(38);
    if (withMetadata) {
      expect(() => inspectSqliteProfileDatabase(path, migrationsDirectory))
        .toThrow('PROFILE_SNAPSHOT_MIGRATIONS_INVALID');
      expect(inspectSqliteProfileDatabase(path, migrationsDirectory, 'compatibleHistoricalPrefix'))
        .toEqual(before);
    }
    const writable = new Database(path);
    try {
      await runMigrations(writable, { migrationsDirectory });
    } finally {
      writable.close();
    }
    const after = inspectSqliteProfileDatabase(path, migrationsDirectory);
    expect(after.profileId).toBe(before.profileId);
    expect(after.appliedMigrationNames).toHaveLength(39);
  });
});

async function createProfile(migrate = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-schema-inspection-'));
  roots.push(root);
  const path = join(root, 'profile.sqlite');
  const database = new Database(path);
  try {
    if (migrate) await runMigrations(database, { migrationsDirectory });
  } finally {
    database.close();
  }
  return path;
}

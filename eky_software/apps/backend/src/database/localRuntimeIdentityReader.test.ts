import Database from 'better-sqlite3';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from './migration/runMigrations.js';
import { readLocalRuntimeIdentity } from './localRuntimeIdentityReader.js';

const migrationsDirectory = fileURLToPath(
  new URL('./migrations/', import.meta.url),
);

let database: Database.Database | undefined;
let temporaryDirectory: string | undefined;

afterEach(() => {
  database?.close();
  database = undefined;

  if (temporaryDirectory !== undefined) {
    rmSync(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = undefined;
  }
});

describe('readLocalRuntimeIdentity', () => {
  it('creates one stable identity for a new local database', async () => {
    database = new Database(':memory:');
    await runMigrations(database);

    const firstIdentity = readLocalRuntimeIdentity(database);
    await runMigrations(database);

    expect(firstIdentity).toEqual({
      actorId: 'local-owner',
      companyId: expect.stringMatching(/^local-company-[a-f0-9]{32}$/),
      installationId: expect.stringMatching(/^[a-f0-9]{32}$/),
    });
    expect(readLocalRuntimeIdentity(database)).toEqual(firstIdentity);
  });

  it('keeps the existing single-company data boundary during migration', async () => {
    database = new Database(':memory:');
    const legacyMigrationsDirectory = createLegacyMigrationsDirectory();
    await runMigrations(database, {
      migrationsDirectory: legacyMigrationsDirectory,
    });
    database
      .prepare(
        `
          INSERT INTO company_settings (
            id,
            company_id,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?)
        `,
      )
      .run(
        'settings-1',
        'dev-company',
        '2026-07-14T20:00:00.000Z',
        '2026-07-14T20:00:00.000Z',
      );

    await runMigrations(database);

    expect(readLocalRuntimeIdentity(database).companyId).toBe('dev-company');
  });

  it('fails closed when legacy local data contains multiple company boundaries', async () => {
    database = new Database(':memory:');
    const legacyMigrationsDirectory = createLegacyMigrationsDirectory();
    await runMigrations(database, {
      migrationsDirectory: legacyMigrationsDirectory,
    });
    const insertCustomer = database.prepare(
      `
        INSERT INTO customers (
          id,
          company_id,
          name,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
    );
    insertCustomer.run(
      'customer-1',
      'company-one',
      'Synthetic customer one',
      '2026-07-14T20:00:00.000Z',
      '2026-07-14T20:00:00.000Z',
    );
    insertCustomer.run(
      'customer-2',
      'company-two',
      'Synthetic customer two',
      '2026-07-14T20:00:00.000Z',
      '2026-07-14T20:00:00.000Z',
    );

    await expect(runMigrations(database)).rejects.toThrow();
    expect(
      database
        .prepare(
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name = 'local_runtime_identity'
          `,
        )
        .get(),
    ).toBeUndefined();
  });
});

function createLegacyMigrationsDirectory(): string {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'eky-legacy-migrations-'));

  for (const fileName of readdirSync(migrationsDirectory)) {
    if (!fileName.endsWith('.sql') || fileName >= '025_') {
      continue;
    }

    cpSync(
      join(migrationsDirectory, fileName),
      join(temporaryDirectory, fileName),
    );
  }

  return temporaryDirectory;
}

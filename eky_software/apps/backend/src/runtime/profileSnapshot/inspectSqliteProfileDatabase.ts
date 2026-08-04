import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import Database from 'better-sqlite3';

import { readLocalRuntimeIdentity } from '../../database/localRuntimeIdentityReader.js';

const migrationFileNamePattern = /^\d{3}_[A-Za-z0-9_]+\.sql$/;
const profileIdentityDomain = 'Eky profile identity v1\0';
const migrationIdentityDomain = 'Eky migration chain v1\0';

export interface SqliteProfileDatabaseInspection {
  migrationChainIdentity: string;
  profileId: string;
}

export function inspectSqliteProfileDatabase(
  databaseFilePath: string,
  migrationsDirectory: string,
): SqliteProfileDatabaseInspection {
  if (!isAbsolute(databaseFilePath) || !isAbsolute(migrationsDirectory)) {
    throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
  }

  const database = new Database(databaseFilePath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    const integrityResult: unknown = database.pragma('integrity_check', {
      simple: true,
    });
    const foreignKeyRows = database.pragma('foreign_key_check') as unknown[];

    if (integrityResult !== 'ok' || foreignKeyRows.length !== 0) {
      throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
    }

    const expectedMigrations = readExpectedMigrations(migrationsDirectory);
    const appliedMigrations = database
      .prepare<[], { name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name',
      )
      .all()
      .map(({ name }) => name);

    if (
      appliedMigrations.length !== expectedMigrations.length ||
      appliedMigrations.some(
        (migration, index) =>
          migration !== expectedMigrations[index]?.fileName,
      )
    ) {
      throw new Error('PROFILE_SNAPSHOT_MIGRATIONS_INVALID');
    }

    const identity = readLocalRuntimeIdentity(database);

    return {
      migrationChainIdentity: createMigrationChainIdentity(
        expectedMigrations,
      ),
      profileId: createProfileBackupIdentity(identity.companyId),
    };
  } finally {
    database.close();
  }
}

export function createProfileBackupIdentity(companyId: string): string {
  return createHash('sha256')
    .update(profileIdentityDomain, 'utf8')
    .update(companyId, 'utf8')
    .digest('hex');
}

interface ExpectedMigration {
  content: Buffer;
  fileName: string;
}

function readExpectedMigrations(
  migrationsDirectory: string,
): ExpectedMigration[] {
  return readdirSync(migrationsDirectory)
    .filter((fileName: string) => fileName.endsWith('.sql'))
    .sort()
    .map((fileName: string) => {
      if (!migrationFileNamePattern.test(fileName)) {
        throw new Error('PROFILE_SNAPSHOT_MIGRATIONS_INVALID');
      }

      return {
        content: readFileSync(join(migrationsDirectory, fileName)),
        fileName,
      };
    });
}

function createMigrationChainIdentity(
  migrations: readonly ExpectedMigration[],
): string {
  const hash = createHash('sha256').update(
    migrationIdentityDomain,
    'utf8',
  );

  for (const migration of migrations) {
    const fileName = Buffer.from(migration.fileName, 'utf8');
    const lengths = Buffer.alloc(8);
    lengths.writeUInt32BE(fileName.byteLength, 0);
    lengths.writeUInt32BE(migration.content.byteLength, 4);
    hash.update(lengths);
    hash.update(fileName);
    hash.update(migration.content);
  }

  return hash.digest('hex');
}

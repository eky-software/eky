import { createHash } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const migrationNamePattern = /^\d{3}_[a-z0-9_]+\.sql$/u;

export async function prepareW6b2HistoricalBackendStage(backendStage) {
  const migrationsDirectory = join(
    backendStage,
    'dist',
    'database',
    'migrations',
  );
  const migrationNames = (await readdir(migrationsDirectory, {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  if (
    migrationNames.length < 2 ||
    migrationNames.some((name) => !migrationNamePattern.test(name))
  ) {
    throw new Error('W6B2_HISTORICAL_MIGRATION_SET_INVALID');
  }

  const removedMigrationName = migrationNames.at(-1);
  if (removedMigrationName === undefined) {
    throw new Error('W6B2_HISTORICAL_MIGRATION_SET_INVALID');
  }
  const removedMigrationPath = join(
    migrationsDirectory,
    removedMigrationName,
  );
  const removedMigrationSha256 = createHash('sha256')
    .update(await readFile(removedMigrationPath))
    .digest('hex');

  await rm(removedMigrationPath);
  const remainingMigrationNames = (await readdir(migrationsDirectory, {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
  if (
    remainingMigrationNames.length !== migrationNames.length - 1 ||
    remainingMigrationNames.includes(removedMigrationName)
  ) {
    throw new Error('W6B2_HISTORICAL_MIGRATION_PREFIX_INVALID');
  }

  return Object.freeze({
    remainingMigrationCount: remainingMigrationNames.length,
    removedMigrationName,
    removedMigrationSha256,
  });
}

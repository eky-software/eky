import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationFileNamePattern = /^\d{3}_[A-Za-z0-9_]+\.sql$/;
const migrationIdentityDomain = 'Eky migration chain v1\0';

export interface MigrationManifestEntry {
  chainSha256: string;
  content: Buffer;
  fileName: string;
  sourceSha256: string;
}

export function readMigrationManifest(
  migrationsDirectory: string,
): MigrationManifestEntry[] {
  const migrationFileNames = readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  const migrationOrdinals = new Set<string>();

  assertContinuousMigrationOrdinals(migrationFileNames);

  const sourceEntries = migrationFileNames.map((fileName) => {
    if (!migrationFileNamePattern.test(fileName)) {
      throw new Error('MIGRATION_MANIFEST_INVALID');
    }

    const ordinal = fileName.slice(0, 3);
    if (migrationOrdinals.has(ordinal)) {
      throw new Error('MIGRATION_MANIFEST_INVALID');
    }
    migrationOrdinals.add(ordinal);

    const content = readFileSync(join(migrationsDirectory, fileName));

    return {
      content,
      fileName,
      sourceSha256: createHash('sha256').update(content).digest('hex'),
    };
  });

  return sourceEntries.map((entry, index) => ({
    ...entry,
    chainSha256: createMigrationChainIdentity(
      sourceEntries.slice(0, index + 1),
    ),
  }));
}

function assertContinuousMigrationOrdinals(
  migrationFileNames: readonly string[],
): void {
  if (migrationFileNames.length === 0) {
    throw new Error('MIGRATION_MANIFEST_INVALID');
  }

  migrationFileNames.forEach((fileName, index) => {
    if (!migrationFileNamePattern.test(fileName)) {
      throw new Error('MIGRATION_MANIFEST_INVALID');
    }

    const expectedOrdinal = String(index + 1).padStart(3, '0');
    if (fileName.slice(0, 3) !== expectedOrdinal) {
      throw new Error('MIGRATION_MANIFEST_INVALID');
    }
  });
}

export function createMigrationChainIdentity(
  migrations: readonly Pick<MigrationManifestEntry, 'content' | 'fileName'>[],
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

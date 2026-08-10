import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { readMigrationManifest } from './migrationManifest.js';

const temporaryDirectories: string[] = [];
const publishedMigrationsDirectory = fileURLToPath(
  new URL('../migrations/', import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('readMigrationManifest', () => {
  it('accepts a migration chain starting at 001 and continuing without gaps', async () => {
    const directory = await createMigrationDirectory([
      '001_create_first.sql',
      '002_create_second.sql',
      '003_create_third.sql',
    ]);

    expect(readMigrationManifest(directory).map(({ fileName }) => fileName)).toEqual([
      '001_create_first.sql',
      '002_create_second.sql',
      '003_create_third.sql',
    ]);
  });

  it.each([
    ['a gap', ['001_create_first.sql', '003_create_third.sql']],
    ['an ordinal after 001', ['002_create_second.sql']],
    ['ordinal 000', ['000_create_zero.sql']],
    [
      'a duplicate ordinal',
      ['001_create_first.sql', '001_create_duplicate.sql'],
    ],
  ])('rejects %s', async (_caseName, fileNames) => {
    const directory = await createMigrationDirectory(fileNames);

    expect(() => readMigrationManifest(directory)).toThrow(
      'MIGRATION_MANIFEST_INVALID',
    );
  });

  it('keeps the published 38-migration chain continuous', () => {
    const manifest = readMigrationManifest(publishedMigrationsDirectory);

    expect(manifest).toHaveLength(38);
    expect(manifest.at(0)?.fileName).toBe('001_create_customers.sql');
    expect(manifest.at(-1)?.fileName).toBe(
      '038_create_invoice_numbering_series_transitions.sql',
    );
  });
});

async function createMigrationDirectory(
  fileNames: readonly string[],
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'eky-manifest-'));
  temporaryDirectories.push(directory);

  await Promise.all(
    fileNames.map((fileName) =>
      writeFile(
        join(directory, fileName),
        `CREATE TABLE migration_${fileName.slice(0, 3)} (id TEXT);`,
        'utf8',
      ),
    ),
  );

  return directory;
}

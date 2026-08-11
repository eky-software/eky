import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const temporaryRoots: string[] = [];

describe('createApp migration startup gate', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) =>
        rm(root, { force: true, recursive: true }),
      ),
    );
  });

  it('reports the pre-migration state and leaves the database unchanged when the gate rejects startup', async () => {
    const fixture = await createFixture();
    let inspected = false;

    await expect(
      createApp({
        beforeMigrations: async (inspection) => {
          inspected = true;
          expect(inspection).toEqual({
            appliedMigrationCount: 0,
            migrationChainIdentity: '',
            pendingMigrationCount: 1,
            profileState: 'empty',
          });
          expect(
            await fileContains(fixture.databaseFilePath, 'startup_probe'),
          ).toBe(false);
          throw new Error('untrusted detail');
        },
        databaseFilePath: fixture.databaseFilePath,
        migrationsDirectory: fixture.migrationsDirectory,
      }),
    ).rejects.toThrow(
      'Database migration startup gate could not be completed.',
    );
    expect(inspected).toBe(true);
    expect(
      await fileContains(fixture.databaseFilePath, 'startup_probe'),
    ).toBe(false);
  });
});

async function createFixture(): Promise<{
  databaseFilePath: string;
  migrationsDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'eky-app-migration-gate-'));
  temporaryRoots.push(root);
  const migrationsDirectory = join(root, 'migrations');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(migrationsDirectory);
  await writeFile(
    join(migrationsDirectory, '001_startup_probe.sql'),
    'CREATE TABLE startup_probe (id TEXT PRIMARY KEY);',
  );
  return {
    databaseFilePath: join(root, 'profile.sqlite'),
    migrationsDirectory,
  };
}

async function fileContains(path: string, value: string): Promise<boolean> {
  try {
    return (await readFile(path)).includes(Buffer.from(value));
  } catch {
    return false;
  }
}

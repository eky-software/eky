import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { BackendOperationalEvent } from '../observability/operationalEvent.js';
import { createApp } from './app.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('createApp migration failure logging', () => {
  it('reports only safe conservative migration progress metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eky-app-migration-'));
    const migrationsDirectory = join(root, 'migrations');
    temporaryDirectories.push(root);
    await mkdir(migrationsDirectory);
    await writeFile(
      join(migrationsDirectory, '001_create_completed.sql'),
      'CREATE TABLE completed_table (id TEXT PRIMARY KEY);',
      'utf8',
    );
    await writeFile(
      join(migrationsDirectory, '002_create_broken.sql'),
      'CREATE TABLE broken syntax;',
      'utf8',
    );
    const events: BackendOperationalEvent[] = [];

    await expect(
      createApp({
        appVersion: '0.1.0-alpha.1',
        databaseFilePath: join(root, 'eky.sqlite'),
        migrationsDirectory,
        operationalIdentity: {
          appVersion: '0.1.0-alpha.1',
          buildRevision: '123456789abc',
          runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
        },
        operationalLogger: {
          write(event) {
            events.push(event);
          },
        },
      }),
    ).rejects.toThrow('Database migrations could not be completed.');

    expect(events).toContainEqual(
      expect.objectContaining({
        completedMigrationCount: 1,
        errorCode: 'MIGRATION_EXECUTION_FAILED',
        eventName: 'migration.failed',
        failureStage: 'migrationExecution',
        sideEffectState: 'unknown',
      }),
    );
    expect(JSON.stringify(events)).not.toMatch(
      /002_create_broken|CREATE TABLE|syntax|eky\.sqlite|stack/i,
    );
  });
});

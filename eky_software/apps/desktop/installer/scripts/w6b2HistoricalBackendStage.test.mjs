import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { prepareW6b2HistoricalBackendStage } from './w6b2HistoricalBackendStage.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

test('materializes an immutable historical prefix by removing only the latest staged migration', async () => {
  const fixture = await createFixture([
    '001_create_first.sql',
    '002_create_second.sql',
    '003_create_third.sql',
  ]);

  const result = await prepareW6b2HistoricalBackendStage(fixture.root);

  assert.deepEqual(result, {
    remainingMigrationCount: 2,
    removedMigrationName: '003_create_third.sql',
    removedMigrationSha256:
      'dbbef190b0d1d4478cdb01d5e3eb9b7dcbe7ac85e218a006abd4f2ea33992939',
  });
  assert.deepEqual(await readMigrationNames(fixture.migrationsDirectory), [
    '001_create_first.sql',
    '002_create_second.sql',
  ]);
});

test('rejects malformed and non-prefix migration sets without broad deletion', async () => {
  for (const names of [
    ['001_only.sql'],
    ['001_first.sql', 'latest.sql'],
  ]) {
    const fixture = await createFixture(names);
    await assert.rejects(
      () => prepareW6b2HistoricalBackendStage(fixture.root),
      /W6B2_HISTORICAL_MIGRATION_SET_INVALID/u,
    );
    assert.deepEqual(await readMigrationNames(fixture.migrationsDirectory), [
      ...names,
    ].sort());
  }
});

async function createFixture(names) {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6b2-prefix-'));
  temporaryRoots.push(root);
  const migrationsDirectory = join(
    root,
    'dist',
    'database',
    'migrations',
  );
  await mkdir(migrationsDirectory, { recursive: true });
  for (const name of names) {
    await writeFile(join(migrationsDirectory, name), `${name}\n`, 'utf8');
  }
  return { migrationsDirectory, root };
}

async function readMigrationNames(directory) {
  return (await readdir(directory)).sort();
}

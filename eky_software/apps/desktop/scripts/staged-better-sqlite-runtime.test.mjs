import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

import {
  inspectStagedBetterSqliteRuntime,
  validateRegularFileMetadata,
  verifyBetterSqliteDatabase,
} from './staged-better-sqlite-runtime.mjs';

const temporaryDirectories = [];
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createStagedFixture({
  includeNative = true,
  version = '13.0.2',
} = {}) {
  const backendStage = await mkdtemp(
    resolve(tmpdir(), 'eky-better-sqlite-stage-'),
  );
  temporaryDirectories.push(backendStage);
  const packageRoot = resolve(
    backendStage,
    'node_modules/better-sqlite3',
  );
  await mkdir(resolve(packageRoot, 'lib'), { recursive: true });
  await mkdir(resolve(packageRoot, 'prebuilds'), { recursive: true });
  await writeFile(
    resolve(backendStage, 'package.json'),
    JSON.stringify({ private: true }),
    'utf8',
  );
  await writeFile(
    resolve(packageRoot, 'package.json'),
    JSON.stringify({
      exports: {
        './package.json': './package.json',
        './win32-x64': './lib/win32-x64.js',
      },
      name: 'better-sqlite3',
      version,
    }),
    'utf8',
  );
  await writeFile(
    resolve(packageRoot, 'lib/win32-x64.js'),
    "'use strict';\n",
    'utf8',
  );
  if (includeNative) {
    await writeFile(
      resolve(packageRoot, 'prebuilds/win32-x64.node'),
      Buffer.alloc(100_000),
    );
  }
  return backendStage;
}

test('accepts the exact staged win32-x64 bundled runtime', async () => {
  const backendStage = await createStagedFixture();

  const result = await inspectStagedBetterSqliteRuntime({ backendStage });

  assert.equal(result.version, '13.0.2');
  assert.match(result.nativePath, /prebuilds[\\/]win32-x64\.node$/);
});

test('rejects a missing staged win32-x64 prebuild', async () => {
  const backendStage = await createStagedFixture({ includeNative: false });

  await assert.rejects(
    inspectStagedBetterSqliteRuntime({ backendStage }),
    /win32-x64\.node|ENOENT/,
  );
});

test('rejects a staged package with the wrong version', async () => {
  const backendStage = await createStagedFixture({ version: '13.0.1' });

  await assert.rejects(
    inspectStagedBetterSqliteRuntime({ backendStage }),
    /Expected staged better-sqlite3 13\.0\.2, found 13\.0\.1/,
  );
});

test('rejects an unsupported staged architecture', async () => {
  const backendStage = await createStagedFixture();

  await assert.rejects(
    inspectStagedBetterSqliteRuntime({
      arch: 'arm64',
      backendStage,
    }),
    /Unsupported staged better-sqlite3 target: win32-arm64/,
  );
});

test('rejects symbolic-link native file metadata', () => {
  assert.throws(
    () =>
      validateRegularFileMetadata({
        fileSize: 1_000_000,
        isFile: true,
        isSymbolicLink: true,
        label: 'Synthetic native file',
        minimumSize: 100_000,
      }),
    /must not be a symbolic link/,
  );
});

test('loads the installed runtime and verifies read, write and transactions', () => {
  const backendRequire = createRequire(
    resolve(repositoryRoot, 'backend/package.json'),
  );
  const Database = backendRequire('better-sqlite3');

  assert.match(verifyBetterSqliteDatabase(Database), /^\d+\.\d+\.\d+$/);
});

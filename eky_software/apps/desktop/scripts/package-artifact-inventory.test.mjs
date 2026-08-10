import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  inspectPackageArtifactInventory,
  PackageArtifactInventoryError,
} from './package-artifact-inventory.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

for (const [name, content] of [
  ['profile.sqlite', 'database'],
  ['approved-invoice.pdf', '%PDF-'],
  ['.env', 'SECRET=value'],
  ['company-email-smtp-v1.dat', 'encrypted'],
  ['e2e-dist/runtime.json', '{}'],
]) {
  test(`rejects an injected ${name} artifact`, async () => {
    const root = await createStageFixture(name, content);
    await assert.rejects(
      inspectPackageArtifactInventory({ root, stage: 'applicationStage' }),
      PackageArtifactInventoryError,
    );
  });
}

test('allows only the exact named packaged smoke helpers', async () => {
  const root = await createStageFixture(
    'dist/main/packagedSmoke.js',
    'export {};',
  );
  await writeFixture(root, 'dist/main/unplannedSmoke.js', 'export {};');

  await assert.rejects(
    inspectPackageArtifactInventory({ root, stage: 'applicationStage' }),
    /UNAPPROVED_SMOKE_HELPER/,
  );
  await rm(join(root, 'dist/main/unplannedSmoke.js'));
  await assert.doesNotReject(
    inspectPackageArtifactInventory({ root, stage: 'applicationStage' }),
  );
});

test('returns a stable bounded inventory without exposing file contents', async () => {
  const root = await createStageFixture('dist/main/index.js', 'safe content');
  const first = await inspectPackageArtifactInventory({
    root,
    stage: 'applicationStage',
  });
  const second = await inspectPackageArtifactInventory({
    root,
    stage: 'applicationStage',
  });

  assert.deepEqual(first, second);
  assert.equal(first.fileCount, 1);
  assert.match(first.identity, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(first), /safe content|dist\/main/);
});

test('rejects symbolic links from every package stage', async () => {
  const root = await createStageFixture(
    'node_modules/.physical-package/index.js',
    'export {};',
  );
  const target = join(root, 'node_modules/.physical-package');
  const link = join(root, 'node_modules/linked-package');
  await symlink(target, link, 'junction');

  await assert.rejects(
    inspectPackageArtifactInventory({ root, stage: 'backendStage' }),
    /SYMLINK/,
  );
});

test('distinguishes packaged third-party source from Eky-owned source', async () => {
  const root = await createStageFixture(
    'resources/backend/node_modules/external-package/src/index.ts',
    'export {};',
  );

  await assert.doesNotReject(
    inspectPackageArtifactInventory({ root, stage: 'packagedApp' }),
  );
  await writeFixture(
    root,
    'resources/backend/node_modules/@eky/auth/src/index.ts',
    'export {};',
  );
  await assert.rejects(
    inspectPackageArtifactInventory({ root, stage: 'packagedApp' }),
    /SOURCE_OR_TEST_ARTIFACT/,
  );
});

test('rejects Eky-owned source maps but includes vendor maps in the inventory', async () => {
  const root = await createStageFixture(
    'node_modules/external-package/index.js.map',
    'vendor map one',
  );
  const first = await inspectPackageArtifactInventory({
    root,
    stage: 'backendStage',
  });
  await writeFixture(
    root,
    'node_modules/external-package/index.js.map',
    'vendor map two',
  );
  const second = await inspectPackageArtifactInventory({
    root,
    stage: 'backendStage',
  });

  assert.equal(first.fileCount, 1);
  assert.notEqual(first.identity, second.identity);

  await writeFixture(root, 'dist/index.js.map', 'project map');
  await assert.rejects(
    inspectPackageArtifactInventory({ root, stage: 'backendStage' }),
    /PROJECT_SOURCE_MAP/,
  );
});

test('enforces the application-stage file count boundary', async () => {
  const root = await createStageFixture('dist/file-000.js', 'safe');
  await Promise.all(
    Array.from({ length: 192 }, (_, index) =>
      writeFixture(
        root,
        `dist/file-${String(index + 1).padStart(3, '0')}.js`,
        'safe',
      ),
    ),
  );

  await assert.rejects(
    inspectPackageArtifactInventory({ root, stage: 'applicationStage' }),
    /FILE_COUNT/,
  );
});

test('enforces stage-specific path, depth, file and total byte boundaries', async () => {
  const longPathRoot = await createStageFixture(
    `dist/${'a'.repeat(90)}.js`,
    'safe',
  );
  await assert.rejects(
    inspectPackageArtifactInventory({
      root: longPathRoot,
      stage: 'applicationStage',
    }),
    /LOGICAL_PATH/,
  );

  const deepRoot = await createStageFixture(
    'one/two/three/four/five/six/seven.js',
    'safe',
  );
  await assert.rejects(
    inspectPackageArtifactInventory({
      root: deepRoot,
      stage: 'applicationStage',
    }),
    /DIRECTORY_DEPTH/,
  );

  const largeFileRoot = await createStageFixture(
    'dist/oversized.js',
    Buffer.alloc(1_048_577),
  );
  await assert.rejects(
    inspectPackageArtifactInventory({
      root: largeFileRoot,
      stage: 'applicationStage',
    }),
    /PROJECT_FILE_SIZE/,
  );

  const totalSizeRoot = await createStageFixture(
    'node_modules/vendor/first.bin',
    Buffer.alloc(1_100_000),
  );
  await writeFixture(
    totalSizeRoot,
    'node_modules/vendor/second.bin',
    Buffer.alloc(1_100_000),
  );
  await assert.rejects(
    inspectPackageArtifactInventory({
      root: totalSizeRoot,
      stage: 'applicationStage',
    }),
    /SIZE/,
  );
});

async function createStageFixture(name, content) {
  const root = await mkdtemp(join(tmpdir(), 'eky-package-inventory-'));
  temporaryDirectories.push(root);
  await writeFixture(root, name, content);
  return root;
}

async function writeFixture(root, name, content) {
  const path = join(root, ...name.split('/'));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    content,
    typeof content === 'string' ? 'utf8' : undefined,
  );
}

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  classifyForbiddenArtifact,
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

for (const name of [
  'runtime.json.gz',
  'runtime.log',
  'runtime.bak',
  'runtime.backup',
  'runtime.dmp',
  'runtime.pem',
]) {
  test(`rejects an Eky-owned ${name} artifact`, async () => {
    const root = await createStageFixture(`dist/${name}`, 'sensitive');

    await assert.rejects(
      inspectPackageArtifactInventory({ root, stage: 'applicationStage' }),
      /PROJECT_RUNTIME_OR_SENSITIVE_ARTIFACT/,
    );
  });
}

for (const name of ['private.key', 'identity.p12', 'identity.pfx']) {
  test(`rejects a vendor-owned ${name} artifact`, async () => {
    const root = await createStageFixture(
      `node_modules/external-package/${name}`,
      'private',
    );

    await assert.rejects(
      inspectPackageArtifactInventory({ root, stage: 'backendStage' }),
      /PRIVATE_KEY_ARTIFACT/,
    );
  });
}

test('rejects a renamed vendor private key in PEM format', async () => {
  const root = await createStageFixture(
    'node_modules/external-package/runtime.pem',
    '-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----',
  );

  await assert.rejects(
    inspectPackageArtifactInventory({ root, stage: 'backendStage' }),
    /PRIVATE_KEY_ARTIFACT/,
  );
});

test('requires an explicit review before allowing a vendor sensitive artifact', async () => {
  const root = await createStageFixture(
    'node_modules/external-package/runtime.log',
    'vendor runtime data',
  );

  await assert.rejects(
    inspectPackageArtifactInventory({ root, stage: 'backendStage' }),
    /VENDOR_SENSITIVE_ARTIFACT_REVIEW_REQUIRED/,
  );
});

test('rejects service-account credentials regardless of file name or owner', async () => {
  const root = await createStageFixture(
    'node_modules/external-package/runtime-config.json',
    JSON.stringify({
      client_email: 'synthetic@example.invalid',
      private_key: 'synthetic-private-key',
      type: 'service_account',
    }),
  );

  await assert.rejects(
    inspectPackageArtifactInventory({ root, stage: 'backendStage' }),
    /SERVICE_ACCOUNT_ARTIFACT/,
  );
});

test('rejects service-account-like JSON file names before reading contents', async () => {
  const root = await createStageFixture(
    'node_modules/external-package/test-service-account.json',
    '{}',
  );

  await assert.rejects(
    inspectPackageArtifactInventory({ root, stage: 'backendStage' }),
    /SERVICE_ACCOUNT_ARTIFACT/,
  );
});

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

test('allows compiled workspace runtime code in the application stage', async () => {
  const root = await createStageFixture(
    'dist/workspaces/registry/file.js',
    'export {};',
  );

  await assert.doesNotReject(
    inspectPackageArtifactInventory({ root, stage: 'applicationStage' }),
  );
});

test('rejects compiled workspace test support from the application stage', async () => {
  const root = await createStageFixture(
    'dist/workspaces/switch/workspaceSwitchTestSupport.js',
    'export {};',
  );

  await assert.rejects(
    inspectPackageArtifactInventory({ root, stage: 'applicationStage' }),
    /SOURCE_OR_TEST_ARTIFACT/,
  );
});

test('allows compiled workspace runtime paths with Windows separators', () => {
  assert.equal(
    classifyForbiddenArtifact(
      'dist\\workspaces\\registry\\file.js',
      'applicationStage',
    ),
    undefined,
  );
});

test('does not treat unrelated workspace names as restricted workspace code', () => {
  assert.equal(
    classifyForbiddenArtifact(
      'dist/main/workspaces.js',
      'applicationStage',
    ),
    undefined,
  );
  assert.equal(
    classifyForbiddenArtifact(
      'node_modules/external-package/dist/workspaces/registry/file.js',
      'backendStage',
    ),
    undefined,
  );
  assert.equal(
    classifyForbiddenArtifact('dist/main/index.js', 'applicationStage'),
    undefined,
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

test('uses a locale-independent logical path order for inventory identity', async () => {
  const firstRoot = await createStageFixture('dist/z.js', 'z');
  await writeFixture(firstRoot, 'dist/10.js', 'ten');
  await writeFixture(firstRoot, 'dist/2.js', 'two');

  const secondRoot = await createStageFixture('dist/2.js', 'two');
  await writeFixture(secondRoot, 'dist/10.js', 'ten');
  await writeFixture(secondRoot, 'dist/z.js', 'z');

  const first = await inspectPackageArtifactInventory({
    root: firstRoot,
    stage: 'applicationStage',
  });
  const second = await inspectPackageArtifactInventory({
    root: secondRoot,
    stage: 'applicationStage',
  });

  assert.equal(first.identity, second.identity);
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
    Array.from({ length: 336 }, (_, index) =>
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

test('allows exactly the four reviewed update runtime scripts', async () => {
  const root = await createStageFixture(
    'inspectWindowsInstallerIdentity.ps1',
    'safe',
  );
  await writeFixture(root, 'inspectWindowsRegularFile.ps1', 'safe');
  await writeFixture(root, 'launchRollbackWindowsInstaller.ps1', 'safe');
  await writeFixture(root, 'rollbackWindowsInstaller.ps1', 'safe');

  await assert.doesNotReject(
    inspectPackageArtifactInventory({ root, stage: 'updateRuntimeStage' }),
  );
  await rm(join(root, 'inspectWindowsRegularFile.ps1'));
  await writeFixture(root, 'unreviewedUpdateScript.ps1', 'safe');
  await assert.rejects(
    inspectPackageArtifactInventory({ root, stage: 'updateRuntimeStage' }),
    /UNAPPROVED_UPDATE_RUNTIME_ARTIFACT/,
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

  const packagedAppRoot = await createStageFixture(
    'resources/app.asar',
    Buffer.alloc(2_359_296),
  );
  await assert.doesNotReject(
    inspectPackageArtifactInventory({
      root: packagedAppRoot,
      stage: 'packagedApp',
    }),
  );
  await writeFixture(
    packagedAppRoot,
    'resources/app.asar',
    Buffer.alloc(2_359_297),
  );
  await assert.rejects(
    inspectPackageArtifactInventory({
      root: packagedAppRoot,
      stage: 'packagedApp',
    }),
    /PROJECT_FILE_SIZE/,
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

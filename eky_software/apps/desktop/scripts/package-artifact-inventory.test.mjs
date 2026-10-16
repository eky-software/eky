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
import { BACKEND_BUILD_METADATA_PATHS } from './backendBuildMetadata.mjs';
import { profileInspectionNativeContract as inspectionNative } from '../../backend/src/database/connection/profileInspectionNativeContract.ts';

const temporaryDirectories = [];

test('validated file observation follows complete admission and cannot alter its result', async () => {
  const root = await createStageFixture('Eky.exe', 'synthetic executable');
  await writeFixture(root, 'resources/app.asar', 'synthetic application');
  let files;
  const expected = await inspectPackageArtifactInventory({ root, stage: 'packagedApp' });
  const actual = await inspectPackageArtifactInventory({ root, stage: 'packagedApp', onValidatedFiles(value) {
    files = value;
    assert.equal(Object.isFrozen(value), true);
    throw new Error('optional observation failed');
  } });
  assert.deepEqual(actual, expected);
  assert.deepEqual(files, ['Eky.exe', 'resources/app.asar']);
  await writeFixture(root, 'private.sqlite', 'excluded');
  let calls = 0;
  await assert.rejects(inspectPackageArtifactInventory({ root, stage: 'packagedApp', onValidatedFiles() { calls++; } }), /DATABASE/);
  assert.equal(calls, 0);
});

for (const [stage, prefix] of [
  ['profileInspectionNativeStage', ''],
  ['packagedApp', `resources/${inspectionNative.directoryName}/`],
]) {
  test(`inspection native has its own reviewed file budget in ${stage}`, async () => {
    const root = await createStageFixture(`${prefix}${inspectionNative.fileName}`, Buffer.alloc(3 * 1024 * 1024, 1));
    await writeFixture(root, `${prefix}${inspectionNative.metadataFileName}`, '{}');
    const inventory = await inspectPackageArtifactInventory({ root, stage });
    assert.equal(inventory.fileCount, 2);
    assert.equal(inventory.totalByteSize, 3 * 1024 * 1024 + 2);
  });

  for (const [name, bytes] of [
    [inspectionNative.fileName, inspectionNative.minimumNativeBytes - 1],
    [inspectionNative.fileName, inspectionNative.maximumNativeBytes + 1],
    [inspectionNative.metadataFileName, inspectionNative.maximumMetadataBytes + 1],
  ]) {
    test(`inspection native rejects out-of-bound ${name} (${bytes}) in ${stage}`, async () => {
      const root = await createStageFixture(`${prefix}${inspectionNative.fileName}`, Buffer.alloc(inspectionNative.minimumNativeBytes));
      await writeFixture(root, `${prefix}${inspectionNative.metadataFileName}`, '{}');
      await writeFixture(root, `${prefix}${name}`, Buffer.alloc(bytes));
      await assert.rejects(inspectPackageArtifactInventory({ root, stage }), /INSPECTION_NATIVE_SIZE_OR_LINK/);
    });
  }

  test(`inspection native rejects a substituted extra file in ${stage}`, async () => {
    const root = await createStageFixture(`${prefix}${inspectionNative.fileName}`, Buffer.alloc(inspectionNative.minimumNativeBytes));
    await writeFixture(root, `${prefix}unapproved.bin`, 'not delivered');
    await assert.rejects(inspectPackageArtifactInventory({ root, stage }), /UNAPPROVED_INSPECTION_NATIVE_ARTIFACT/);
  });
}

test('inspection native stage requires both resource files', async () => {
  const root = await createStageFixture(inspectionNative.fileName, Buffer.alloc(inspectionNative.minimumNativeBytes));
  await assert.rejects(inspectPackageArtifactInventory({ root, stage: 'profileInspectionNativeStage' }), /INSPECTION_NATIVE_FILES/);
});

test('inspection-only size exception does not increase the packaged backend budget', async () => {
  const root = await createStageFixture('resources/backend/dist/unreviewed.js', Buffer.alloc(3 * 1024 * 1024));
  await assert.rejects(inspectPackageArtifactInventory({ root, stage: 'packagedApp' }), /PROJECT_FILE_SIZE/);
});

for (const [stage, prefix] of [
  ['backendStage', ''],
  ['packagedApp', 'resources/backend/'],
]) {
  for (const name of BACKEND_BUILD_METADATA_PATHS) {
    test(`rejects backend build metadata in ${stage}: ${name}`, async () => {
      const root = await createStageFixture(`${prefix}${name}`, 'build metadata');
      await assert.rejects(
        inspectPackageArtifactInventory({ root, stage }),
        /BACKEND_BUILD_METADATA/,
      );
    });
  }

  test(`rejects build-local references in the ${stage} backend manifest`, async () => {
    for (const value of [
      '@eky/auth@file:///synthetic-build/packages/auth',
      'file:///synthetic-build/packages/auth',
      '/synthetic-build/packages/auth',
    ]) {
      const root = await createStageFixture(`${prefix}package.json`,
        `${JSON.stringify({ name: '@eky/backend', dependencies: { '@eky/auth': value } }, null, 2)}\n`);
      await assert.rejects(
        inspectPackageArtifactInventory({ root, stage }),
        /BACKEND_BUILD_MANIFEST/,
      );
    }
  });

  test(`rejects ambiguous backend manifest bytes in ${stage}`, async () => {
    const root = await createStageFixture(`${prefix}package.json`,
      '{"dependencies":{},"dependencies":{"vendor":"file:///synthetic-build/vendor"}}');
    await assert.rejects(
      inspectPackageArtifactInventory({ root, stage }),
      /BACKEND_BUILD_MANIFEST/,
    );
  });

  test(`keeps normalized references and vendor metadata unchanged in ${stage}`, async () => {
    const manifest = `${JSON.stringify({ name: '@eky/backend',
      dependencies: { '@eky/auth': 'workspace:*', vendor: '1.0.0' } }, null, 2)}\n`;
    const root = await createStageFixture(`${prefix}package.json`, manifest);
    await writeFixture(root, `${prefix}node_modules/vendor/package.json`,
      '{"devDependencies":{"example":"file:../example"}}');
    await writeFixture(root, `${prefix}node_modules/vendor/pnpm-lock.yaml`, 'vendor lock');
    await writeFixture(root, `${prefix}node_modules/vendor/LICENSE`, 'license bytes');
    const first = await inspectPackageArtifactInventory({ root, stage });
    const second = await inspectPackageArtifactInventory({ root, stage });
    assert.deepEqual(first, second);
    assert.equal(first.fileCount, 4);
  });
}

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
  await writeFixture(root, 'dist/profileBackup/packagedLegacyProfileSmoke.js', 'export {};');
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
    Array.from({ length: 399 }, (_, index) =>
      writeFixture(
        root,
        `dist/file-${String(index + 1).padStart(3, '0')}.js`,
        'safe',
      ),
    ),
  );

  const inventory = await inspectPackageArtifactInventory({
    root,
    stage: 'applicationStage',
  });
  assert.equal(inventory.fileCount, 400);

  await writeFixture(root, 'dist/file-400.js', 'safe');
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
    Buffer.alloc(1_441_792),
  );
  await writeFixture(
    totalSizeRoot,
    'node_modules/vendor/second.bin',
    Buffer.alloc(1_441_792),
  );
  const atTotalSizeLimit = await inspectPackageArtifactInventory({
    root: totalSizeRoot,
    stage: 'applicationStage',
  });
  assert.equal(atTotalSizeLimit.totalByteSize, 2_883_584);
  await writeFixture(
    totalSizeRoot,
    'node_modules/vendor/second.bin',
    Buffer.alloc(1_441_793),
  );
  await assert.rejects(
    inspectPackageArtifactInventory({
      root: totalSizeRoot,
      stage: 'applicationStage',
    }),
    /PACKAGE_ARTIFACT_INVENTORY_INVALID:SIZE$/,
  );

  const packagedAppRoot = await createStageFixture(
    'resources/app.asar',
    Buffer.alloc(2_883_584),
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
    Buffer.alloc(2_883_585),
  );
  await assert.rejects(
    inspectPackageArtifactInventory({
      root: packagedAppRoot,
      stage: 'packagedApp',
    }),
    /PROJECT_FILE_SIZE/,
  );
});

for (const name of [
  'resources/App.asar',
  'Resources/app.asar',
  'resources/backend/app.asar',
  'resources/backend/dist/index.js',
  'resources/backend/node_modules/@eky/auth/dist/index.js',
  'resources/desktop-runtime/index.js',
  'resources/update-runtime/inspectWindowsRegularFile.ps1',
]) {
  test(`keeps the packaged project-file limit unchanged for ${name}`, async () => {
    const root = await createStageFixture(name, Buffer.alloc(2_359_296));
    const inventory = await inspectPackageArtifactInventory({ root, stage: 'packagedApp' });
    assert.equal(inventory.totalByteSize, 2_359_296);

    await writeFixture(root, name, Buffer.alloc(2_359_297));
    await assert.rejects(
      inspectPackageArtifactInventory({ root, stage: 'packagedApp' }),
      /PACKAGE_ARTIFACT_INVENTORY_INVALID:PROJECT_FILE_SIZE$/,
    );
  });
}

for (const [stage, name, maximumBytes] of [
  ['applicationStage', 'resources/app.asar', 1_048_576],
  ['backendStage', 'resources/app.asar', 262_144],
  ['desktopRuntimeStage', 'resources/app.asar', 262_144],
  ['updateRuntimeStage', 'inspectWindowsRegularFile.ps1', 32_768],
]) {
  test(`keeps the project-file limit unchanged in ${stage}`, async () => {
    const root = await createStageFixture(name, Buffer.alloc(maximumBytes));
    const inventory = await inspectPackageArtifactInventory({ root, stage });
    assert.equal(inventory.totalByteSize, maximumBytes);

    await writeFixture(root, name, Buffer.alloc(maximumBytes + 1));
    await assert.rejects(
      inspectPackageArtifactInventory({ root, stage }),
      /PACKAGE_ARTIFACT_INVENTORY_INVALID:PROJECT_FILE_SIZE$/,
    );
  });
}

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

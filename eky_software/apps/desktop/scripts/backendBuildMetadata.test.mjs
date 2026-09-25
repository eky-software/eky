import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import {
  assertBackendManifestHasNoBuildPaths,
  BACKEND_BUILD_METADATA_PATHS,
  captureBackendBuildMetadataSource,
  normalizeBackendBuildMetadata,
} from './backendBuildMetadata.mjs';

const canonical = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const safeError = (reason) => (error) => {
  assert.equal(error.message, `BACKEND_BUILD_METADATA_${reason}`);
  assert.equal(error.code, error.message);
  assert.equal(error.cause, undefined);
  return true;
};

function backendManifest() {
  return {
    name: '@eky/backend',
    private: true,
    version: '0.0.0',
    type: 'commonjs',
    main: 'dist/index.cjs',
    dependencies: {
      '@eky/auth': 'workspace:*',
      '@eky/permissions': 'workspace:*',
      '@hono/node-server': '2.1.0(hono@4.13.5)',
      'better-sqlite3': '13.0.2',
      hono: '4.13.5',
      pdfkit: '0.19.1',
    },
    devDependencies: { '@types/node': '24.13.3' },
    optionalDependencies: {},
    peerDependencies: { external: '^1.0.0' },
    exports: { '.': { node: './dist/index.cjs', default: './dist/fallback.cjs' } },
    imports: { '#example': { node: './dist/index.cjs', default: './dist/fallback.cjs' } },
    custom: { z: ['retained', { b: 2, a: 1 }], a: true },
  };
}

async function put(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function fixture(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eky-backend-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const repositoryRoot = join(root, 'source');
  const backendStage = join(root, 'stage');
  const original = backendManifest();
  original.dependencies['@hono/node-server'] = '2.1.0';
  original.dependencies.pdfkit = '^0.19.1';
  original.devDependencies['@types/node'] = '^24.13.3';
  delete original.optionalDependencies;
  const sourceFiles = [
    [join(repositoryRoot, 'apps/backend/package.json'), original],
    [join(repositoryRoot, 'packages/auth/package.json'), {
      name: '@eky/auth', version: '0.0.0', main: 'index.cjs',
      dependencies: { '@eky/permissions': 'workspace:*' },
    }],
    [join(repositoryRoot, 'packages/permissions/package.json'), {
      name: '@eky/permissions', version: '0.0.0', main: 'index.cjs',
    }],
  ];
  for (const [path, manifest] of sourceFiles) {
    await put(path, `${JSON.stringify(manifest, null, '\t')}\r\n`);
  }
  const deployed = backendManifest();
  for (const name of ['auth', 'permissions']) {
    deployed.dependencies[`@eky/${name}`] =
      `@eky/${name}@${pathToFileURL(await realpath(join(repositoryRoot, 'packages', name))).href}`;
  }
  await put(join(backendStage, 'package.json'), canonical(deployed));
  for (const path of BACKEND_BUILD_METADATA_PATHS) {
    await put(join(backendStage, path), 'synthetic build metadata\n');
  }
  for (const [name, contents] of [
    ['dist/index.cjs', 'module.exports = require("@eky/auth");'],
    ['dist/fallback.cjs', 'module.exports = "wrong condition";'],
    ['node_modules/@eky/auth/index.cjs', 'module.exports = require("@eky/permissions");'],
    ['node_modules/@eky/permissions/index.cjs', 'module.exports = "synthetic permission";'],
    ['node_modules/vendor/LICENSE', 'synthetic license\n'],
    ['node_modules/vendor/NOTICE', 'synthetic notice\n'],
    ['node_modules/better-sqlite3/deps/patches/1208.patch', 'synthetic vendor patch\n'],
    ['node_modules/better-sqlite3/prebuilds/win32-x64.node', Buffer.from([0, 1, 2, 3])],
    ['node_modules/vendor/pnpm-lock.yaml', 'retained vendor file\n'],
    ['nested/pnpm-workspace.yaml', 'retained nested file\n'],
  ]) await put(join(backendStage, name), contents);
  for (const [sourcePath, manifest] of sourceFiles.slice(1)) {
    await put(join(backendStage, 'node_modules', manifest.name, 'package.json'),
      await readFile(sourcePath));
  }
  await put(join(backendStage, 'node_modules/vendor/package.json'),
    '{"name":"vendor","dependencies":{"local":"file:/synthetic/vendor"}}\n');
  const source = await captureBackendBuildMetadataSource({ repositoryRoot });
  return { root, repositoryRoot, backendStage, source, sourceFiles, deployed };
}

async function hashes(root) {
  const result = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        result[relative(root, path).replaceAll('\\', '/')] =
          createHash('sha256').update(await readFile(path)).digest('hex');
      }
    }
  }
  await visit(root);
  return result;
}

test('changes only two root dependency values and exactly three metadata files', async (t) => {
  const f = await fixture(t);
  const before = await hashes(f.root);
  const manifestPath = join(f.backendStage, 'package.json');
  const oldIdentity = await lstat(manifestPath, { bigint: true });
  assert.deepEqual(Object.keys(f.source), []);
  assert.equal(Object.isFrozen(f.source), true);
  await normalizeBackendBuildMetadata(f);
  const after = await hashes(f.root);
  assert.deepEqual(BACKEND_BUILD_METADATA_PATHS, [
    'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'node_modules/.modules.yaml',
  ]);
  for (const path of BACKEND_BUILD_METADATA_PATHS) delete before[`stage/${path}`];
  const expected = canonical(backendManifest());
  before['stage/package.json'] = createHash('sha256').update(expected).digest('hex');
  assert.deepEqual(after, before);
  assert.deepEqual(await readFile(manifestPath), expected);
  const newIdentity = await lstat(manifestPath, { bigint: true });
  assert.notEqual(newIdentity.ino, oldIdentity.ino);
  assert.equal(newIdentity.nlink, 1n);
  await normalizeBackendBuildMetadata(f);
  assert.deepEqual(await hashes(f.root), after);
  const idempotentIdentity = await lstat(manifestPath, { bigint: true });
  assert.equal(idempotentIdentity.ino, newIdentity.ino);
  assert.equal(idempotentIdentity.mtimeNs, newIdentity.mtimeNs);
});

test('preserves actual contained package resolution, exports order and transitive workspace resolution', async (t) => {
  const f = await fixture(t);
  const resolveFresh = () => JSON.parse(execFileSync(process.execPath, ['-e', `
    const { createRequire } = require('node:module');
    const stageRequire = createRequire(process.argv[1]);
    const authRequire = createRequire(stageRequire.resolve('@eky/auth'));
    process.stdout.write(JSON.stringify({
      targets: [stageRequire.resolve('@eky/backend'), stageRequire.resolve('@eky/auth'),
        stageRequire.resolve('@eky/permissions'), authRequire.resolve('@eky/permissions')],
      value: stageRequire('@eky/backend'),
    }));
  `, join(f.backendStage, 'package.json')], { encoding: 'utf8', windowsHide: true }));
  const before = resolveFresh();
  for (const target of before.targets) assert.ok(target.startsWith(f.backendStage));
  assert.equal(before.value, 'synthetic permission');
  await normalizeBackendBuildMetadata(f);
  assert.deepEqual(resolveFresh(), before);
  assertBackendManifestHasNoBuildPaths(await readFile(join(f.backendStage, 'package.json')));
});

test('missing metadata is an idempotent no-op including an absent node_modules directory', async (t) => {
  const f = await fixture(t);
  await put(join(f.backendStage, 'package.json'), canonical(backendManifest()));
  for (const path of BACKEND_BUILD_METADATA_PATHS) await rm(join(f.backendStage, path));
  await rm(join(f.backendStage, 'node_modules'), { recursive: true });
  const before = await hashes(f.root);
  await normalizeBackendBuildMetadata(f);
  assert.deepEqual(await hashes(f.root), before);
});

const invalidManifests = [
  ['malformed JSON', Buffer.from('{')],
  ['non-object', canonical([])],
  ['null', canonical(null)],
  ['wrong identity', canonical({ ...backendManifest(), name: 'other' })],
  ['dependency array', canonical({ ...backendManifest(), dependencies: [] })],
  ['null dependency map', canonical({ ...backendManifest(), dependencies: null })],
  ['numeric dependency', canonical({ ...backendManifest(), dependencies: { x: 1 } })],
  ['empty dependency', canonical({ ...backendManifest(), dependencies: { x: '' } })],
  ['whitespace dependency', canonical({ ...backendManifest(), dependencies: { x: ' 1.0.0' } })],
  ['control character', canonical({ ...backendManifest(), dependencies: { x: '1\n0' } })],
  ['duplicate root key', Buffer.from(canonical(backendManifest()).toString().replace(
    '  "name": "@eky/backend",', '  "name": "@eky/backend",\n  "name": "@eky/backend",'))],
  ['nested duplicate', Buffer.from(canonical(backendManifest()).toString().replace(
    '        "b": 2,', '        "b": 2,\n        "b": 2,'))],
  ['escaped-equivalent duplicate', Buffer.from(canonical(backendManifest()).toString().replace(
    '        "b": 2,', '        "b": 2,\n        "\\u0062": 2,'))],
  ['compact formatting', Buffer.from(`${JSON.stringify(backendManifest())}\n`)],
  ['tabs', Buffer.from(`${JSON.stringify(backendManifest(), null, '\t')}\n`)],
  ['CRLF', Buffer.from(canonical(backendManifest()).toString().replaceAll('\n', '\r\n'))],
  ['no final newline', canonical(backendManifest()).subarray(0, -1)],
  ['UTF-8 BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonical(backendManifest())])],
  ['invalid UTF-8', Buffer.from(canonical(backendManifest()).toString().replace(
    '"retained"', '"\xff"'), 'latin1')],
  ['byte-changing number', Buffer.from('{\n  "name": "@eky/backend",\n  "custom": 9007199254740993\n}\n')],
  ['overflowing number', Buffer.from('{\n  "name": "@eky/backend",\n  "custom": 1e400\n}\n')],
  ['oversized', canonical({ ...backendManifest(), custom: 'x'.repeat(262_144) })],
];

for (const [label, bytes] of invalidManifests) {
  test(`rejects ${label} without mutating the stage`, async (t) => {
    assert.throws(() => assertBackendManifestHasNoBuildPaths(bytes), safeError('MANIFEST_INVALID'));
    const f = await fixture(t);
    await put(join(f.backendStage, 'package.json'), bytes);
    const before = await hashes(f.root);
    await assert.rejects(normalizeBackendBuildMetadata(f), safeError('MANIFEST_INVALID'));
    assert.deepEqual(await hashes(f.root), before);
  });
}

for (const specifier of [
  'file:/synthetic/pkg', 'file:../pkg', '@scope/pkg@file:///synthetic/pkg',
  'git+file:///synthetic/pkg',
  'npm:alias@file:///synthetic/pkg', 'pkg@FILE:///synthetic/pkg',
  'link:../pkg', 'portal:../pkg', 'workspace:../pkg',
  '/synthetic/pkg', '//server/share/pkg', '\\\\server\\share\\pkg',
  'Z:\\synthetic\\pkg', 'Z:/synthetic/pkg', 'Z:relative',
  '../pkg', './pkg', '~/pkg', 'pkg@/synthetic/pkg', '1.0.0(peer@file:///synthetic/pkg)',
]) {
  test(`rejects local dependency specifier ${specifier}`, async (t) => {
    const manifest = backendManifest();
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      manifest[field] = { extra: specifier };
      assert.throws(() => assertBackendManifestHasNoBuildPaths(canonical(manifest)), safeError('BUILD_PATH'));
      delete manifest[field];
    }
    const f = await fixture(t);
    f.deployed.dependencies.extra = specifier;
    await put(join(f.backendStage, 'package.json'), canonical(f.deployed));
    const before = await hashes(f.root);
    await assert.rejects(normalizeBackendBuildMetadata(f), safeError('BUILD_PATH'));
    assert.deepEqual(await hashes(f.root), before);
  });
}

test('preserves nonlocal registry, alias, peer, git and URL declarations', () => {
  const manifest = backendManifest();
  manifest.dependencies = {
    workspace: 'workspace:*', registry: '^1.0.0', alias: 'npm:other@1.0.0',
    peer: '2.1.0(hono@4.13.5)', tag: 'next', shorthand: 'synthetic/project',
    git: 'git+https://example.invalid/project.git', ssh: 'git+ssh://git@example.invalid/project.git',
    tarball: 'https://example.invalid/package.tgz',
  };
  assert.doesNotThrow(() => assertBackendManifestHasNoBuildPaths(canonical(manifest)));
});

test('accepts the exact byte limit and rejects non-byte inputs', () => {
  const manifest = backendManifest();
  manifest.custom = '';
  manifest.custom = 'x'.repeat(262_144 - canonical(manifest).length);
  const bytes = canonical(manifest);
  assert.equal(bytes.length, 262_144);
  assert.doesNotThrow(() => assertBackendManifestHasNoBuildPaths(bytes));
  for (const value of [undefined, null, '{}', {}, new Uint8Array()]) {
    assert.throws(() => assertBackendManifestHasNoBuildPaths(value), safeError('MANIFEST_INVALID'));
  }
});

test('preserves canonical escaped strings and already serialized numbers', () => {
  const manifest = backendManifest();
  manifest.custom = { text: '"key": "value", { [ \\ \n', number: 1000000000000000100 };
  assert.doesNotThrow(() => assertBackendManifestHasNoBuildPaths(canonical(manifest)));
});

test('rejects unexpected workspace declarations during normalization only', async (t) => {
  const f = await fixture(t);
  f.deployed.dependencies.extra = 'workspace:*';
  await put(join(f.backendStage, 'package.json'), canonical(f.deployed));
  const before = await hashes(f.root);
  await assert.rejects(normalizeBackendBuildMetadata(f), safeError('UNKNOWN_TRANSFORM'));
  assert.deepEqual(await hashes(f.root), before);
  const manifest = backendManifest();
  manifest.dependencies.extra = 'workspace:*';
  assert.doesNotThrow(() => assertBackendManifestHasNoBuildPaths(canonical(manifest)));
});

for (const transform of ['wrongTarget', 'wrongName', 'suffix', 'missing', 'registryVersion']) {
  test(`rejects unknown workspace transformation ${transform} before deletions`, async (t) => {
    const f = await fixture(t);
    const original = f.deployed.dependencies['@eky/auth'];
    if (transform === 'wrongTarget') f.deployed.dependencies['@eky/auth'] = `${original}-sibling`;
    if (transform === 'wrongName') f.deployed.dependencies['@eky/auth'] = original.replace('@eky/auth@', '@eky/other@');
    if (transform === 'suffix') f.deployed.dependencies['@eky/auth'] = `${original}(peer@1.0.0)`;
    if (transform === 'missing') delete f.deployed.dependencies['@eky/auth'];
    if (transform === 'registryVersion') f.deployed.dependencies['@eky/auth'] = '0.0.0';
    await put(join(f.backendStage, 'package.json'), canonical(f.deployed));
    const before = await hashes(f.root);
    await assert.rejects(normalizeBackendBuildMetadata(f), safeError('UNKNOWN_TRANSFORM'));
    assert.deepEqual(await hashes(f.root), before);
  });
}

for (const index of [0, 1, 2]) {
  test(`rejects source manifest ${index} changed after capture`, async (t) => {
    const f = await fixture(t);
    await writeFile(f.sourceFiles[index][0], `${JSON.stringify(f.sourceFiles[index][1])}\n`);
    const before = await hashes(f.root);
    await assert.rejects(normalizeBackendBuildMetadata(f), safeError('SOURCE_CHANGED'));
    assert.deepEqual(await hashes(f.root), before);
  });
}

test('rejects forged snapshots and source roots used as mutation roots', async (t) => {
  const f = await fixture(t);
  const before = await hashes(f.root);
  await assert.rejects(normalizeBackendBuildMetadata({ ...f, source: {} }), safeError('SOURCE_INVALID'));
  await assert.rejects(normalizeBackendBuildMetadata({ ...f, backendStage: f.repositoryRoot }), safeError('STAGE_INVALID'));
  await assert.rejects(normalizeBackendBuildMetadata({ ...f, backendStage: join(f.repositoryRoot, 'apps/backend') }), safeError('STAGE_INVALID'));
  assert.deepEqual(await hashes(f.root), before);
});

for (const change of ['name', 'declaration', 'extraWorkspace', 'localDependency']) {
  test(`rejects invalid authoritative source ${change}`, async (t) => {
    const f = await fixture(t);
    const manifest = f.sourceFiles[0][1];
    if (change === 'name') manifest.name = 'wrong';
    if (change === 'declaration') manifest.dependencies['@eky/auth'] = 'workspace:^';
    if (change === 'extraWorkspace') manifest.dependencies.other = 'workspace:*';
    if (change === 'localDependency') manifest.dependencies.other = 'file:../other';
    await writeFile(f.sourceFiles[0][0], canonical(manifest));
    await assert.rejects(captureBackendBuildMetadataSource(f), safeError('SOURCE_INVALID'));
  });
}

async function makeSymlinkOrSkip(t, target, path, type) {
  try {
    await symlink(target, path, type);
    return true;
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Windows token lacks symbolic-link creation permission.');
      return false;
    }
    throw error;
  }
}

for (const path of ['package.json', ...BACKEND_BUILD_METADATA_PATHS]) {
  test(`rejects hardlinked mutation target ${path} with all other bytes untouched`, async (t) => {
    const f = await fixture(t);
    const target = join(f.backendStage, path);
    const sentinel = join(f.root, 'sentinel');
    await link(target, sentinel);
    const before = await hashes(f.root);
    await assert.rejects(normalizeBackendBuildMetadata(f), safeError('STAGE_INVALID'));
    assert.deepEqual(await hashes(f.root), before);
    assert.equal((await lstat(target)).nlink, 2);
  });
  test(`rejects symbolic mutation target ${path}`, async (t) => {
    const f = await fixture(t);
    const target = join(f.backendStage, path);
    const sentinel = join(f.root, 'sentinel');
    await rename(target, sentinel);
    if (!await makeSymlinkOrSkip(t, sentinel, target, 'file')) return;
    const before = await hashes(f.root);
    await assert.rejects(normalizeBackendBuildMetadata(f), safeError('STAGE_INVALID'));
    assert.deepEqual(await hashes(f.root), before);
    assert.equal((await lstat(target)).isSymbolicLink(), true);
  });
  test(`rejects directory mutation target ${path} before any write`, async (t) => {
    const f = await fixture(t);
    const target = join(f.backendStage, path);
    await rm(target);
    await mkdir(target);
    const before = await hashes(f.root);
    await assert.rejects(normalizeBackendBuildMetadata(f), safeError('STAGE_INVALID'));
    assert.deepEqual(await hashes(f.root), before);
  });
}

for (const location of ['stage', 'ancestor', 'node_modules']) {
  test(`rejects a junction at the ${location} boundary`, async (t) => {
    const f = await fixture(t);
    let backendStage = f.backendStage;
    if (location === 'ancestor') {
      const alias = join(f.root, 'alias');
      if (!await makeSymlinkOrSkip(t, f.root, alias, 'junction')) return;
      backendStage = join(alias, 'stage');
    } else {
      const target = location === 'stage' ? f.backendStage : join(f.backendStage, 'node_modules');
      const outside = join(f.root, 'outside');
      await rename(target, outside);
      if (!await makeSymlinkOrSkip(t, outside, target, 'junction')) return;
    }
    const before = await hashes(f.root);
    await assert.rejects(normalizeBackendBuildMetadata({ ...f, backendStage }), safeError('STAGE_INVALID'));
    assert.deepEqual(await hashes(f.root), before);
  });
}

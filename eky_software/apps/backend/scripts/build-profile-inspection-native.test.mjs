import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  createInspectionNativeBuildEnvironment,
  copyInspectionNativeBuildOutput,
  inspectionNativeCompilationFailure,
  patchInspectionMemoryAccounting,
  verifyInspectionSourceArchive,
} from './build-profile-inspection-native.mjs';
import { profileInspectionNativeContract as contract } from '../src/database/connection/profileInspectionNativeContract.ts';

test('a real tool timeout retains its closed code without granting settled log access', () => {
  const result = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
    timeout: 100, windowsHide: true, shell: false, stdio: 'ignore',
  });
  assert.equal(result.error?.code, 'ETIMEDOUT');
  const failure = inspectionNativeCompilationFailure(result);
  assert.equal(failure.code, 'ETIMEDOUT');
  assert.equal(failure.logSettled, false);
  assert.equal(failure.message, 'PROFILE_INSPECTION_NATIVE_BUILD_FAILED');
  assert.equal(failure.cause, undefined);
});

test('other tool failures cannot copy arbitrary error properties into compilation failure', () => {
  for (const code of ['private code', 'ENOENT', undefined]) {
    const failure = inspectionNativeCompilationFailure({ status: null, signal: null,
      error: { code, message: 'private detail', path: 'private path' } });
    assert.equal(failure.code, undefined);
    assert.equal(failure.logSettled, false);
    assert.deepEqual(Object.keys(failure), []);
  }
});

test('the only intended source delta is the one memory-accounting define', () => {
  const source = `before\n'${contract.sourceDefine}',\nafter\n`;
  const result = patchInspectionMemoryAccounting(source);
  assert.equal(result, source.replace(contract.sourceDefine, contract.targetDefine));
  for (const invalid of ['', contract.targetDefine, `${source}${source}`, `${source}${contract.targetDefine}`]) {
    assert.throws(() => patchInspectionMemoryAccounting(invalid), /^Error: PROFILE_INSPECTION_NATIVE_SOURCE_INVALID$/);
  }
});

test('archives must match their exact pinned SHA512 before extraction', () => {
  const bytes = Buffer.from('synthetic upstream archive');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.doesNotThrow(() => verifyInspectionSourceArchive(bytes, integrity));
  for (const corrupted of [Buffer.alloc(0), Buffer.from('changed bytes')]) {
    assert.throws(() => verifyInspectionSourceArchive(corrupted, integrity), /^Error: PROFILE_INSPECTION_NATIVE_SOURCE_INVALID$/);
  }
  assert.throws(() => verifyInspectionSourceArchive(bytes, 'unverified'), /^Error: PROFILE_INSPECTION_NATIVE_SOURCE_INVALID$/);
});

test('unrelated shell variables cannot override native source or compiler flags', () => {
  const environment = createInspectionNativeBuildEnvironment({
    PATH: 'existing tools', INCLUDE: 'existing SDK', HOME: 'build account',
    NODE_OPTIONS: '--require unreviewed.js', GYP_DEFINES: 'sqlite=external',
    CXXFLAGS: '-DSQLITE_DEFAULT_MEMSTATUS=0', npm_config_target: 'unapproved runtime',
    npm_config_node_gyp: 'unapproved tool', npm_config_ignore_scripts: 'false',
    SMTP_PASSWORD: 'unrelated secret', GYP_CONFIG_DIR: 'unapproved config',
    PYTHONPATH: 'unapproved import', PYTHONNOUSERSITE: '0',
  }, resolve('build-owned-empty-gyp-config'));
  assert.equal(environment[process.platform === 'win32' ? 'path' : 'PATH'], 'existing tools');
  assert.equal(environment.NODE_OPTIONS, '');
  assert.equal(environment.npm_config_ignore_scripts, 'true');
  assert.equal(environment.GYP_CONFIG_DIR, resolve('build-owned-empty-gyp-config'));
  assert.equal(environment.PYTHONNOUSERSITE, '1');
  assert.equal(environment.PYTHONSAFEPATH, '1');
  for (const name of ['GYP_DEFINES', 'CXXFLAGS', 'npm_config_target', 'npm_config_node_gyp', 'SMTP_PASSWORD', 'PYTHONPATH']) {
    assert.equal(Object.hasOwn(environment, name), false);
  }
});

test('the explicit source versions and integrities are those of the approved lock', async () => {
  const lock = await readFile(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8');
  // Exact pinned stanzas, not a permissive parser or resolution of arbitrary YAML.
  for (const [name, version, integrity] of [
    ['better-sqlite3', contract.packageVersion, contract.sourceIntegrity],
    ['node-addon-api', contract.addonApiVersion, contract.addonApiIntegrity],
  ]) {
    assert.ok(lock.includes(`  ${name}@${version}:\n    resolution: {integrity: ${integrity}}`));
  }
});

async function withBuildOutput(testContext) {
  const work = await mkdtemp(join(tmpdir(), 'eky-native-copy-'));
  testContext.after(() => rm(work, { recursive: true, force: true }));
  const built = join(work, 'source', 'build', 'Release', contract.fileName);
  const alias = join(dirname(built), 'obj.target', contract.fileName);
  await mkdir(dirname(alias), { recursive: true });
  const bytes = Buffer.alloc(contract.minimumNativeBytes, 0x42);
  await writeFile(built, bytes, { flag: 'wx' });
  return { work, built, alias, bytes };
}

test('a single compiler output becomes independent verified bytes', async context => {
  const { work, built, bytes } = await withBuildOutput(context);
  const copied = await copyInspectionNativeBuildOutput(work);
  assert.equal((await lstat(copied)).nlink, 1);
  assert.deepEqual(await readFile(copied), bytes);
  await writeFile(built, Buffer.alloc(bytes.length, 0x43));
  assert.deepEqual(await readFile(copied), bytes);
  await assert.rejects(copyInspectionNativeBuildOutput(work), /^Error: PROFILE_INSPECTION_NATIVE_BUILD_FAILED$/);
  assert.deepEqual(await readFile(copied), bytes);
});

test('the exact internal node-gyp alias pair is never shipped as a hardlink', async context => {
  const { work, built, alias, bytes } = await withBuildOutput(context);
  await link(built, alias);
  assert.equal((await lstat(built)).nlink, 2);
  const copied = await copyInspectionNativeBuildOutput(work);
  assert.equal((await lstat(copied)).nlink, 1);
  assert.equal((await lstat(built)).nlink, 2);
  await writeFile(alias, Buffer.alloc(bytes.length, 0x43));
  assert.deepEqual(await readFile(copied), bytes);
});

test('an unknown second compiler-output alias is rejected', async context => {
  const { work, built } = await withBuildOutput(context);
  await link(built, join(work, 'unapproved.node'));
  await assert.rejects(copyInspectionNativeBuildOutput(work), /^Error: PROFILE_INSPECTION_NATIVE_BUILD_FAILED$/);
  await assert.rejects(lstat(join(work, 'verified-native')), { code: 'ENOENT' });
});

test('an extra alias beyond the known node-gyp pair is rejected', async context => {
  const { work, built, alias } = await withBuildOutput(context);
  await link(built, alias);
  await link(built, join(work, 'unapproved.node'));
  await assert.rejects(copyInspectionNativeBuildOutput(work), /^Error: PROFILE_INSPECTION_NATIVE_BUILD_FAILED$/);
});

test('the named internal alias must have the same identity, not just the same bytes', async context => {
  const { work, built, alias } = await withBuildOutput(context);
  await link(built, join(work, 'unapproved.node'));
  await copyFile(built, alias);
  await assert.rejects(copyInspectionNativeBuildOutput(work), /^Error: PROFILE_INSPECTION_NATIVE_BUILD_FAILED$/);
});

test('a linked compiler output directory is rejected before copying', async context => {
  const { work, built, bytes } = await withBuildOutput(context);
  const substitute = join(work, 'substitute');
  await mkdir(substitute);
  await writeFile(join(substitute, contract.fileName), bytes);
  await rm(dirname(built), { recursive: true });
  await symlink(substitute, dirname(built), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(copyInspectionNativeBuildOutput(work), /^Error: PROFILE_INSPECTION_NATIVE_BUILD_FAILED$/);
});

for (const size of [0, contract.minimumNativeBytes - 1, contract.maximumNativeBytes + 1]) {
  test(`compiler output size ${size} remains outside the delivery contract`, async context => {
    const { work, built } = await withBuildOutput(context);
    await writeFile(built, Buffer.alloc(size));
    await assert.rejects(copyInspectionNativeBuildOutput(work), /^Error: PROFILE_INSPECTION_NATIVE_BUILD_FAILED$/);
  });
}

test('a relative compiler work root is rejected', async () => {
  await assert.rejects(copyInspectionNativeBuildOutput('relative-root'), /^Error: PROFILE_INSPECTION_NATIVE_BUILD_FAILED$/);
});

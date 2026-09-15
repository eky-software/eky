import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertWindowsApplicationCloseFixtureIdentity as verify,
  readWindowsApplicationCloseFixtureIdentity as readIdentity,
} from './windowsApplicationCloseFixtureIdentity.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eky gui identity '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runRoot = join(root, 'compiled');
  await mkdir(runRoot);
  const executable = join(runRoot, 'WindowContract.exe');
  // Inert independent bytes: never run or link the retained research executable.
  await writeFile(executable, 'synthetic-gui-fixture', { flag: 'wx' });
  return { root, runRoot, executable, baseline: await readIdentity(executable, runRoot) };
}

test('GUI fixture identity accepts unchanged independent bytes', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(verify(f.baseline, await readIdentity(f.executable, f.runRoot)), {
    samePath: true, sameFile: true, sameBytes: true, linkCount: 1,
  });
});

test('GUI fixture identity reports an additional link separately from unchanged identity', async (t) => {
  const f = await fixture(t);
  await link(f.executable, join(f.root, 'synthetic-analysis-link'));
  assert.deepEqual(verify(f.baseline, await readIdentity(f.executable, f.runRoot)), {
    samePath: true, sameFile: true, sameBytes: true, linkCount: 2,
  });
});

test('GUI fixture identity rejects changed bytes even when size and file id match', async (t) => {
  const f = await fixture(t);
  await writeFile(f.executable, 'synthetic-bad-fixture');
  const current = await readIdentity(f.executable, f.runRoot);
  assert.equal(current.size, f.baseline.size);
  assert.equal(current.fileId, f.baseline.fileId);
  assert.throws(() => verify(f.baseline, current), { message: 'nativeFixtureIdentityChanged' });
});

test('GUI fixture identity rejects replacement with identical bytes', async (t) => {
  const f = await fixture(t);
  await rename(f.executable, join(f.root, 'original-bytes'));
  await writeFile(f.executable, 'synthetic-gui-fixture', { flag: 'wx' });
  const current = await readIdentity(f.executable, f.runRoot);
  assert.equal(current.sha256, f.baseline.sha256);
  assert.notEqual(current.fileId, f.baseline.fileId);
  assert.throws(() => verify(f.baseline, current), { message: 'nativeFixtureIdentityChanged' });
});

test('GUI fixture identity rejects an alias at another canonical root', async (t) => {
  const f = await fixture(t);
  const otherRoot = join(f.root, 'other');
  await mkdir(otherRoot);
  const alias = join(otherRoot, 'WindowContract.exe');
  await link(f.executable, alias);
  const current = await readIdentity(alias, otherRoot);
  assert.equal(current.fileId, f.baseline.fileId);
  assert.throws(() => verify(f.baseline, current), { message: 'nativeFixtureIdentityChanged' });
  await assert.rejects(readIdentity(alias, f.runRoot), { message: 'nativeFixtureIdentityInvalid' });
});

test('GUI fixture identity rejects a linked root', async (t) => {
  const f = await fixture(t);
  const alias = join(f.root, 'linked-root');
  await symlink(f.runRoot, alias, 'junction');
  await assert.rejects(readIdentity(join(alias, 'WindowContract.exe'), alias), {
    message: 'nativeFixtureIdentityInvalid',
  });
});

test('GUI fixture identity rejects root replacement even when the leaf identity is unchanged', async (t) => {
  const f = await fixture(t);
  const previousRoot = join(f.root, 'previous-root');
  await rename(f.runRoot, previousRoot);
  await mkdir(f.runRoot);
  await link(join(previousRoot, 'WindowContract.exe'), f.executable);
  const current = await readIdentity(f.executable, f.runRoot);
  assert.equal(current.canonicalPath, f.baseline.canonicalPath);
  assert.equal(current.fileId, f.baseline.fileId);
  assert.notEqual(current.rootFileId, f.baseline.rootFileId);
  assert.throws(() => verify(f.baseline, current), { message: 'nativeFixtureIdentityChanged' });
});

test('GUI fixture identity rejects a directory link in place of the executable', async (t) => {
  const f = await fixture(t);
  await rename(f.executable, join(f.root, 'original-bytes'));
  const target = join(f.root, 'not-an-executable');
  await mkdir(target);
  await symlink(target, f.executable, 'junction');
  await assert.rejects(readIdentity(f.executable, f.runRoot), { message: 'nativeFixtureIdentityInvalid' });
});

test('GUI fixture identity reports a missing file without leaking its path', async (t) => {
  const f = await fixture(t);
  await rename(f.executable, join(f.root, 'original-bytes'));
  await assert.rejects(readIdentity(f.executable, f.runRoot), {
    message: 'nativeFixtureIdentityInvalid',
  });
});

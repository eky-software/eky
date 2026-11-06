import { chmod, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { profileInspectionCopyDirectoryName } from '../../runtime/profileInspectionMessages.js';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceInspectionRemnantAbsence, workspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { remnantBindingFixture as fixture } from './workspaceRemnantBindingTestSupport.js';

it('shares the exact runner copy name without accepting caller paths or malformed generations', () => {
  expect(profileInspectionCopyDirectoryName(id(3))).toBe(`profile-inspection-${id(3)}`);
  for (const value of ['../outside', '', null, {}, `${id(3)}/other`, 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA']) {
    expect(() => profileInspectionCopyDirectoryName(value)).toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
});

it('checks all four absent slots without creating missing ancestors or copying data', async context => {
  const f = await fixture(context, 'profileInspection');
  const paths = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding);
  expect(paths.map(path => path.scope)).toEqual(['workspace', 'workspace', 'replacement', 'replacement']);
  expect(new Set(paths.map(path => path.rootPath)).size).toBe(4);
  const proof = await captureWorkspaceInspectionRemnantAbsence(f.root, f.binding, f.authority);
  await proof.assertAbsent();
  expect(await readdir(f.root)).toEqual([]);
});

for (const index of [0, 1, 2, 3]) {
  for (const kind of ['directory', 'file'] as const) {
    it(`refuses a ${kind} at permitted slot ${index} and preserves it`, async context => {
      const f = await fixture(context, 'profileInspection');
      const path = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[index]!;
      await mkdir(path.parentPath, { recursive: true, mode: 0o700 });
      if (kind === 'directory') {
        await mkdir(path.rootPath, { mode: 0o700 });
        await writeFile(join(path.rootPath, 'retained'), 'synthetic-copy', { mode: 0o600 });
      } else await writeFile(path.rootPath, 'retained', { mode: 0o600 });
      await expect(captureWorkspaceInspectionRemnantAbsence(f.root, f.binding, f.authority)).rejects.toThrow();
      expect(await readFile(kind === 'directory' ? join(path.rootPath, 'retained') : path.rootPath, 'utf8'))
        .toBe(kind === 'directory' ? 'synthetic-copy' : 'retained');
    });
  }
  it(`rejects appearance at slot ${index} after the initial observation`, async context => {
    const f = await fixture(context, 'profileInspection');
    const path = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[index]!;
    await mkdir(path.parentPath, { recursive: true, mode: 0o700 });
    const proof = await captureWorkspaceInspectionRemnantAbsence(f.root, f.binding, f.authority);
    await mkdir(path.rootPath, { mode: 0o700 });
    await expect(proof.assertAbsent()).rejects.toThrow();
    expect(await readdir(path.rootPath)).toEqual([]);
  });
}

it('pins both existing ancestors and missing intermediate directories, with sticky failure', async context => {
  const f = await fixture(context, 'profileInspection');
  const path = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[0]!;
  await mkdir(path.parentPath, { recursive: true, mode: 0o700 });
  const proof = await captureWorkspaceInspectionRemnantAbsence(f.root, f.binding, f.authority);
  const retained = join(f.root, 'retained-parent');
  await rename(path.parentPath, retained);
  await mkdir(path.parentPath, { mode: 0o700 });
  await expect(proof.assertAbsent()).rejects.toThrow();
  await rm(path.parentPath, { recursive: true });
  await rename(retained, path.parentPath);
  await expect(proof.assertAbsent()).rejects.toThrow();
  const next = await captureWorkspaceInspectionRemnantAbsence(f.root, f.binding, f.authority);
  const shared = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[2]!;
  await mkdir(shared.parentPath, { recursive: true, mode: 0o700 });
  await expect(next.assertAbsent()).rejects.toThrow();
});

it.for(['authority', 'selection', 'readError'] as const)('preserves %s failure rather than interpreting it as absence', async (kind, context) => {
  const f = await fixture(context, 'profileInspection');
  const first = new Error('SYNTHETIC_ANCESTOR_READ');
  let reached = false;
  const work = captureWorkspaceInspectionRemnantAbsence(f.root, f.binding, f.authority, {
    ...workspaceInspectionRemnantReads,
    async directoryIdentity(...args) {
      const identity = await workspaceInspectionRemnantReads.directoryIdentity(...args);
      reached = true;
      if (kind === 'authority') f.expire();
      if (kind === 'selection') f.changeTarget();
      if (kind === 'readError') throw first;
      return identity;
    },
  });
  if (kind === 'readError') await expect(work).rejects.toBe(first);
  else await expect(work).rejects.toThrow();
  expect(reached).toBe(true);
  expect(await readdir(f.root)).toEqual([]);
});

it('joins an already pending identity read before reporting revoked authority', async context => {
  const f = await fixture(context, 'profileInspection');
  let entered!: () => void;
  let release!: () => void;
  const entering = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  const work = captureWorkspaceInspectionRemnantAbsence(f.root, f.binding, f.authority, {
    ...workspaceInspectionRemnantReads, async directoryIdentity(...args) {
      entered(); await pending;
      return workspaceInspectionRemnantReads.directoryIdentity(...args);
    },
  }).finally(() => { settled = true; });
  await entering;
  f.expire();
  expect(settled).toBe(false);
  release();
  await expect(work).rejects.toThrow('SYNTHETIC_LEASE_LOST');
  expect(settled).toBe(true);
});

it('refuses a linked ancestor and retains the linked data', async context => {
  const f = await fixture(context, 'profileInspection');
  const path = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[0]!;
  const redirected = join(f.root, 'retained-foreign-root');
  await mkdir(path.parentPath, { recursive: true, mode: 0o700 });
  await rename(path.parentPath, redirected);
  await writeFile(join(redirected, 'retained'), 'foreign-data', { mode: 0o600 });
  await symlink(redirected, path.parentPath, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(captureWorkspaceInspectionRemnantAbsence(f.root, f.binding, f.authority)).rejects.toThrow();
  expect(await readFile(join(redirected, 'retained'), 'utf8')).toBe('foreign-data');
});

it.skipIf(process.platform === 'win32')('refuses a non-private surviving ancestor', async context => {
  const f = await fixture(context, 'profileInspection');
  const path = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[0]!;
  await mkdir(path.parentPath, { recursive: true, mode: 0o700 });
  await chmod(path.parentPath, 0o755);
  await expect(captureWorkspaceInspectionRemnantAbsence(f.root, f.binding, f.authority)).rejects.toThrow();
});

it('does not mistake an absence-read permission error for an absent copy', async context => {
  const f = await fixture(context, 'profileInspection');
  const first = Object.assign(new Error('SYNTHETIC_UNREADABLE'), { code: 'EACCES' });
  await expect(captureWorkspaceInspectionRemnantAbsence(f.root, f.binding, f.authority, {
    ...workspaceInspectionRemnantReads, async assertAbsent() { throw first; },
  })).rejects.toBe(first);
  expect(await readdir(f.root)).toEqual([]);
});

it('rejects changed ancestry during the final leaf-absence await', async context => {
  const f = await fixture(context, 'profileInspection');
  const path = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[3]!;
  await mkdir(path.parentPath, { recursive: true, mode: 0o700 });
  let inject = false;
  let checks = 0;
  const proof = await captureWorkspaceInspectionRemnantAbsence(f.root, f.binding, f.authority, {
    ...workspaceInspectionRemnantReads, async assertAbsent(...args) {
      await workspaceInspectionRemnantReads.assertAbsent(...args);
      if (inject && args[0] === path.rootPath && ++checks === 2) {
        await rename(path.parentPath, join(f.root, 'retained-final-parent'));
        await mkdir(path.parentPath, { mode: 0o700 });
      }
    },
  });
  inject = true;
  await expect(proof.assertAbsent()).rejects.toThrow();
  expect(checks).toBe(2);
});

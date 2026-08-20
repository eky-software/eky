import { chmod, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertWorkspaceCandidateContainedPath,
  resolveAbsoluteWorkspaceCandidatePath,
  validatePrivateWorkspaceDirectory,
  validateTrustedReadOnlyCodeDirectory,
  workspaceCandidatePathsAreEqual,
} from './workspaceCandidatePathPolicy.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('workspaceCandidatePathPolicy', () => {
  it.skipIf(process.platform === 'win32')(
    'distinguishes private writable roots from trusted read-only code roots',
    async () => {
      const root = await createTempRoot();
      const privateDirectory = join(root, 'private');
      const codeDirectory = join(root, 'code');
      await mkdir(privateDirectory, { mode: 0o700 });
      await mkdir(codeDirectory, { mode: 0o755 });
      await chmod(privateDirectory, 0o700);
      await chmod(codeDirectory, 0o755);

      await expect(
        validatePrivateWorkspaceDirectory(privateDirectory),
      ).resolves.toBe(privateDirectory);
      await expect(
        validateTrustedReadOnlyCodeDirectory(codeDirectory),
      ).resolves.toBe(codeDirectory);

      await chmod(privateDirectory, 0o755);
      await expect(
        validatePrivateWorkspaceDirectory(privateDirectory),
      ).rejects.toThrow('WORKSPACE_CANDIDATE_PATH_INVALID');

      await chmod(codeDirectory, 0o775);
      await expect(
        validateTrustedReadOnlyCodeDirectory(codeDirectory),
      ).rejects.toThrow('WORKSPACE_CANDIDATE_PATH_INVALID');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects symbolic links for private and trusted code roots',
    async () => {
      const root = await createTempRoot();
      const privateTarget = join(root, 'private-target');
      const codeTarget = join(root, 'code-target');
      const privateLink = join(root, 'private-link');
      const codeLink = join(root, 'code-link');
      await mkdir(privateTarget, { mode: 0o700 });
      await mkdir(codeTarget, { mode: 0o755 });
      await symlink(privateTarget, privateLink, 'dir');
      await symlink(codeTarget, codeLink, 'dir');

      await expect(
        validatePrivateWorkspaceDirectory(privateLink),
      ).rejects.toThrow('WORKSPACE_CANDIDATE_PATH_INVALID');
      await expect(
        validateTrustedReadOnlyCodeDirectory(codeLink),
      ).rejects.toThrow('WORKSPACE_CANDIDATE_PATH_INVALID');
    },
  );

  it('rejects relative, NUL-containing and lexically non-canonical paths', () => {
    const canonical = resolve(tmpdir(), 'eky-path-policy');
    const nonCanonical = `${dirname(canonical)}${sep}intermediate${sep}..${sep}${basename(canonical)}`;

    expect(() => resolveAbsoluteWorkspaceCandidatePath('relative')).toThrow(
      'WORKSPACE_CANDIDATE_PATH_INVALID',
    );
    expect(() =>
      resolveAbsoluteWorkspaceCandidatePath(`${canonical}\0suffix`),
    ).toThrow('WORKSPACE_CANDIDATE_PATH_INVALID');
    expect(() => resolveAbsoluteWorkspaceCandidatePath(nonCanonical)).toThrow(
      'WORKSPACE_CANDIDATE_PATH_INVALID',
    );
    expect(resolveAbsoluteWorkspaceCandidatePath(`${canonical}${sep}`)).toBe(
      canonical,
    );
  });

  it('accepts only strict child containment', () => {
    const root = resolve(tmpdir(), 'eky-containment-root');

    expect(() =>
      assertWorkspaceCandidateContainedPath(root, join(root, 'child')),
    ).not.toThrow();
    expect(() => assertWorkspaceCandidateContainedPath(root, root)).toThrow(
      'WORKSPACE_CANDIDATE_PATH_INVALID',
    );
    expect(() =>
      assertWorkspaceCandidateContainedPath(root, dirname(root)),
    ).toThrow('WORKSPACE_CANDIDATE_PATH_INVALID');
    expect(() =>
      assertWorkspaceCandidateContainedPath(
        root,
        join(dirname(root), 'sibling'),
      ),
    ).toThrow('WORKSPACE_CANDIDATE_PATH_INVALID');
  });

  it('keeps platform path equality semantics explicit', () => {
    const mixedCase = resolve(tmpdir(), 'Eky-Path-Equality');
    const lowerCase = mixedCase.toLowerCase();

    expect(workspaceCandidatePathsAreEqual(mixedCase, mixedCase)).toBe(true);
    expect(workspaceCandidatePathsAreEqual(mixedCase, lowerCase)).toBe(
      process.platform === 'win32',
    );
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-candidate-path-policy-'));
  roots.push(root);
  return root;
}

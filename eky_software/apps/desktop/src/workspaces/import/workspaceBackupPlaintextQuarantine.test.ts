import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { maximumBackupCiphertextBytes } from '../../profileBackup/container/backupContainerLimits.js';
import { WorkspaceBackupPlaintextQuarantine } from './workspaceBackupPlaintextQuarantine.js';

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('WorkspaceBackupPlaintextQuarantine', () => {
  it('removes partial and complete stale payloads without a journal and is idempotent', async () => {
    const fixture = await createFixture();
    const partialPath = await fixture.quarantine.createPayloadPath();
    const completePath = await fixture.quarantine.createPayloadPath();
    await writePrivateFile(partialPath, 'partial plaintext');
    await writePrivateFile(completePath, 'complete synthetic payload');

    await expect(fixture.quarantine.recoverStalePayloads()).resolves.toBeUndefined();
    await expect(readdir(fixture.quarantineRoot)).resolves.toEqual([]);
    await expect(fixture.quarantine.recoverStalePayloads()).resolves.toBeUndefined();
    await expect(readdir(fixture.quarantineRoot)).resolves.toEqual([]);
  });

  it('fails closed on an unknown entry and preserves every entry', async () => {
    const fixture = await createFixture();
    const payloadPath = await fixture.quarantine.createPayloadPath();
    const unknownPath = join(fixture.quarantineRoot, 'unknown.txt');
    await writePrivateFile(payloadPath, 'known plaintext');
    await writePrivateFile(unknownPath, 'unrelated content');

    await expectRecoveryRequired(fixture.quarantine.recoverStalePayloads(), [
      unknownPath,
      'unrelated content',
    ]);
    await expect(readFile(payloadPath, 'utf8')).resolves.toBe('known plaintext');
    await expect(readFile(unknownPath, 'utf8')).resolves.toBe(
      'unrelated content',
    );
  });

  it('rejects a directory masquerading as an allowlisted payload', async () => {
    const fixture = await createFixture();
    const payloadPath = await fixture.quarantine.createPayloadPath();
    await mkdir(payloadPath, { mode: 0o700 });

    await expectRecoveryRequired(fixture.quarantine.recoverStalePayloads(), [
      payloadPath,
    ]);
    await expect(readdir(fixture.quarantineRoot)).resolves.toHaveLength(1);
  });

  it('rejects symlinked and hard-linked payloads without touching their targets', async () => {
    const symlinkFixture = await createFixture();
    const symlinkPayload = await symlinkFixture.quarantine.createPayloadPath();
    const symlinkTarget = join(symlinkFixture.root, 'outside-symlink.txt');
    await writePrivateFile(symlinkTarget, 'outside symlink content');
    await symlink(symlinkTarget, symlinkPayload, 'file');

    await expectRecoveryRequired(
      symlinkFixture.quarantine.recoverStalePayloads(),
      [symlinkTarget, 'outside symlink content'],
    );
    await expect(readFile(symlinkTarget, 'utf8')).resolves.toBe(
      'outside symlink content',
    );

    const hardLinkFixture = await createFixture();
    const hardLinkPayload = await hardLinkFixture.quarantine.createPayloadPath();
    const hardLinkTarget = join(hardLinkFixture.root, 'outside-hardlink.txt');
    await writePrivateFile(hardLinkTarget, 'outside hardlink content');
    await link(hardLinkTarget, hardLinkPayload);

    await expectRecoveryRequired(
      hardLinkFixture.quarantine.recoverStalePayloads(),
      [hardLinkTarget, 'outside hardlink content'],
    );
    await expect(readFile(hardLinkTarget, 'utf8')).resolves.toBe(
      'outside hardlink content',
    );
  });

  it('rejects a symlinked quarantine root without reading or deleting its target', async () => {
    const root = await createPrivateRoot();
    const operationsRoot = join(root, 'workspace-operations');
    const quarantineRoot = join(
      operationsRoot,
      'workspace-import-plaintext-quarantine',
    );
    const outsideRoot = join(root, 'outside-quarantine');
    await mkdir(operationsRoot, { mode: 0o700 });
    await mkdir(outsideRoot, { mode: 0o700 });
    const outsideFile = join(outsideRoot, 'outside-secret.txt');
    await writePrivateFile(outsideFile, 'outside secret');
    await symlink(
      outsideRoot,
      quarantineRoot,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const quarantine = new WorkspaceBackupPlaintextQuarantine({
      userDataRoot: root,
    });

    await expectRecoveryRequired(quarantine.recoverStalePayloads(), [
      outsideRoot,
      outsideFile,
      'outside secret',
    ]);
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside secret');
  });

  it('rejects an oversized allowlisted payload before deletion', async () => {
    const fixture = await createFixture();
    const payloadPath = await fixture.quarantine.createPayloadPath();
    await writePrivateFile(payloadPath, 'x');
    await truncate(payloadPath, Number(maximumBackupCiphertextBytes + 1n));

    await expectRecoveryRequired(fixture.quarantine.recoverStalePayloads(), [
      payloadPath,
    ]);
  });

  it('refuses an outside removal path and leaves the outside file untouched', async () => {
    const fixture = await createFixture();
    const outsidePath = join(fixture.root, 'outside.payload');
    await writePrivateFile(outsidePath, 'outside content');

    await expectRecoveryRequired(
      fixture.quarantine.removePayload(outsidePath),
      [outsidePath, 'outside content'],
    );
    await expect(readFile(outsidePath, 'utf8')).resolves.toBe(
      'outside content',
    );
  });
});

async function createFixture() {
  const root = await createPrivateRoot();
  return {
    quarantine: new WorkspaceBackupPlaintextQuarantine({
      userDataRoot: root,
    }),
    quarantineRoot: join(
      root,
      'workspace-operations',
      'workspace-import-plaintext-quarantine',
    ),
    root,
  };
}

async function createPrivateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-import-quarantine-'));
  cleanupRoots.push(root);
  if (process.platform !== 'win32') await chmod(root, 0o700);
  return root;
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, { flag: 'wx', mode: 0o600 });
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

async function expectRecoveryRequired(
  operation: Promise<unknown>,
  forbiddenValues: readonly string[],
): Promise<void> {
  try {
    await operation;
    throw new Error('Expected operation to fail');
  } catch (error) {
    expect(error).toMatchObject({
      code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      stage: 'plaintextQuarantine',
    });
    for (const forbiddenValue of forbiddenValues) {
      expect(String(error)).not.toContain(forbiddenValue);
      expect(JSON.stringify(error)).not.toContain(forbiddenValue);
    }
  }
}

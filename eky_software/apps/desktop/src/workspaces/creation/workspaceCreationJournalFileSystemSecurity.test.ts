import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WORKSPACE_CREATION_JOURNAL_MAX_BYTES } from './workspaceCreationJournalBytes.js';
import {
  WORKSPACE_CREATION_JOURNAL_INVALID,
  WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
} from './workspaceCreationJournalError.js';
import {
  WORKSPACE_CREATION_JOURNAL_FILE_NAME,
  WORKSPACE_CREATION_JOURNAL_NEXT_FILE_NAME,
} from './workspaceCreationJournalPaths.js';
import { serializeWorkspaceCreationJournal } from './workspaceCreationJournalSerializer.js';
import { WorkspaceCreationJournalStore } from './workspaceCreationJournalStore.js';
import type { WorkspaceCreationJournalV1 } from './workspaceCreationTypes.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('workspace creation journal path boundaries', () => {
  it('accepts only the exact journal path inside its installation root', async () => {
    const root = await createPrivateRoot();
    const installationRoot = join(root, 'workspace-operations');

    expect(() => new WorkspaceCreationJournalStore({
      installationRoot,
      filePath: join(root, 'outside', WORKSPACE_CREATION_JOURNAL_FILE_NAME),
    })).toThrow(WORKSPACE_CREATION_JOURNAL_UNAVAILABLE);
    expect(() => new WorkspaceCreationJournalStore({
      installationRoot,
      filePath: join(installationRoot, 'workspace-creation-journal-v2.json'),
    })).toThrow(WORKSPACE_CREATION_JOURNAL_UNAVAILABLE);
    expect(() => new WorkspaceCreationJournalStore({
      installationRoot: 'relative-root',
      filePath: `relative-root/${WORKSPACE_CREATION_JOURNAL_FILE_NAME}`,
    })).toThrow(WORKSPACE_CREATION_JOURNAL_UNAVAILABLE);
  });

  it('does not expose an outside path through constructor errors', async () => {
    const root = await createPrivateRoot();
    const sensitivePath = join(
      root,
      'customer-name',
      WORKSPACE_CREATION_JOURNAL_FILE_NAME,
    );

    try {
      new WorkspaceCreationJournalStore({
        installationRoot: join(root, 'workspace-operations'),
        filePath: sensitivePath,
      });
      throw new Error('Expected constructor to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
      );
      expect(String(error)).not.toContain(sensitivePath);
      expect(String(error)).not.toContain('customer-name');
    }
  });
});

describe('workspace creation journal filesystem boundaries', () => {
  it('rejects a file in place of the journal directory', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.installationRoot, 'not-a-directory');
    await expect(fixture.store.read()).rejects.toThrow(
      WORKSPACE_CREATION_JOURNAL_INVALID,
    );
  });

  it('rejects a symlinked journal directory without reading its target', async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, 'outside-directory');
    await mkdir(target, { mode: 0o700 });
    await writeFile(
      join(target, WORKSPACE_CREATION_JOURNAL_FILE_NAME),
      'outside-secret',
    );
    await symlink(target, fixture.installationRoot, 'dir');

    await expect(fixture.store.read()).rejects.toThrow(
      WORKSPACE_CREATION_JOURNAL_INVALID,
    );
    await expect(readFile(
      join(target, WORKSPACE_CREATION_JOURNAL_FILE_NAME),
      'utf8',
    )).resolves.toBe('outside-secret');
  });

  it('rejects symlinked and hard-linked current slots', async () => {
    const symlinkFixture = await createFixture();
    const outsideSymlink = join(symlinkFixture.root, 'outside-journal.json');
    await mkdir(symlinkFixture.installationRoot, { mode: 0o700 });
    await writeFile(outsideSymlink, 'outside-secret', { mode: 0o600 });
    await symlink(outsideSymlink, symlinkFixture.currentPath, 'file');
    await expectSafeInvalidFailure(symlinkFixture.store.read(), [
      outsideSymlink,
      'outside-secret',
    ]);

    const hardLinkFixture = await createFixture();
    const outsideHardLink = join(hardLinkFixture.root, 'outside-valid.json');
    await mkdir(hardLinkFixture.installationRoot, { mode: 0o700 });
    await writeFile(
      outsideHardLink,
      serializeWorkspaceCreationJournal(createPreparedJournal()),
      { mode: 0o600 },
    );
    await link(outsideHardLink, hardLinkFixture.currentPath);
    await expect(hardLinkFixture.store.read()).rejects.toThrow(
      WORKSPACE_CREATION_JOURNAL_INVALID,
    );
  });

  it('rejects oversized and non-file current slots before parsing', async () => {
    const oversizedFixture = await createFixture();
    await mkdir(oversizedFixture.installationRoot, { mode: 0o700 });
    await writeFile(
      oversizedFixture.currentPath,
      Buffer.alloc(WORKSPACE_CREATION_JOURNAL_MAX_BYTES + 1, 0x61),
      { mode: 0o600 },
    );
    await expect(oversizedFixture.store.read()).rejects.toThrow(
      WORKSPACE_CREATION_JOURNAL_INVALID,
    );

    const directoryFixture = await createFixture();
    await mkdir(directoryFixture.currentPath, { mode: 0o700, recursive: true });
    await expect(directoryFixture.store.read()).rejects.toThrow(
      WORKSPACE_CREATION_JOURNAL_INVALID,
    );
  });

  it('fails closed when stale next is a symlink and preserves its target', async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, 'outside-next.json');
    await mkdir(fixture.installationRoot, { mode: 0o700 });
    await writeFile(
      fixture.currentPath,
      serializeWorkspaceCreationJournal(createPreparedJournal()),
      { mode: 0o600 },
    );
    await writeFile(target, 'outside-next-content', { mode: 0o600 });
    await symlink(
      target,
      join(fixture.installationRoot, WORKSPACE_CREATION_JOURNAL_NEXT_FILE_NAME),
    );

    await expectSafeInvalidFailure(fixture.store.read(), [
      target,
      'outside-next-content',
    ]);
    await expect(readFile(target, 'utf8')).resolves.toBe(
      'outside-next-content',
    );
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a journal directory with access for other users',
    async () => {
      const fixture = await createFixture();
      await mkdir(fixture.installationRoot, { mode: 0o700 });
      await writeFile(
        fixture.currentPath,
        serializeWorkspaceCreationJournal(createPreparedJournal()),
        { mode: 0o600 },
      );
      await chmod(fixture.installationRoot, 0o755);
      await expect(fixture.store.read()).rejects.toThrow(
        WORKSPACE_CREATION_JOURNAL_INVALID,
      );
    },
  );
});

async function createPrivateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-journal-security-'));
  roots.push(root);
  return root;
}

async function createFixture() {
  const root = await createPrivateRoot();
  const installationRoot = join(root, 'workspace-operations');
  const currentPath = join(
    installationRoot,
    WORKSPACE_CREATION_JOURNAL_FILE_NAME,
  );
  return {
    currentPath,
    installationRoot,
    root,
    store: new WorkspaceCreationJournalStore({
      installationRoot,
      filePath: currentPath,
    }),
  };
}

async function expectSafeInvalidFailure(
  operation: Promise<unknown>,
  forbiddenValues: readonly string[],
): Promise<void> {
  try {
    await operation;
    throw new Error('Expected operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(WORKSPACE_CREATION_JOURNAL_INVALID);
    for (const forbiddenValue of forbiddenValues) {
      expect(String(error)).not.toContain(forbiddenValue);
    }
  }
}

function createPreparedJournal(): Readonly<WorkspaceCreationJournalV1> {
  return {
    formatVersion: 1,
    operationId:
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as WorkspaceCreationJournalV1['operationId'],
    workspaceId:
      '11111111-1111-4111-8111-111111111111' as WorkspaceCreationJournalV1['workspaceId'],
    workspaceLabel: 'Oma yritys',
    previousActiveWorkspaceId: null,
    state: 'prepared',
    createdAt: '2026-08-18T10:00:00.000Z',
    lineageIdentity: null,
  };
}

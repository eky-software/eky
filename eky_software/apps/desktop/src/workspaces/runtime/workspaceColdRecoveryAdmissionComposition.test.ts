import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProfileSnapshotRuntimePaths } from '../../profileBackup/profileSnapshotRuntimePaths.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { createLocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { createWorkspaceLegacyAdoptionJournalPaths } from '../adoption/workspaceLegacyAdoptionJournal.js';
import {
  createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME,
} from '../creation/workspaceCreationJournalPaths.js';
import {
  createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME,
} from '../import/workspaceBackupImportJournalPaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import {
  createWorkspaceRegistryPaths, WORKSPACE_REGISTRY_FILE_NAME,
} from '../registry/workspaceRegistryPaths.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { createWorkspaceSwitchJournalPaths } from '../switch/workspaceSwitchJournal.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from '../update/workspaceFirstStartMigrationJournalPaths.js';
import {
  assertColdWorkspaceRecoveryAdmissionFromRoot,
  readColdWorkspaceRecoveryAdmissionFromRoot,
} from './workspaceColdRecoveryAdmissionComposition.js';
import * as admission from './workspaceColdRecoveryAdmission.js';

const roots: string[] = [];
const target = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const previous = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
const passive = validateWorkspaceId('33333333-3333-4333-8333-333333333333');
const slots = ['currentPath', 'backupPath', 'nextPath'] as const;
const required = 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED';

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-cold-admission-composition-'));
  roots.push(root);
  const creation = createWorkspaceCreationJournalPaths(
    root, join(root, WORKSPACE_CREATION_JOURNAL_FILE_NAME),
  );
  const importBackup = createWorkspaceBackupImportJournalPaths(
    root, join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME),
  );
  const registry = createWorkspaceRegistryPaths(root, join(root, WORKSPACE_REGISTRY_FILE_NAME));
  return {
    root, creation, importBackup, registry,
    read: () => readColdWorkspaceRecoveryAdmissionFromRoot(root),
  };
}

function journal(previousActiveWorkspaceId: string | null = previous) {
  return {
    formatVersion: 2,
    operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    workspaceId: target,
    workspaceLabel: 'Synthetic target',
    previousActiveWorkspaceId,
    state: 'prepared',
    createdAt: '2026-08-18T10:00:00.000Z',
    lineageIdentity: null,
  };
}

function registryValue(passiveState: 'ready' | 'recoveryRequired' = 'ready') {
  return {
    formatVersion: 1,
    activeWorkspaceId: previous,
    workspaces: [previous, passive].map((workspaceId, index) => ({
      workspaceId,
      workspaceLabel: 'Synthetic workspace',
      lineageIdentity: { formatVersion: 1, profileId: String(index + 1).repeat(64) },
      layoutVersion: 1,
      lifecycleState: index === 0 ? 'ready' : passiveState,
      createdAt: '2026-08-18T10:00:00.000Z',
    })),
  };
}

async function put(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
}

describe.each(['creation', 'import'] as const)('cold %s admission assertion', (owner) => {
  it.each(['unchanged', 'removed', 'replaced', 'conflicting'] as const)(
    'rechecks the real owner after the earlier selection: %s', async (change) => {
      const fixture = await createFixture();
      const own = owner === 'creation' ? fixture.creation : fixture.importBackup;
      const other = owner === 'creation' ? fixture.importBackup : fixture.creation;
      await put(own.currentPath, journal());
      await expect(fixture.read()).resolves.toBe(owner);
      if (change === 'removed' || change === 'replaced') await rm(own.currentPath);
      if (change === 'replaced' || change === 'conflicting') await put(other.currentPath, journal());
      const before = await snapshot(fixture.root);
      const result = assertColdWorkspaceRecoveryAdmissionFromRoot(fixture.root, owner);
      if (change === 'unchanged') await expect(result).resolves.toBeUndefined();
      else await expect(result).rejects.toThrow(required);
      expect(await snapshot(fixture.root)).toEqual(before);
    },
  );
});

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const key = join(relative, entry.name);
      if (entry.isDirectory()) {
        result[key] = 'directory';
        await visit(key);
      } else {
        result[key] = (await readFile(join(root, key))).toString('base64');
      }
    }
  }
  await visit('');
  return result;
}

function restoreJournal(root: string, id?: typeof target): string {
  const profile = id === undefined ? root : deriveWorkspaceRoot(root, id, 1).workspaceRoot;
  return createProfileSnapshotRuntimePaths(createDesktopProfilePaths(profile).runtimeRoot)
    .restoreActivationJournalPath;
}

describe('cold recovery admission composed from the main-owned root', () => {
  it('does not create missing roots or inspect unrelated recovery without an owner', async () => {
    const fixture = await createFixture();
    await put(fixture.registry.currentPath, 'invalid registry left for its owner');
    await put(createWorkspaceFirstStartMigrationJournalPaths(fixture.root).nextPath, 'pending');
    const before = await snapshot(fixture.root);
    await expect(fixture.read()).resolves.toBe('none');
    await expect(readColdWorkspaceRecoveryAdmissionFromRoot(join(fixture.root, 'missing', 'nested')))
      .resolves.toBe('none');
    expect(await snapshot(fixture.root)).toEqual(before);
  });

  it('rejects both operation owners before parsing or repairing them', async () => {
    const fixture = await createFixture();
    await put(fixture.creation.nextPath, 'creation');
    await put(fixture.importBackup.backupPath, 'import');
    const before = await snapshot(fixture.root);
    await expect(fixture.read()).rejects.toThrow(required);
    expect(await snapshot(fixture.root)).toEqual(before);
  });

  it.each(['relative-root', 'invalid\0root'])('rejects an invalid main root', async (root) => {
    await expect(readColdWorkspaceRecoveryAdmissionFromRoot(root)).rejects.toThrow(required);
  });

  describe.each(['creation', 'import'] as const)('%s owner', (kind) => {
    async function ownedFixture() {
      const fixture = await createFixture();
      const own = kind === 'creation' ? fixture.creation : fixture.importBackup;
      return { ...fixture, own };
    }

    it.each(slots)('rejects legacy %s before repair or plaintext removal', async (slot) => {
      const fixture = await ownedFixture();
      await put(fixture.own[slot], { ...journal(), formatVersion: 1 });
      await put(join(fixture.root, 'synthetic-plaintext', 'payload'), 'preserve');
      await put(fixture.registry.backupPath, registryValue());
      const before = await snapshot(fixture.root);
      await expect(fixture.read()).rejects.toThrow(required);
      expect(await snapshot(fixture.root)).toEqual(before);
    });

    it.each(slots)('inspects %s without promoting or deleting any slot', async (slot) => {
      const fixture = await ownedFixture();
      await put(fixture.own[slot], journal());
      await put(fixture.registry.currentPath, registryValue());
      const before = await snapshot(fixture.root);
      await expect(fixture.read()).resolves.toBe(kind);
      expect(await snapshot(fixture.root)).toEqual(before);
    });

    it('allows no registry and a null previous ID without granting recovery permission', async () => {
      const fixture = await ownedFixture();
      await put(fixture.own.currentPath, journal(null));
      const before = await snapshot(fixture.root);
      await expect(fixture.read()).resolves.toBe(kind);
      expect(await snapshot(fixture.root)).toEqual(before);
    });

    it.each(['removed', 'replacedByOtherOwner'] as const)(
      'rejects an owner $changed before the final probe without changing the new state', async (changed) => {
        const fixture = await ownedFixture();
        await put(fixture.own.currentPath, journal());
        const actualRead = admission.readWorkspaceColdRecoveryAdmission;
        let changedState: Record<string, string> | undefined;
        vi.spyOn(admission, 'readWorkspaceColdRecoveryAdmission').mockImplementationOnce(async (options) => {
          await rm(fixture.own.currentPath);
          if (changed === 'replacedByOtherOwner') {
            const other = kind === 'creation' ? fixture.importBackup : fixture.creation;
            await put(other.currentPath, journal());
          }
          changedState = await snapshot(fixture.root);
          return actualRead(options);
        });
        await expect(fixture.read()).rejects.toThrow(required);
        expect(changedState).toBeDefined();
        expect(await snapshot(fixture.root)).toEqual(changedState);
      },
    );

    it.each(['currentPath', 'backupPath'] as const)(
      'ignores empty superseded next after valid %s for both owner and registry', async (slot) => {
        const fixture = await ownedFixture();
        await put(fixture.own[slot], journal());
        await put(fixture.own.nextPath, '');
        await put(fixture.registry[slot], registryValue());
        await put(fixture.registry.nextPath, '');
        const before = await snapshot(fixture.root);
        await expect(fixture.read()).resolves.toBe(kind);
        expect(await snapshot(fixture.root)).toEqual(before);
      },
    );

    it.each(['owner', 'registry'] as const)(
      'blocks an invalid authoritative %s instead of choosing its valid backup', async (source) => {
        const fixture = await ownedFixture();
        await put(fixture.own.currentPath, journal());
        const paths = source === 'owner' ? fixture.own : fixture.registry;
        await put(paths.currentPath, '{');
        await put(paths.backupPath, source === 'owner' ? journal() : registryValue());
        const before = await snapshot(fixture.root);
        await expect(fixture.read()).rejects.toThrow(required);
        expect(await snapshot(fixture.root)).toEqual(before);
      },
    );

    it('blocks an unsafe operation workspace ID before path composition', async () => {
      const fixture = await ownedFixture();
      await put(fixture.own.currentPath, { ...journal(), workspaceId: '../outside' });
      const before = await snapshot(fixture.root);
      await expect(fixture.read()).rejects.toThrow(required);
      expect(await snapshot(fixture.root)).toEqual(before);
    });

    const profileCases = [
      { name: 'legacy', id: undefined },
      { name: 'unpublished operation target', id: target },
      { name: 'previous absent from registry', id: previous },
      { name: 'passive ready', id: passive },
      { name: 'passive recoveryRequired', id: passive },
    ];
    it.each(profileCases.flatMap((profile) => slots.map((slot) => ({ ...profile, slot }))))(
      'finds $name profile restore $slot through canonical paths', async ({ name, id, slot }) => {
        const fixture = await ownedFixture();
        await put(fixture.own.currentPath, journal());
        if (name !== 'previous absent from registry') {
          await put(fixture.registry.currentPath, registryValue(
            name === 'passive recoveryRequired' ? 'recoveryRequired' : 'ready',
          ));
        }
        const suffix = slot === 'currentPath' ? '' : slot === 'nextPath' ? '.next' : '.backup';
        await put(restoreJournal(fixture.root, id) + suffix, 'pending restore');
        const before = await snapshot(fixture.root);
        await expect(fixture.read()).rejects.toThrow(required);
        expect(await snapshot(fixture.root)).toEqual(before);
      },
    );

    it.each(['adoption', 'switch', 'firstStart', 'replacement', 'update', 'legacyUpdate', 'setup'] as const)(
      'finds the canonical %s conflict and leaves every file unchanged', async (other) => {
        const fixture = await ownedFixture();
        await put(fixture.own.currentPath, journal());
        const update = createLocalUpdateRuntimePaths({
          userDataPath: fixture.root,
          legacyRuntimeRoot: createDesktopProfilePaths(fixture.root).runtimeRoot,
        });
        const paths = {
          adoption: createWorkspaceLegacyAdoptionJournalPaths(fixture.root).nextPath,
          switch: createWorkspaceSwitchJournalPaths(fixture.root).backupPath,
          firstStart: createWorkspaceFirstStartMigrationJournalPaths(fixture.root).currentPath,
          replacement: deriveWorkspaceBackupReplacementRuntimePaths(fixture.root, target).activationJournalPath,
          update: update.journalPath,
          legacyUpdate: update.legacyJournalPath,
          setup: update.directSetupMigrationRecoveryPath,
        };
        await put(paths[other], 'unresolved');
        const before = await snapshot(fixture.root);
        await expect(fixture.read()).rejects.toThrow(required);
        expect(await snapshot(fixture.root)).toEqual(before);
      },
    );

    it('selects backup before next when enumerating passive registry profiles', async () => {
      const fixture = await ownedFixture();
      await put(fixture.own.currentPath, journal());
      await put(fixture.registry.backupPath, registryValue());
      await put(fixture.registry.nextPath, { formatVersion: 1, activeWorkspaceId: null, workspaces: [] });
      await put(restoreJournal(fixture.root, passive), 'pending');
      const before = await snapshot(fixture.root);
      await expect(fixture.read()).rejects.toThrow(required);
      expect(await snapshot(fixture.root)).toEqual(before);
    });

    it('reads a sole next registry without promoting it', async () => {
      const fixture = await ownedFixture();
      await put(fixture.own.currentPath, journal());
      await put(fixture.registry.nextPath, registryValue());
      await put(restoreJournal(fixture.root, passive), 'pending');
      const before = await snapshot(fixture.root);
      await expect(fixture.read()).rejects.toThrow(required);
      expect(await snapshot(fixture.root)).toEqual(before);
    });

    it('rejects a linked passive profile parent rather than treating it as absent', async () => {
      const fixture = await ownedFixture();
      const outside = await createFixture();
      await put(fixture.own.currentPath, journal());
      await put(fixture.registry.currentPath, registryValue());
      const workspaceRoot = deriveWorkspaceRoot(fixture.root, passive, 1).workspaceRoot;
      await mkdir(dirname(workspaceRoot), { recursive: true, mode: 0o700 });
      await symlink(outside.root, workspaceRoot, 'junction');
      await expect(fixture.read()).rejects.toThrow(required);
      expect(await readdir(outside.root)).toEqual([]);
      expect(JSON.parse(await readFile(fixture.own.currentPath, 'utf8'))).toEqual(journal());
    });
  });
});

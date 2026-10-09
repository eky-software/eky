import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createDirectSetupMigrationRecovery,
  transitionDirectSetupMigrationRecovery,
} from '../../update/directSetupMigrationRecovery.js';
import type { UpdateJournal } from '../../update/updateJournal.js';
import { maximumUpdateJournalBytes } from '../../update/updateJournalStore.js';
import { createReadOnlyJournalSlotPaths } from '../management/mainOwnedWorkspaceManagementOperationGuard.js';
import {
  readWorkspaceColdRecoveryAdmission,
  type WorkspaceColdRecoveryAdmissionOptions,
} from './workspaceColdRecoveryAdmission.js';

const roots: string[] = [];
const slotNames = ['currentPath', 'nextPath', 'backupPath'] as const;
const recoveryRequired = 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED';

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-cold-admission-'));
  roots.push(root);
  const slots = (name: string) => createReadOnlyJournalSlotPaths(join(root, name));
  const options: WorkspaceColdRecoveryAdmissionOptions = {
    adoptionJournal: slots('adoption.json'),
    creationJournal: slots('creation.json'),
    directSetupRecovery: slots('setup.json'),
    firstStartMigrationJournal: slots('first-start.json'),
    importJournal: slots('import.json'),
    legacyUpdateJournal: slots('legacy-update.json'),
    profileRestoreJournals: [slots('legacy-profile.json'), slots('active-profile.json'), slots('passive-profile.json')],
    replacementJournal: slots('replacement.json'),
    switchJournal: slots('switch.json'),
    updateJournal: slots('update.json'),
  };
  return { root, options, read: () => readWorkspaceColdRecoveryAdmission(options) };
}

describe('cold workspace recovery admission', () => {
  it('leaves other startup recovery owners alone when there is no create or import slot', async () => {
    const { options, read } = await createFixture();
    await writeFile(options.firstStartMigrationJournal.nextPath, 'other recovery');
    await writeFile(options.updateJournal.currentPath, 'not-json');
    await expect(read()).resolves.toBe('none');
    expect(await readFile(options.firstStartMigrationJournal.nextPath, 'utf8')).toBe('other recovery');
    expect(await readFile(options.updateJournal.currentPath, 'utf8')).toBe('not-json');
  });

  describe.each(['creation', 'import'] as const)('%s', (kind) => {
    const ownKey = kind === 'creation' ? 'creationJournal' : 'importJournal';
    const otherKey = kind === 'creation' ? 'importJournal' : 'creationJournal';

    it.each(slotNames)('selects only the owner of %s without repairing or parsing its journal', async (slot) => {
      const { options, read } = await createFixture();
      await writeFile(options[ownKey][slot], 'owner validates these bytes');
      await expect(read()).resolves.toBe(kind);
      expect(await readFile(options[ownKey][slot], 'utf8')).toBe('owner validates these bytes');
      for (const absent of slotNames.filter((name) => name !== slot)) {
        await expect(readFile(options[ownKey][absent])).rejects.toMatchObject({ code: 'ENOENT' });
      }
    });

    it.each(slotNames)('does not hide an unreadable owner path as absent (%s)', async (slot) => {
      const { root, options } = await createFixture();
      const notDirectory = join(root, 'not-a-directory');
      await writeFile(notDirectory, 'retained');
      const blocked = { ...options[ownKey], [slot]: join(notDirectory, 'journal.json') };
      await expect(readWorkspaceColdRecoveryAdmission({ ...options, [ownKey]: blocked }))
        .rejects.toThrow(recoveryRequired);
    });

    it.each(slotNames.flatMap((own) => slotNames.map((other) => ({ own, other }))))(
      'rejects both owners at $own / $other and preserves both', async ({ own, other }) => {
        const { options, read } = await createFixture();
        await writeFile(options[ownKey][own], 'first operation');
        await writeFile(options[otherKey][other], 'competing operation');
        await expect(read()).rejects.toThrow(recoveryRequired);
        expect(await readFile(options[ownKey][own], 'utf8')).toBe('first operation');
        expect(await readFile(options[otherKey][other], 'utf8')).toBe('competing operation');
      },
    );

    const competingOwners = [
      'adoptionJournal', 'firstStartMigrationJournal', 'replacementJournal', 'switchJournal',
      'legacyProfile', 'activeProfile', 'passiveProfile',
    ] as const;
    it.each(competingOwners.flatMap((owner) => slotNames.map((slot) => ({ owner, slot }))))(
      'rejects $owner / $slot before any repair', async ({ owner, slot }) => {
        const { options, read } = await createFixture();
        await writeFile(options[ownKey].currentPath, 'owned recovery');
        const profileIndex = ['legacyProfile', 'activeProfile', 'passiveProfile'].indexOf(owner);
        const conflict = profileIndex < 0
          ? options[owner as Exclude<typeof owner, 'legacyProfile' | 'activeProfile' | 'passiveProfile'>]
          : options.profileRestoreJournals[profileIndex]!;
        await writeFile(conflict[slot], 'unresolved');
        await expect(read()).rejects.toThrow(recoveryRequired);
        expect(await readFile(conflict[slot], 'utf8')).toBe('unresolved');
        expect(await readFile(options[ownKey].currentPath, 'utf8')).toBe('owned recovery');
      },
    );

    it.each(['accepted', 'installerNotApplied', 'rolledBack'] as const)(
      'accepts valid %s update and accepted direct-Setup records without changing them', async (state) => {
      const { options, read } = await createFixture();
      await writeFile(options[ownKey].currentPath, 'owned recovery');
      const records = [
        [options.updateJournal, updateJournal(state)],
        [options.legacyUpdateJournal, updateJournal(state)],
        [options.directSetupRecovery, directSetupRecord('accepted')],
      ] as const;
      for (const [paths, record] of records) await writeFile(paths.currentPath, JSON.stringify(record));
      await expect(read()).resolves.toBe(kind);
      for (const [paths, record] of records) {
        expect(await readFile(paths.currentPath, 'utf8')).toBe(JSON.stringify(record));
      }
    });

    it.each(['updateJournal', 'legacyUpdateJournal', 'directSetupRecovery'] as const)(
      'rejects nonterminal or malformed %s', async (owner) => {
        const { options, read } = await createFixture();
        await writeFile(options[ownKey].currentPath, 'owned recovery');
        const record = owner === 'directSetupRecovery'
          ? directSetupRecord('migrationRunning') : updateJournal('firstStartValidating');
        await writeFile(options[owner].currentPath, JSON.stringify(record));
        await expect(read()).rejects.toThrow(recoveryRequired);
        await writeFile(options[owner].currentPath, '{not-json');
        await expect(read()).rejects.toThrow(recoveryRequired);
        expect(await readFile(options[owner].currentPath, 'utf8')).toBe('{not-json');
      },
    );

    it.each((['updateJournal', 'legacyUpdateJournal', 'directSetupRecovery'] as const)
      .flatMap((owner) => (['nextPath', 'backupPath'] as const).map((slot) => ({ owner, slot }))))(
      'does not repair terminal $owner records that still have a $slot slot', async ({ owner, slot }) => {
        const { options, read } = await createFixture();
        await writeFile(options[ownKey].currentPath, 'owned recovery');
        const current = JSON.stringify(owner === 'directSetupRecovery'
          ? directSetupRecord('accepted') : updateJournal('accepted'));
        await writeFile(options[owner].currentPath, current);
        await writeFile(options[owner][slot], 'unfinished write');
        await expect(read()).rejects.toThrow(recoveryRequired);
        expect(await readFile(options[owner].currentPath, 'utf8')).toBe(current);
        expect(await readFile(options[owner][slot], 'utf8')).toBe('unfinished write');
      },
    );

    it('rejects unsafe terminal record files without deleting them', async () => {
      const { root, options, read } = await createFixture();
      await writeFile(options[ownKey].currentPath, 'owned recovery');
      await mkdir(options.updateJournal.currentPath);
      await expect(read()).rejects.toThrow(recoveryRequired);
      await rm(options.updateJournal.currentPath, { recursive: true });
      await writeFile(options.updateJournal.currentPath, 'x'.repeat(maximumUpdateJournalBytes + 1));
      await expect(read()).rejects.toThrow(recoveryRequired);
      const current = JSON.stringify(updateJournal('accepted'));
      await writeFile(options.updateJournal.currentPath, current);
      await link(options.updateJournal.currentPath, join(root, 'linked-update.json'));
      await expect(read()).rejects.toThrow(recoveryRequired);
      expect(await readFile(options.updateJournal.currentPath, 'utf8')).toBe(current);
    });
  });
});

function updateJournal(
  state: 'accepted' | 'firstStartValidating' | 'installerNotApplied' | 'rolledBack',
): Readonly<UpdateJournal> {
  return {
    binaryRollbackAttemptCount: state === 'rolledBack' ? 1 : 0,
    candidatePackageIdentity: {
      buildRevision: 'bbbbbbbbbbbb', msiProductVersion: '0.2.0',
      packageSha256: 'b'.repeat(64), packageSize: 2_048,
    },
    correlationId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-08-11T18:00:00.000Z',
    currentPackageIdentity: {
      buildRevision: 'aaaaaaaaaaaa', msiProductVersion: '0.1.0',
      packageSha256: 'a'.repeat(64), packageSize: 1_024,
    },
    currentVersion: '0.1.0', formatVersion: 1, handoffAttemptCount: 1,
    ...(state === 'installerNotApplied' ? { preUpdateMigrationChainIdentity: 'c'.repeat(64) } : {}),
    recoveryPointReference: '11111111-1111-4111-8111-111111111111',
    releaseChannel: 'pilot', revision: 5, state, targetVersion: '0.2.0',
    updatedAt: '2026-08-11T18:05:00.000Z',
  };
}

function directSetupRecord(state: 'accepted' | 'migrationRunning') {
  const prepared = createDirectSetupMigrationRecovery({
    appliedMigrationCount: 37, at: '2026-08-12T18:00:00.000Z',
    correlationId: '11111111-1111-4111-8111-111111111111',
    migrationPrefixIdentity: 'a'.repeat(64),
    previousAcceptedBuildIdentity: { appVersion: '0.1.0', buildRevision: 'aaaaaaaaaaaa' },
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    runningTargetBuildIdentity: { appVersion: '0.2.0', buildRevision: 'bbbbbbbbbbbb' },
  });
  const running = transitionDirectSetupMigrationRecovery(prepared, {
    at: '2026-08-12T18:01:00.000Z', state: 'migrationRunning',
  });
  return state === 'migrationRunning' ? running : transitionDirectSetupMigrationRecovery(running, {
    at: '2026-08-12T18:02:00.000Z', state: 'accepted',
  });
}

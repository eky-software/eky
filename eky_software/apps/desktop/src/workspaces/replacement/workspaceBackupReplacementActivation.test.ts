import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProfileRestoreActivationPhase } from '../../profileBackup/restore/profileRestoreActivationJournal.js';
import { ProfileRestoreActivationJournalStore } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from '../../profileBackup/restore/profileRestoreActivationTransaction.js';
import { ProfileRestoreStartupRecovery } from '../../profileBackup/restore/profileRestoreStartupRecovery.js';
import { ProfileRestoreWorkspaceReplacementActivationFactory } from './workspaceBackupReplacementActivationFactory.js';
import { deriveWorkspaceBackupReplacementPaths } from './workspaceBackupReplacementPaths.js';
import {
  TEST_REPLACEMENT_OPERATION_ID,
  TEST_REPLACEMENT_OTHER_WORKSPACE_ID,
  TEST_REPLACEMENT_WORKSPACE_ID,
} from './workspaceBackupReplacementTestSupport.js';

const interruptiblePhases: readonly ProfileRestoreActivationPhase[] = [
  'prepared',
  'movingCurrentDatabase',
  'currentDatabaseMoved',
  'movingCurrentDocuments',
  'currentDocumentsMoved',
  'activatingStagedDatabase',
  'stagedDatabaseActivated',
  'activatingStagedDocuments',
  'stagedDocumentsActivated',
  'validationStarting',
];
const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('workspace backup replacement activation', () => {
  it('replaces only the target portable slots and leaves registry, other workspaces and device-local state byte-identical', async () => {
    const fixture = await createFixture();
    const before = await fixture.readUnrelatedHashes();
    const authority = new ProfileRestoreWorkspaceReplacementActivationFactory().create(
      fixture.paths,
    );

    await authority.transaction.prepare(TEST_REPLACEMENT_OPERATION_ID);
    await authority.transaction.advanceToValidation();
    await authority.transaction.accept();

    await expect(readFile(fixture.paths.activeDatabasePath, 'utf8')).resolves.toBe(
      'new database',
    );
    await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
      'new pdf',
    );
    await expect(authority.journalStore.read()).resolves.toBeUndefined();
    expect(await fixture.readUnrelatedHashes()).toEqual(before);
  });

  it('restores the byte-identical old database and PDF root after post-activation validation failure', async () => {
    const fixture = await createFixture();
    const oldDatabase = await readFile(fixture.paths.activeDatabasePath);
    const oldPdf = await readFile(fixture.activePdfPath);
    const before = await fixture.readUnrelatedHashes();
    const authority = new ProfileRestoreWorkspaceReplacementActivationFactory().create(
      fixture.paths,
    );

    await authority.transaction.prepare(TEST_REPLACEMENT_OPERATION_ID);
    await authority.transaction.advanceToValidation();
    await authority.transaction.rollback();
    await authority.transaction.clearRolledBack();

    await expect(readFile(fixture.paths.activeDatabasePath)).resolves.toEqual(
      oldDatabase,
    );
    await expect(readFile(fixture.activePdfPath)).resolves.toEqual(oldPdf);
    await expect(authority.journalStore.read()).resolves.toBeUndefined();
    expect(await fixture.readUnrelatedHashes()).toEqual(before);
  });

  it.each(interruptiblePhases)(
    'resumes the existing activation transaction after restart at %s',
    async (phase) => {
      const fixture = await createFixture();
      const interrupted = fixture.createTransaction(phase);

      if (phase === 'prepared') {
        await expect(
          interrupted.prepare(TEST_REPLACEMENT_OPERATION_ID),
        ).rejects.toThrow('synthetic interruption');
      } else {
        await interrupted.prepare(TEST_REPLACEMENT_OPERATION_ID);
        await expect(
          interrupted.advanceToValidation(),
        ).rejects.toThrow('synthetic interruption');
      }

      const resumed = fixture.createTransaction();
      const recovery = new ProfileRestoreStartupRecovery({
        journalStore: fixture.journalStore,
        transaction: resumed,
      });
      await expect(recovery.prepareBeforeBackend()).resolves.toBe(
        'validateRestoredProfile',
      );
      await expect(
        recovery.validateAfterBackend({
          mode: 'validateRestoredProfile',
          stopBackend: async () => undefined,
          validateActiveProfile: async () => undefined,
        }),
      ).resolves.toBe('ready');
      await expect(readFile(fixture.paths.activeDatabasePath, 'utf8')).resolves.toBe(
        'new database',
      );
      await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
        'new pdf',
      );
    },
  );

  it.each(interruptiblePhases)(
    'rolls back safely after restart validation fails from %s',
    async (phase) => {
      const fixture = await createFixture();
      const interrupted = fixture.createTransaction(phase);

      if (phase === 'prepared') {
        await expect(
          interrupted.prepare(TEST_REPLACEMENT_OPERATION_ID),
        ).rejects.toThrow('synthetic interruption');
      } else {
        await interrupted.prepare(TEST_REPLACEMENT_OPERATION_ID);
        await expect(
          interrupted.advanceToValidation(),
        ).rejects.toThrow('synthetic interruption');
      }

      const resumed = fixture.createTransaction();
      const recovery = new ProfileRestoreStartupRecovery({
        journalStore: fixture.journalStore,
        transaction: resumed,
      });
      const mode = await recovery.prepareBeforeBackend();
      await expect(
        recovery.validateAfterBackend({
          mode,
          stopBackend: async () => undefined,
          validateActiveProfile: async () => {
            throw new Error('synthetic validation failure');
          },
        }),
      ).resolves.toBe('relaunchRequired');

      const afterRollback = new ProfileRestoreStartupRecovery({
        journalStore: fixture.journalStore,
        transaction: fixture.createTransaction(),
      });
      const rollbackMode = await afterRollback.prepareBeforeBackend();
      expect(rollbackMode).toBe('validateRolledBackProfile');
      await expect(
        afterRollback.validateAfterBackend({
          mode: rollbackMode,
          stopBackend: async () => undefined,
          validateActiveProfile: async () => undefined,
        }),
      ).resolves.toBe('ready');
      await expect(readFile(fixture.paths.activeDatabasePath, 'utf8')).resolves.toBe(
        'old database',
      );
      await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
        'old pdf',
      );
    },
  );
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-replacement-activation-'));
  cleanupRoots.push(root);
  const paths = deriveWorkspaceBackupReplacementPaths(
    root,
    TEST_REPLACEMENT_OPERATION_ID,
    TEST_REPLACEMENT_WORKSPACE_ID,
  );
  const activePdfPath = join(
    paths.activeArtifactRoot,
    'company-1',
    'invoice-1',
    'approved-invoice.pdf',
  );
  const candidatePdfPath = join(
    paths.candidateArtifactRoot,
    'company-1',
    'invoice-1',
    'approved-invoice.pdf',
  );
  const registryPath = join(root, 'workspace-registry-v1.json');
  const otherWorkspacePath = join(
    root,
    'workspaces',
    TEST_REPLACEMENT_OTHER_WORKSPACE_ID,
    'runtime',
    'data',
    'eky.sqlite',
  );
  const deviceSecretPath = join(root, 'runtime', 'secrets', 'smtp.dat');
  const archiveJournalPath = join(root, 'runtime', 'invoice-archive-journal.json');
  const updateStatePath = join(root, 'runtime', 'update-state.json');
  const diagnosticsPath = join(root, 'logs', 'diagnostics.jsonl');
  const sourceBackupPath = join(root, 'source.ekybackup');

  for (const path of [
    paths.activeDatabasePath,
    activePdfPath,
    paths.candidateDatabasePath,
    candidatePdfPath,
    registryPath,
    otherWorkspacePath,
    deviceSecretPath,
    archiveJournalPath,
    updateStatePath,
    diagnosticsPath,
    sourceBackupPath,
  ]) {
    await mkdir(dirname(path), { mode: 0o700, recursive: true });
  }
  await writeFile(paths.activeDatabasePath, 'old database');
  await writeFile(activePdfPath, 'old pdf');
  await writeFile(paths.candidateDatabasePath, 'new database');
  await writeFile(candidatePdfPath, 'new pdf');
  await writeFile(registryPath, '{"registry":"unchanged"}\n');
  await writeFile(otherWorkspacePath, 'other workspace');
  await writeFile(deviceSecretPath, 'encrypted envelope');
  await writeFile(archiveJournalPath, 'archive journal');
  await writeFile(updateStatePath, 'update state');
  await writeFile(diagnosticsPath, 'diagnostic event');
  await writeFile(sourceBackupPath, 'encrypted source');

  const journalStore = new ProfileRestoreActivationJournalStore(
    paths.activationJournalPath,
  );
  const createTransaction = (interruptedPhase?: ProfileRestoreActivationPhase) =>
    new ProfileRestoreActivationTransaction({
      ...(interruptedPhase === undefined
        ? {}
        : {
            afterPhasePersisted(phase: ProfileRestoreActivationPhase) {
              if (phase === interruptedPhase) {
                throw new Error('synthetic interruption');
              }
            },
          }),
      journalStore,
      paths: {
        activeDatabasePath: paths.activeDatabasePath,
        activeDocumentsRoot: paths.activeArtifactRoot,
        failedRoot: paths.activationFailedRoot,
        rollbackRoot: paths.activationRollbackRoot,
        stagingRoot: paths.activationStagingRoot,
      },
    });
  const unrelatedPaths = [
    registryPath,
    otherWorkspacePath,
    deviceSecretPath,
    archiveJournalPath,
    updateStatePath,
    diagnosticsPath,
    sourceBackupPath,
  ];

  return {
    activePdfPath,
    createTransaction,
    journalStore,
    paths,
    readUnrelatedHashes: async () =>
      Promise.all(unrelatedPaths.map((path) => sha256File(path))),
  };
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

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

import type { ProfileRestoreActivationPhase } from './profileRestoreActivationJournal.js';
import {
  profileRestoreActivationJournalFileName,
  ProfileRestoreActivationJournalStore,
} from './profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';

const operationId = '11111111-1111-4111-8111-111111111111';
const interruptiblePhases: readonly ProfileRestoreActivationPhase[] = [
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
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('profile restore activation transaction', () => {
  it('RESTORE-ACTIVATE-001 @critical switches database and document slots and clears accepted rollback data', async () => {
    const fixture = await createFixture();

    await fixture.transaction.prepare(operationId);
    await expect(
      fixture.transaction.advanceToValidation(),
    ).resolves.toMatchObject({
      operationId,
      phase: 'validationStarting',
    });
    await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe(
      'new database',
    );
    await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
      'new pdf',
    );

    await fixture.transaction.accept();

    await expect(fixture.journalStore.read()).resolves.toBeUndefined();
  });

  it.each(interruptiblePhases)(
    'resumes idempotently after interruption at %s',
    async (interruptedPhase) => {
      const fixture = await createFixture({
        interruptedPhase,
      });

      await fixture.transaction.prepare(operationId);
      await expect(
        fixture.transaction.advanceToValidation(),
      ).rejects.toThrow('synthetic interruption');

      const resumed = fixture.createTransaction();
      await expect(resumed.advanceToValidation()).resolves.toMatchObject({
        phase: 'validationStarting',
      });
      await expect(
        readFile(fixture.activeDatabasePath, 'utf8'),
      ).resolves.toBe('new database');
      await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
        'new pdf',
      );
    },
  );

  it.each(interruptiblePhases)(
    'RESTORE-ROLLBACK-001 @fault rolls back to the old profile after interruption at %s',
    async (interruptedPhase) => {
      const fixture = await createFixture({
        interruptedPhase,
      });

      await fixture.transaction.prepare(operationId);
      await expect(
        fixture.transaction.advanceToValidation(),
      ).rejects.toThrow('synthetic interruption');

      const recovery = fixture.createTransaction();
      await expect(recovery.rollback()).resolves.toMatchObject({
        phase: 'rolledBack',
      });
      await expect(
        readFile(fixture.activeDatabasePath, 'utf8'),
      ).resolves.toBe('old database');
      await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
        'old pdf',
      );
    },
  );

  it('supports a demonstrably empty active profile', async () => {
    const fixture = await createFixture({ activeProfileExists: false });

    await fixture.transaction.prepare(operationId);
    await fixture.transaction.advanceToValidation();
    await fixture.transaction.rollback();

    await expect(readFile(fixture.activeDatabasePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

async function createFixture(
  options: {
    activeProfileExists?: boolean;
    interruptedPhase?: ProfileRestoreActivationPhase;
  } = {},
): Promise<{
  activeDatabasePath: string;
  activePdfPath: string;
  createTransaction(): ProfileRestoreActivationTransaction;
  journalStore: ProfileRestoreActivationJournalStore;
  transaction: ProfileRestoreActivationTransaction;
}> {
  const root = await mkdtemp(join(tmpdir(), 'eky-restore-activation-'));
  roots.push(root);
  const runtimeRoot = join(root, 'runtime');
  const stagingRoot = join(runtimeRoot, 'private-backup-staging');
  const rollbackRoot = join(runtimeRoot, 'profile-restore-rollback');
  const failedRoot = join(runtimeRoot, 'failed-profile-restores');
  const activeDatabasePath = join(runtimeRoot, 'data', 'eky.sqlite');
  const activeDocumentsRoot = join(
    runtimeRoot,
    'storage',
    'invoices',
  );
  const activePdfPath = join(
    activeDocumentsRoot,
    'company-1',
    'invoice-1',
    'approved-invoice.pdf',
  );
  const stagedOperationRoot = join(stagingRoot, operationId);
  const stagedDatabasePath = join(
    stagedOperationRoot,
    'profile.sqlite',
  );
  const stagedPdfPath = join(
    stagedOperationRoot,
    'activation',
    'storage',
    'invoices',
    'company-1',
    'invoice-1',
    'approved-invoice.pdf',
  );
  const journalStore = new ProfileRestoreActivationJournalStore(
    join(
      runtimeRoot,
      'profile-restore-state',
      profileRestoreActivationJournalFileName,
    ),
  );

  await mkdir(join(stagedOperationRoot, 'activation'), {
    mode: 0o700,
    recursive: true,
  });
  await mkdir(dirname(stagedPdfPath), {
    mode: 0o700,
    recursive: true,
  });
  await writeFile(stagedDatabasePath, 'new database');
  await writeFile(stagedPdfPath, 'new pdf');

  if (options.activeProfileExists ?? true) {
    await mkdir(dirname(activeDatabasePath), {
      mode: 0o700,
      recursive: true,
    });
    await mkdir(dirname(activePdfPath), {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(activeDatabasePath, 'old database');
    await writeFile(activePdfPath, 'old pdf');
  }

  const createTransaction = (
    interruptedPhase?: ProfileRestoreActivationPhase,
  ) =>
    new ProfileRestoreActivationTransaction({
      ...(interruptedPhase === undefined
        ? {}
        : {
            afterPhasePersisted(phase) {
              if (phase === interruptedPhase) {
                throw new Error('synthetic interruption');
              }
            },
          }),
      journalStore,
      paths: {
        activeDatabasePath,
        activeDocumentsRoot,
        failedRoot,
        rollbackRoot,
        stagingRoot,
      },
    });

  return {
    activeDatabasePath,
    activePdfPath,
    createTransaction: () => createTransaction(),
    journalStore,
    transaction: createTransaction(options.interruptedPhase),
  };
}

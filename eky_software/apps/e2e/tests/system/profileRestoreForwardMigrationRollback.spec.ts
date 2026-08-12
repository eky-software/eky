import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { BackendOperationalEvent } from '../../../backend/src/observability/operationalEvent.js';
import type { OperationalLogger } from '../../../backend/src/observability/operationalLogger.js';
import { createDatabaseConnection } from '../../../backend/src/database/connection/createDatabaseConnection.js';
import { inspectMigrationStartupState } from '../../../backend/src/database/migration/inspectMigrationStartupState.js';
import { runMigrations } from '../../../backend/src/database/migration/runMigrations.js';
import { createApp } from '../../../backend/src/http/app.js';
import {
  ProfileRestoreActivationJournalStore,
  profileRestoreActivationJournalFileName,
} from '../../../desktop/src/profileBackup/restore/profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from '../../../desktop/src/profileBackup/restore/profileRestoreActivationTransaction.js';
import { ProfileRestoreStartupRecovery } from '../../../desktop/src/profileBackup/restore/profileRestoreStartupRecovery.js';
import { authorizeRestoreFirstStartForwardMigrations } from '../../../desktop/src/update/restoreFirstStartMigrationAuthority.js';
import { expect, test } from '../../src/fixtures/isolatedBackendTest.js';

const operationId = '11111111-1111-4111-8111-111111111111';
const conflictingProbeId = 'existing-restored-data';

test(
  'RESTORE-MIGRATION-ROLLBACK-001 @critical @fault @recovery restores the pre-restore N+1 profile after a real forward migration fails',
  async ({ e2eBackend }) => {
    const fixture = await createFixture(e2eBackend.paths.tempRoot);
    const previousDatabase = await readFile(fixture.activeDatabasePath);
    const previousPdf = await readFile(fixture.activePdfPath);
    const previousDatabaseSha256 = sha256(previousDatabase);
    const previousPdfSha256 = sha256(previousPdf);

    await fixture.transaction.prepare(operationId);
    const startupMode = await fixture.startupRecovery.prepareBeforeBackend();

    expect(startupMode).toBe('validateRestoredProfile');
    await expect(readFile(fixture.activePdfPath)).resolves.toEqual(
      fixture.restoredPdf,
    );

    const operationalEvents: BackendOperationalEvent[] = [];
    const operationalLogger: OperationalLogger = {
      write(event) {
        operationalEvents.push(event);
      },
    };
    let migrationDecision: string | undefined;

    const startupFailure = await createApp({
      appVersion: '0.1.0-alpha.2',
      databaseFilePath: fixture.activeDatabasePath,
      migrationsDirectory: fixture.nextMigrationsDirectory,
      operationalLogger,
      beforeMigrations: async (inspection) => {
        migrationDecision = authorizeRestoreFirstStartForwardMigrations({
          directSetupRecovery: undefined,
          inspection,
          profileRestoreJournal: await fixture.journalStore.read(),
          profileRestoreStartupMode: startupMode,
          startupRecoveryAuthority: 'profileRestore',
          updateJournal: undefined,
        });
      },
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(migrationDecision).toBe('authorized');
    expect(startupFailure).toBeInstanceOf(Error);
    expect((startupFailure as Error).message).toBe(
      'Database migrations could not be completed.',
    );
    expect(operationalEvents).toContainEqual(
      expect.objectContaining({
        completedMigrationCount: 1,
        errorCode: 'MIGRATION_EXECUTION_FAILED',
        eventName: 'migration.failed',
        failureStage: 'migrationExecution',
        sideEffectState: 'unknown',
      }),
    );
    expect(JSON.stringify(operationalEvents)).not.toContain(fixture.root);

    const partiallyMigratedDatabase = createDatabaseConnection({
      databaseFilePath: fixture.activeDatabasePath,
    });
    try {
      expect(tableExists(partiallyMigratedDatabase, 'successful_forward_step'))
        .toBe(true);
      expect(readAppliedMigrationNames(partiallyMigratedDatabase)).toEqual([
        '001_create_migration_probe.sql',
        '002_create_successful_forward_step.sql',
      ]);
    } finally {
      partiallyMigratedDatabase.close();
    }

    await expect(
      fixture.startupRecovery.recoverFromBackendStartupFailure({
        mode: startupMode,
      }),
    ).resolves.toBe('relaunchRequired');

    const rolledBackDatabase = await readFile(fixture.activeDatabasePath);
    const rolledBackPdf = await readFile(fixture.activePdfPath);
    expect(rolledBackDatabase).toEqual(previousDatabase);
    expect(rolledBackPdf).toEqual(previousPdf);
    expect(sha256(rolledBackDatabase)).toBe(previousDatabaseSha256);
    expect(sha256(rolledBackPdf)).toBe(previousPdfSha256);
    await expect(fixture.journalStore.read()).resolves.toMatchObject({
      operationId,
      phase: 'rolledBack',
    });

    const relaunchedRecovery = fixture.createStartupRecovery();
    const relaunchedMode = await relaunchedRecovery.prepareBeforeBackend();
    expect(relaunchedMode).toBe('validateRolledBackProfile');
    let stopBackendCalled = false;

    await expect(
      relaunchedRecovery.validateAfterBackend({
        mode: relaunchedMode,
        stopBackend: async () => {
          stopBackendCalled = true;
        },
        validateActiveProfile: async () => {
          const database = createDatabaseConnection({
            databaseFilePath: fixture.activeDatabasePath,
          });
          try {
            expect(
              inspectMigrationStartupState(
                database,
                fixture.nextMigrationsDirectory,
              ),
            ).toMatchObject({
              appliedMigrationCount: 3,
              pendingMigrationCount: 0,
              profileState: 'existing',
            });
            expect(database.pragma('quick_check', { simple: true })).toBe(
              'ok',
            );
          } finally {
            database.close();
          }
        },
      }),
    ).resolves.toBe('ready');

    expect(stopBackendCalled).toBe(false);
    await expect(fixture.journalStore.read()).resolves.toBeUndefined();
  },
);

async function createFixture(root: string): Promise<{
  activeDatabasePath: string;
  activePdfPath: string;
  createStartupRecovery(): ProfileRestoreStartupRecovery;
  journalStore: ProfileRestoreActivationJournalStore;
  nextMigrationsDirectory: string;
  restoredPdf: Buffer;
  root: string;
  startupRecovery: ProfileRestoreStartupRecovery;
  transaction: ProfileRestoreActivationTransaction;
}> {
  const fixtureRoot = join(root, 'restore-forward-migration-rollback');
  const currentMigrationsDirectory = join(fixtureRoot, 'migrations-n');
  const nextMigrationsDirectory = join(fixtureRoot, 'migrations-n-plus-one');
  const activeDatabasePath = join(
    fixtureRoot,
    'active',
    'data',
    'eky.sqlite',
  );
  const activeDocumentsRoot = join(
    fixtureRoot,
    'active',
    'storage',
    'invoices',
  );
  const activePdfPath = join(
    activeDocumentsRoot,
    'company-1',
    'invoice-1',
    'approved-invoice.pdf',
  );
  const stagingRoot = join(fixtureRoot, 'restore-staging');
  const stagingOperationRoot = join(stagingRoot, operationId);
  const stagedDatabasePath = join(stagingOperationRoot, 'profile.sqlite');
  const stagedPdfPath = join(
    stagingOperationRoot,
    'activation',
    'storage',
    'invoices',
    'company-1',
    'invoice-1',
    'approved-invoice.pdf',
  );
  const journalStore = new ProfileRestoreActivationJournalStore(
    join(
      fixtureRoot,
      'runtime',
      profileRestoreActivationJournalFileName,
    ),
  );

  await writeMigrationDirectories({
    currentMigrationsDirectory,
    nextMigrationsDirectory,
  });
  await createCurrentDatabase(
    activeDatabasePath,
    nextMigrationsDirectory,
  );
  await createRestoredDatabase(
    stagedDatabasePath,
    currentMigrationsDirectory,
  );

  const previousPdf = Buffer.from('current N+1 approved invoice PDF');
  const restoredPdf = Buffer.from('restored N approved invoice PDF');
  await Promise.all([
    mkdir(dirname(activePdfPath), { mode: 0o700, recursive: true }),
    mkdir(dirname(stagedPdfPath), { mode: 0o700, recursive: true }),
  ]);
  await Promise.all([
    writeFile(activePdfPath, previousPdf),
    writeFile(stagedPdfPath, restoredPdf),
  ]);

  const transaction = new ProfileRestoreActivationTransaction({
    journalStore,
    paths: {
      activeDatabasePath,
      activeDocumentsRoot,
      failedRoot: join(fixtureRoot, 'failed-restores'),
      rollbackRoot: join(fixtureRoot, 'restore-rollback'),
      stagingRoot,
    },
  });
  const createStartupRecovery = () =>
    new ProfileRestoreStartupRecovery({
      journalStore,
      transaction,
    });

  return {
    activeDatabasePath,
    activePdfPath,
    createStartupRecovery,
    journalStore,
    nextMigrationsDirectory,
    restoredPdf,
    root: fixtureRoot,
    startupRecovery: createStartupRecovery(),
    transaction,
  };
}

async function writeMigrationDirectories(input: {
  currentMigrationsDirectory: string;
  nextMigrationsDirectory: string;
}): Promise<void> {
  const initialMigration = `
    CREATE TABLE migration_probe (
      id TEXT PRIMARY KEY,
      note TEXT NOT NULL
    );
  `;
  await Promise.all([
    mkdir(input.currentMigrationsDirectory, {
      mode: 0o700,
      recursive: true,
    }),
    mkdir(input.nextMigrationsDirectory, {
      mode: 0o700,
      recursive: true,
    }),
  ]);
  await Promise.all([
    writeFile(
      join(
        input.currentMigrationsDirectory,
        '001_create_migration_probe.sql',
      ),
      initialMigration,
      'utf8',
    ),
    writeFile(
      join(
        input.nextMigrationsDirectory,
        '001_create_migration_probe.sql',
      ),
      initialMigration,
      'utf8',
    ),
    writeFile(
      join(
        input.nextMigrationsDirectory,
        '002_create_successful_forward_step.sql',
      ),
      'CREATE TABLE successful_forward_step (id TEXT PRIMARY KEY);',
      'utf8',
    ),
    writeFile(
      join(
        input.nextMigrationsDirectory,
        '003_insert_forward_probe.sql',
      ),
      `INSERT INTO migration_probe (id, note) VALUES ('${conflictingProbeId}', 'forward migration');`,
      'utf8',
    ),
  ]);
}

async function createCurrentDatabase(
  databaseFilePath: string,
  migrationsDirectory: string,
): Promise<void> {
  const database = createDatabaseConnection({ databaseFilePath });
  try {
    await runMigrations(database, { migrationsDirectory });
  } finally {
    database.close();
  }
}

async function createRestoredDatabase(
  databaseFilePath: string,
  migrationsDirectory: string,
): Promise<void> {
  const database = createDatabaseConnection({ databaseFilePath });
  try {
    await runMigrations(database, { migrationsDirectory });
    database
      .prepare('INSERT INTO migration_probe (id, note) VALUES (?, ?)')
      .run(conflictingProbeId, 'historical restored data');
  } finally {
    database.close();
  }
}

function readAppliedMigrationNames(
  database: ReturnType<typeof createDatabaseConnection>,
): string[] {
  return database
    .prepare<[], { name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name',
    )
    .all()
    .map(({ name }) => name);
}

function tableExists(
  database: ReturnType<typeof createDatabaseConnection>,
  tableName: string,
): boolean {
  return (
    database
      .prepare<[string], { name: string }>(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = ?
        `,
      )
      .get(tableName) !== undefined
  );
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

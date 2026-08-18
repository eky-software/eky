import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import type { APIRequestContext } from '@playwright/test';

import { createDatabaseConnection } from '../../../backend/src/database/connection/createDatabaseConnection.js';
import { readLocalRuntimeIdentity } from '../../../backend/src/database/localRuntimeIdentityReader.js';
import { readMigrationManifest } from '../../../backend/src/database/migration/migrationManifest.js';
import { runMigrations } from '../../../backend/src/database/migration/runMigrations.js';
import { SqliteInvoiceBackupArtifactCatalog } from '../../../backend/src/modules/invoicing/infrastructure/sqliteInvoiceBackupArtifactCatalog.js';
import { ProfileMaintenanceState } from '../../../backend/src/runtime/profileMaintenance/profileMaintenanceState.js';
import { createConsistentProfileSnapshotService } from '../../../backend/src/runtime/profileSnapshot/createConsistentProfileSnapshot.js';
import { inspectSqliteProfileDatabase } from '../../../backend/src/runtime/profileSnapshot/inspectSqliteProfileDatabase.js';
import { validateProfileArtifactCatalog } from '../../../backend/src/runtime/profileSnapshot/validateProfileArtifactCatalog.js';
import { writeBackupContainer } from '../../../desktop/src/profileBackup/container/backupContainerWriter.js';
import { createProfileBackupSourceEntries } from '../../../desktop/src/profileBackup/createProfileBackupSourceEntries.js';
import { InMemoryWorkspaceMaintenanceLease } from '../../../desktop/src/workspaces/maintenance/workspaceMaintenanceLease.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../../../desktop/src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../../../desktop/src/workspaces/registry/workspaceRegistryStore.js';
import type { WorkspaceId } from '../../../desktop/src/workspaces/registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../../../desktop/src/workspaces/registry/workspaceIdValidation.js';
import type { ActiveWorkspaceLifecyclePort } from '../../../desktop/src/workspaces/runtime/activeWorkspaceLifecyclePort.js';
import {
  PrivateWorkspaceBackupCandidateAdapter,
  type PrivateWorkspaceBackupCandidateRuntimeFactory,
} from '../../../desktop/src/workspaces/import/privateWorkspaceBackupCandidateAdapter.js';
import { WorkspaceBackupContainerAdapter } from '../../../desktop/src/workspaces/import/workspaceBackupContainerAdapter.js';
import { WorkspaceBackupImportCoordinator } from '../../../desktop/src/workspaces/import/workspaceBackupImportCoordinator.js';
import { WorkspaceBackupImportError } from '../../../desktop/src/workspaces/import/workspaceBackupImportError.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../../../desktop/src/workspaces/import/workspaceBackupImportJournalPaths.js';
import { WorkspaceBackupImportJournalStore } from '../../../desktop/src/workspaces/import/workspaceBackupImportJournalStore.js';
import { WorkspaceBackupPlaintextQuarantine } from '../../../desktop/src/workspaces/import/workspaceBackupPlaintextQuarantine.js';
import { validateWorkspaceBackupImportOperationId } from '../../../desktop/src/workspaces/import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../../../desktop/src/workspaces/import/workspaceBackupImportPaths.js';
import type {
  PublishedWorkspaceBackupValidationInput,
  WorkspaceBackupCandidateMigrationInput,
  WorkspaceBackupCandidateReadiness,
  WorkspaceBackupCandidateValidationInput,
} from '../../../desktop/src/workspaces/import/workspaceBackupImportPorts.js';
import { NodeWorkspaceBackupImportRootStore } from '../../../desktop/src/workspaces/import/workspaceBackupImportRootStore.js';
import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../../src/data/syntheticBusinessInputs.js';
import {
  expect,
  test,
} from '../../src/fixtures/isolatedBackendTest.js';

const appVersion = '0.2.6';
const backupPassword = 'synthetic-workspace-import-password';
const operationId = validateWorkspaceBackupImportOperationId(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
);
const workspaceId = validateWorkspaceId(
  '44444444-4444-4444-8444-444444444444',
);
const migrationsDirectory = resolve(
  import.meta.dirname,
  '../../../backend/src/database/migrations',
);

test('WORKSPACE-IMPORT-001 @critical @security imports a real encrypted backup with its PDF into an isolated workspace', async ({
  e2eBackend,
}) => {
  const sourceInvoice = await createApprovedInvoiceWithPdf(e2eBackend.api);
  const sourceDocument = readInvoiceDocument(
    e2eBackend.paths.databaseFilePath,
    sourceInvoice.invoiceId,
  );
  const sourcePdfPath = resolveStoragePath(
    e2eBackend.paths.documentsRoot,
    sourceDocument.storagePath,
  );
  const sourcePdfHash = await sha256File(sourcePdfPath);

  await e2eBackend.backend.stop();
  expect(
    e2eBackend.backend.managedProcess.child.exitCode !== null ||
      e2eBackend.backend.managedProcess.child.signalCode !== null,
  ).toBe(true);

  const backupPath = join(e2eBackend.runRoot, 'source-profile.ekybackup');
  const backupIdentity = await createRealPortableBackup({
    backupPath,
    databaseFilePath: e2eBackend.paths.databaseFilePath,
    invoiceDocumentStorageRoot: e2eBackend.paths.documentsRoot,
    password: backupPassword,
    stagingRoot: join(e2eBackend.runRoot, 'snapshot-staging'),
  });
  const sourceDatabaseHashBeforeImport = await sha256File(
    e2eBackend.paths.databaseFilePath,
  );
  const sourceBackupHashBeforeImport = await sha256File(backupPath);
  const userDataRoot = join(e2eBackend.runRoot, 'workspace-user-data');
  await mkdir(userDataRoot, { mode: 0o700 });
  const plaintextQuarantine = new WorkspaceBackupPlaintextQuarantine({
    userDataRoot,
  });

  const lifecycleEvents: string[] = [];
  const registry = new WorkspaceRegistryStore({
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: userDataRoot,
  });
  const importJournal = new WorkspaceBackupImportJournalStore({
    filePath: join(
      userDataRoot,
      WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME,
    ),
    installationRoot: userDataRoot,
  });
  const coordinator = new WorkspaceBackupImportCoordinator({
    activeWorkspaceLifecycle: createLifecycle(lifecycleEvents),
    backupCandidate: new PrivateWorkspaceBackupCandidateAdapter(
      createCandidateRuntimeFactory(),
    ),
    backupContainer: new WorkspaceBackupContainerAdapter({
      plaintextQuarantine,
    }),
    generateOperationId: () => operationId,
    generateWorkspaceId: () => workspaceId,
    importJournal,
    maintenanceLease: new InMemoryWorkspaceMaintenanceLease(),
    now: () => new Date('2026-08-19T12:00:00.000Z'),
    plaintextQuarantine,
    registry,
    rootStore: new NodeWorkspaceBackupImportRootStore(),
    userDataRoot,
    workspaceRuntimeAbsence: {
      assertNoActiveWorkspaceRuntime: async () => {
        lifecycleEvents.push('runtime.absent');
        if (
          e2eBackend.backend.managedProcess.child.exitCode === null &&
          e2eBackend.backend.managedProcess.child.signalCode === null
        ) {
          throw new Error('SOURCE_BACKEND_STILL_RUNNING');
        }
      },
    },
  });

  await expect(
    importWorkspaceForSystemProof(coordinator, {
      containerPath: backupPath,
      password: backupPassword,
      workspaceLabel: 'Tuotu PDF-yritys',
    }),
  ).resolves.toEqual({
    workspaceId,
    workspaceLabel: 'Tuotu PDF-yritys',
  });

  const paths = deriveWorkspaceBackupImportPaths(
    userDataRoot,
    operationId,
    workspaceId,
  );
  const importedInspection = inspectSqliteProfileDatabase(
    paths.publishedDatabaseFilePath,
    migrationsDirectory,
    'exactCurrentManifest',
  );
  const importedRegistry = await registry.read();
  expect(importedInspection).toEqual(backupIdentity);
  expect(importedRegistry).toMatchObject({
    activeWorkspaceId: workspaceId,
    formatVersion: 1,
    workspaces: [
      {
        lifecycleState: 'ready',
        lineageIdentity: {
          formatVersion: 1,
          profileId: backupIdentity.profileId,
        },
        workspaceId,
        workspaceLabel: 'Tuotu PDF-yritys',
      },
    ],
  });
  expect(await importJournal.read()).toBeUndefined();
  await expect(readdir(paths.operationRoot)).rejects.toMatchObject({
    code: 'ENOENT',
  });

  const importedDocument = readInvoiceDocument(
    paths.publishedDatabaseFilePath,
    sourceInvoice.invoiceId,
  );
  expect(importedDocument).toEqual(sourceDocument);
  expect(
    await sha256File(
      resolveStoragePath(
        paths.publishedArtifactRoot,
        importedDocument.storagePath,
      ),
    ),
  ).toBe(sourcePdfHash);
  expect(await sha256File(e2eBackend.paths.databaseFilePath)).toBe(
    sourceDatabaseHashBeforeImport,
  );
  expect(await sha256File(backupPath)).toBe(sourceBackupHashBeforeImport);
  expect(lifecycleEvents).toEqual([
    'active.quiesce.empty',
    'active.stop.empty',
    'runtime.absent',
    'active.ensure.empty',
  ]);
});

test('WORKSPACE-IMPORT-002 @critical @recovery migrates an authenticated historical prefix without changing its source', async ({
  e2eBackend,
}) => {
  await e2eBackend.backend.stop();
  assertManagedProcessStopped(e2eBackend.backend.managedProcess.child);

  const historical = await createHistoricalPortableBackup({
    backupPath: join(e2eBackend.runRoot, 'historical-profile.ekybackup'),
    password: backupPassword,
    root: join(e2eBackend.runRoot, 'historical-source'),
  });
  const sourceDatabaseHashBeforeImport = await sha256File(
    historical.databaseFilePath,
  );
  const sourceBackupHashBeforeImport = await sha256File(historical.backupPath);
  const userDataRoot = join(e2eBackend.runRoot, 'historical-user-data');
  await mkdir(userDataRoot, { mode: 0o700 });
  const plaintextQuarantine = new WorkspaceBackupPlaintextQuarantine({
    userDataRoot,
  });

  const lifecycleEvents: string[] = [];
  const registry = new WorkspaceRegistryStore({
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: userDataRoot,
  });
  const importJournal = new WorkspaceBackupImportJournalStore({
    filePath: join(userDataRoot, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME),
    installationRoot: userDataRoot,
  });
  const coordinator = new WorkspaceBackupImportCoordinator({
    activeWorkspaceLifecycle: createLifecycle(lifecycleEvents),
    backupCandidate: new PrivateWorkspaceBackupCandidateAdapter(
      createCandidateRuntimeFactory(),
    ),
    backupContainer: new WorkspaceBackupContainerAdapter({
      plaintextQuarantine,
    }),
    generateOperationId: () => operationId,
    generateWorkspaceId: () => workspaceId,
    importJournal,
    maintenanceLease: new InMemoryWorkspaceMaintenanceLease(),
    now: () => new Date('2026-08-19T12:00:00.000Z'),
    plaintextQuarantine,
    registry,
    rootStore: new NodeWorkspaceBackupImportRootStore(),
    userDataRoot,
    workspaceRuntimeAbsence: {
      assertNoActiveWorkspaceRuntime: async () => {
        lifecycleEvents.push('runtime.absent');
      },
    },
  });

  await expect(
    importWorkspaceForSystemProof(coordinator, {
      containerPath: historical.backupPath,
      password: backupPassword,
      workspaceLabel: 'Historiallinen yritys',
    }),
  ).resolves.toEqual({
    workspaceId,
    workspaceLabel: 'Historiallinen yritys',
  });
  expect(await sha256File(historical.databaseFilePath)).toBe(
    sourceDatabaseHashBeforeImport,
  );
  expect(await sha256File(historical.backupPath)).toBe(
    sourceBackupHashBeforeImport,
  );

  const paths = deriveWorkspaceBackupImportPaths(
    userDataRoot,
    operationId,
    workspaceId,
  );
  const currentManifest = readMigrationManifest(migrationsDirectory);
  const importedInspection = inspectSqliteProfileDatabase(
    paths.publishedDatabaseFilePath,
    migrationsDirectory,
    'exactCurrentManifest',
  );
  expect(importedInspection.profileId).toBe(historical.profileId);
  expect(importedInspection.migrationChainIdentity).not.toBe(
    historical.migrationChainIdentity,
  );
  expect(readMigrationCount(paths.publishedDatabaseFilePath)).toBe(
    currentManifest.length,
  );
  expect(
    inspectSqliteProfileDatabase(
      historical.databaseFilePath,
      migrationsDirectory,
      'compatibleHistoricalPrefix',
    ),
  ).toEqual({
    migrationChainIdentity: historical.migrationChainIdentity,
    profileId: historical.profileId,
  });
  expect(readMigrationCount(historical.databaseFilePath)).toBe(
    currentManifest.length - 1,
  );
  expect(await importJournal.read()).toBeUndefined();
  expect(lifecycleEvents).toEqual([
    'active.quiesce.empty',
    'active.stop.empty',
    'runtime.absent',
    'active.ensure.empty',
  ]);
});

function createCandidateRuntimeFactory(): PrivateWorkspaceBackupCandidateRuntimeFactory {
  return {
    startMigration: async (
      input: Readonly<WorkspaceBackupCandidateMigrationInput>,
    ) => {
      await copyFile(
        join(input.importStagingRoot, 'profile.sqlite'),
        input.databaseFilePath,
      );
      await chmod(input.databaseFilePath, 0o600);
      const sourceInspection = inspectSqliteProfileDatabase(
        input.databaseFilePath,
        migrationsDirectory,
        'compatibleHistoricalPrefix',
      );
      if (
        sourceInspection.profileId !== input.expectedProfileId ||
        sourceInspection.migrationChainIdentity !==
          input.expectedSourceMigrationChainIdentity
      ) {
        throw new Error('SOURCE_IDENTITY_MISMATCH');
      }
      const database = createDatabaseConnection({
        databaseFilePath: input.databaseFilePath,
      });
      try {
        await runMigrations(database, {
          migrationsDirectory,
          releaseIdentity: {
            appVersion,
            buildRevision: '3'.repeat(40),
          },
        });
      } finally {
        database.close();
      }
      return {
        stopAndProveHandlesClosed: async () => true,
        inspectStoppedMigrationResult: async () => ({
          handlesClosed: true,
          ...inspectSqliteProfileDatabase(
            input.databaseFilePath,
            migrationsDirectory,
            'exactCurrentManifest',
          ),
        }),
      };
    },
    startValidation: async (
      input: Readonly<WorkspaceBackupCandidateValidationInput>,
    ) => {
      await materializeValidatedArtifacts(input);
      return createStoppedReadinessRuntime(input);
    },
    startPublishedValidation: async (
      input: Readonly<PublishedWorkspaceBackupValidationInput>,
    ) => createStoppedReadinessRuntime(input),
  };
}

async function materializeValidatedArtifacts(
  input: Readonly<WorkspaceBackupCandidateValidationInput>,
): Promise<void> {
  const database = createDatabaseConnection({
    databaseFilePath: input.databaseFilePath,
  });
  try {
    const validation = await validateProfileArtifactCatalog({
      database,
      operationRoot: input.importStagingRoot,
    });
    for (const artifact of validation.artifacts) {
      const sourcePath = resolveContainedPath(
        input.importStagingRoot,
        artifact.logicalPath,
      );
      const destinationPath = resolveContainedPath(
        input.artifactRoot,
        artifact.storagePath,
      );
      await mkdir(dirname(destinationPath), { mode: 0o700, recursive: true });
      await copyFile(sourcePath, destinationPath);
      if ((await sha256File(destinationPath)) !== artifact.sha256) {
        throw new Error('MATERIALIZED_ARTIFACT_MISMATCH');
      }
    }
  } finally {
    database.close();
  }
}

function createStoppedReadinessRuntime(
  input:
    | Readonly<WorkspaceBackupCandidateValidationInput>
    | Readonly<PublishedWorkspaceBackupValidationInput>,
) {
  return {
    stopAndProveHandlesClosed: async () => true,
    inspectStoppedReadiness: async () =>
      inspectWorkspaceReadiness({
        artifactRoot: input.artifactRoot,
        databaseFilePath: input.databaseFilePath,
        expectedProfileId: input.expectedProfileId,
      }),
  };
}

async function inspectWorkspaceReadiness(input: {
  readonly artifactRoot: string;
  readonly databaseFilePath: string;
  readonly expectedProfileId: string;
}): Promise<Readonly<WorkspaceBackupCandidateReadiness>> {
  const inspection = inspectSqliteProfileDatabase(
    input.databaseFilePath,
    migrationsDirectory,
    'exactCurrentManifest',
  );
  if (inspection.profileId !== input.expectedProfileId) {
    throw new Error('PUBLISHED_PROFILE_MISMATCH');
  }
  const database = createDatabaseConnection({
    databaseFilePath: input.databaseFilePath,
  });
  try {
    const identity = readLocalRuntimeIdentity(database);
    const artifacts =
      await new SqliteInvoiceBackupArtifactCatalog(
        database,
      ).listAuthoritativeArtifacts();
    const actualStoragePaths = await readRelativeFilePaths(input.artifactRoot);
    const expectedStoragePaths = artifacts
      .map((artifact) => artifact.storagePath)
      .sort();
    expect(actualStoragePaths).toEqual(expectedStoragePaths);
    for (const artifact of artifacts) {
      const path = resolveStoragePath(input.artifactRoot, artifact.storagePath);
      expect(await sha256File(path)).toBe(artifact.sha256);
    }
    return Object.freeze({
      actorId: 'local-owner',
      artifactRootHealth: 'ready',
      companyId: identity.companyId,
      databaseHealth: 'healthy',
      foreignKeyHealth: 'healthy',
      handlesClosed: true,
      lineageIdentity: Object.freeze({
        formatVersion: 1,
        profileId: inspection.profileId,
      }),
      migrationChainIdentity: inspection.migrationChainIdentity,
      migrationState: 'current',
    });
  } finally {
    database.close();
  }
}

async function createRealPortableBackup(input: {
  readonly backupPath: string;
  readonly databaseFilePath: string;
  readonly invoiceDocumentStorageRoot: string;
  readonly password: string;
  readonly stagingRoot: string;
}): Promise<{ migrationChainIdentity: string; profileId: string }> {
  await mkdir(input.stagingRoot, { mode: 0o700 });
  const snapshotOperationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const maintenanceState = new ProfileMaintenanceState();
  const database = createDatabaseConnection({
    databaseFilePath: input.databaseFilePath,
  });
  await maintenanceState.begin(snapshotOperationId, 5_000);
  try {
    const snapshotService = createConsistentProfileSnapshotService({
      catalog: new SqliteInvoiceBackupArtifactCatalog(database),
      database,
      invoiceDocumentStorageRoot: input.invoiceDocumentStorageRoot,
      maintenanceState,
      migrationsDirectory,
      stagingRoot: input.stagingRoot,
    });
    await snapshotService.createProfileSnapshot({
      operationId: snapshotOperationId,
      signal: new AbortController().signal,
    });
  } finally {
    maintenanceState.end(snapshotOperationId);
    database.close();
  }

  const operationRoot = join(input.stagingRoot, snapshotOperationId);
  const databaseFilePath = join(operationRoot, 'profile.sqlite');
  const inspection = inspectSqliteProfileDatabase(
    databaseFilePath,
    migrationsDirectory,
    'exactCurrentManifest',
  );
  await chmod(databaseFilePath, 0o600);
  const snapshotDatabase = createDatabaseConnection({ databaseFilePath });
  try {
    await validateProfileArtifactCatalog({
      database: snapshotDatabase,
      operationRoot,
    });
  } finally {
    snapshotDatabase.close();
  }
  await writeBackupContainer({
    destinationPath: input.backupPath,
    entries: await createProfileBackupSourceEntries(operationRoot),
    manifest: {
      appVersion,
      createdAtEpochMilliseconds: BigInt(
        new Date('2026-08-19T11:00:00.000Z').getTime(),
      ),
      ...inspection,
    },
    password: input.password,
  });
  return inspection;
}

async function createHistoricalPortableBackup(input: {
  readonly backupPath: string;
  readonly password: string;
  readonly root: string;
}): Promise<{
  readonly backupPath: string;
  readonly databaseFilePath: string;
  readonly migrationChainIdentity: string;
  readonly profileId: string;
}> {
  const historicalMigrationsDirectory = join(input.root, 'migrations');
  const operationRoot = join(input.root, 'snapshot');
  const databaseFilePath = join(operationRoot, 'profile.sqlite');
  await mkdir(historicalMigrationsDirectory, { mode: 0o700, recursive: true });
  await mkdir(operationRoot, { mode: 0o700, recursive: true });

  const currentManifest = readMigrationManifest(migrationsDirectory);
  if (currentManifest.length < 2) {
    throw new Error('HISTORICAL_MIGRATION_FIXTURE_UNAVAILABLE');
  }
  for (const migration of currentManifest.slice(0, -1)) {
    await copyFile(
      join(migrationsDirectory, migration.fileName),
      join(historicalMigrationsDirectory, migration.fileName),
    );
  }

  const database = createDatabaseConnection({ databaseFilePath });
  try {
    await runMigrations(database, {
      migrationsDirectory: historicalMigrationsDirectory,
      releaseIdentity: {
        appVersion: '0.2.5',
        buildRevision: '2'.repeat(40),
      },
    });
  } finally {
    database.close();
  }
  await writeFile(
    join(operationRoot, 'snapshot-catalog-v1.json'),
    `${JSON.stringify({ artifacts: [], formatVersion: 1 })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );

  const inspection = inspectSqliteProfileDatabase(
    databaseFilePath,
    migrationsDirectory,
    'compatibleHistoricalPrefix',
  );
  await writeBackupContainer({
    destinationPath: input.backupPath,
    entries: await createProfileBackupSourceEntries(operationRoot),
    manifest: {
      appVersion: '0.2.5',
      createdAtEpochMilliseconds: BigInt(
        new Date('2026-08-18T11:00:00.000Z').getTime(),
      ),
      ...inspection,
    },
    password: input.password,
  });

  return {
    backupPath: input.backupPath,
    databaseFilePath,
    ...inspection,
  };
}

async function importWorkspaceForSystemProof(
  coordinator: WorkspaceBackupImportCoordinator,
  input: Parameters<WorkspaceBackupImportCoordinator['import']>[0],
) {
  try {
    return await coordinator.import(input);
  } catch (error) {
    if (error instanceof WorkspaceBackupImportError) {
      throw new Error(`W3_IMPORT_${error.code}_${error.stage}`);
    }
    throw new Error('W3_IMPORT_UNEXPECTED_FAILURE');
  }
}

async function createApprovedInvoiceWithPdf(
  api: APIRequestContext,
): Promise<{ invoiceId: string }> {
  expect(
    (
      await api.put('/company-settings', {
        data: createSyntheticCompanySettingsInput(),
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await api.put('/invoice-numbering-settings', {
        data: {
          firstSequenceNumber: 1,
          fiscalYearStartMonth: 1,
          mode: 'calendarYearSequence',
          sequencePadding: 4,
        },
      })
    ).status(),
  ).toBe(200);
  const customerResponse = await api.post('/customers', {
    data: createSyntheticCustomerInput({
      customerNumber: 'E2E-IMPORT-1',
      name: 'Synthetic Workspace Import Customer Oy',
    }),
  });
  expect(customerResponse.status()).toBe(201);
  const customerBody = (await customerResponse.json()) as {
    customer: { id: string };
  };
  const draftResponse = await api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerBody.customer.id, {
      subject: 'Synthetic workspace import invoice',
    }),
  });
  expect(draftResponse.status()).toBe(201);
  const draftBody = (await draftResponse.json()) as {
    invoiceDraft: { id: string };
  };
  const approvalResponse = await api.post(
    `/invoice-drafts/${draftBody.invoiceDraft.id}/approve`,
  );
  expect(approvalResponse.status()).toBe(200);
  const approvalBody = (await approvalResponse.json()) as {
    approvedInvoice: { invoiceId: string };
  };
  const pdfResponse = await api.post(
    `/invoices/${approvalBody.approvedInvoice.invoiceId}/pdf`,
  );
  expect([200, 201]).toContain(pdfResponse.status());
  return { invoiceId: approvalBody.approvedInvoice.invoiceId };
}

function createLifecycle(events: string[]): ActiveWorkspaceLifecyclePort {
  const describe = (value: WorkspaceId | null) => value ?? 'empty';
  return {
    quiesceWrites: async (previousActiveWorkspaceId) => {
      events.push(`active.quiesce.${describe(previousActiveWorkspaceId)}`);
    },
    stopAndProveHandlesClosed: async (previousActiveWorkspaceId) => {
      events.push(`active.stop.${describe(previousActiveWorkspaceId)}`);
      return { handlesClosed: true };
    },
    ensurePreviousWorkspaceRunning: async (previousActiveWorkspaceId) => {
      events.push(`active.ensure.${describe(previousActiveWorkspaceId)}`);
    },
  };
}

function readInvoiceDocument(
  databaseFilePath: string,
  invoiceId: string,
): { sha256: string; storagePath: string } {
  const database = createDatabaseConnection({ databaseFilePath });
  try {
    const row = database
      .prepare<
        [string],
        { sha256: string; storage_path: string }
      >(
        `
          SELECT sha256, storage_path
          FROM invoice_documents
          WHERE invoice_id = ?
            AND document_type = 'approved_invoice_pdf'
        `,
      )
      .get(invoiceId);
    if (row === undefined) throw new Error('PDF_DOCUMENT_MISSING');
    return { sha256: row.sha256, storagePath: row.storage_path };
  } finally {
    database.close();
  }
}

function readMigrationCount(databaseFilePath: string): number {
  const database = createDatabaseConnection({ databaseFilePath });
  try {
    const row = database
      .prepare<[], { migration_count: number }>(
        'SELECT count(*) AS migration_count FROM schema_migrations',
      )
      .get();
    if (row === undefined) throw new Error('MIGRATION_COUNT_MISSING');
    return row.migration_count;
  } finally {
    database.close();
  }
}

function assertManagedProcessStopped(
  child: { readonly exitCode: number | null; readonly signalCode: string | null },
): void {
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
}

async function readRelativeFilePaths(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directoryPath: string): Promise<void> => {
    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      const path = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(relative(root, path).split(sep).join('/'));
      } else {
        throw new Error('UNSAFE_ARTIFACT_ENTRY');
      }
    }
  };
  await visit(root);
  return files.sort();
}

function resolveStoragePath(root: string, storagePath: string): string {
  return resolveContainedPath(root, storagePath);
}

function resolveContainedPath(root: string, logicalPath: string): string {
  const path = resolve(root, ...logicalPath.split('/'));
  const relativePath = relative(root, path);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error('PATH_OUTSIDE_ROOT');
  }
  return path;
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

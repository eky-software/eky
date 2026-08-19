import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { readMigrationManifest } from '../../../backend/src/database/migration/migrationManifest.js';
import { inspectSqliteProfileDatabase } from '../../../backend/src/runtime/profileSnapshot/inspectSqliteProfileDatabase.js';
import { InMemoryWorkspaceMaintenanceLease } from '../../../desktop/src/workspaces/maintenance/workspaceMaintenanceLease.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../../../desktop/src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../../../desktop/src/workspaces/registry/workspaceRegistryStore.js';
import type { WorkspaceId } from '../../../desktop/src/workspaces/registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../../../desktop/src/workspaces/registry/workspaceIdValidation.js';
import type { ActiveWorkspaceLifecyclePort } from '../../../desktop/src/workspaces/runtime/activeWorkspaceLifecyclePort.js';
import { PrivateWorkspaceBackupCandidateAdapter } from '../../../desktop/src/workspaces/import/privateWorkspaceBackupCandidateAdapter.js';
import { WorkspaceBackupContainerAdapter } from '../../../desktop/src/workspaces/import/workspaceBackupContainerAdapter.js';
import { WorkspaceBackupImportCoordinator } from '../../../desktop/src/workspaces/import/workspaceBackupImportCoordinator.js';
import { WorkspaceBackupImportError } from '../../../desktop/src/workspaces/import/workspaceBackupImportError.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../../../desktop/src/workspaces/import/workspaceBackupImportJournalPaths.js';
import { WorkspaceBackupImportJournalStore } from '../../../desktop/src/workspaces/import/workspaceBackupImportJournalStore.js';
import { WorkspaceBackupPlaintextQuarantine } from '../../../desktop/src/workspaces/import/workspaceBackupPlaintextQuarantine.js';
import { validateWorkspaceBackupImportOperationId } from '../../../desktop/src/workspaces/import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../../../desktop/src/workspaces/import/workspaceBackupImportPaths.js';
import { NodeWorkspaceBackupImportRootStore } from '../../../desktop/src/workspaces/import/workspaceBackupImportRootStore.js';
import {
  expect,
  test,
} from '../../src/fixtures/isolatedBackendTest.js';
import {
  createApprovedInvoiceWithPdfForWorkspaceBackup,
  createHistoricalPortableWorkspaceBackup,
  createRealPortableWorkspaceBackup,
  createWorkspaceBackupCandidateRuntimeFactory,
  readWorkspaceBackupInvoiceDocument,
  readWorkspaceBackupMigrationCount,
  resolveWorkspaceBackupStoragePath,
  sha256File,
  workspaceBackupMigrationsDirectory,
} from '../../src/workspaces/workspaceBackupSystemTestSupport.js';

const backupPassword = 'synthetic-workspace-import-password';
const operationId = validateWorkspaceBackupImportOperationId(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
);
const workspaceId = validateWorkspaceId(
  '44444444-4444-4444-8444-444444444444',
);

test('WORKSPACE-IMPORT-001 @critical @security imports a real encrypted backup with its PDF into an isolated workspace', async ({
  e2eBackend,
}) => {
  const sourceInvoice = await createApprovedInvoiceWithPdfForWorkspaceBackup(
    e2eBackend.api,
  );
  const sourceDocument = readWorkspaceBackupInvoiceDocument(
    e2eBackend.paths.databaseFilePath,
    sourceInvoice.invoiceId,
  );
  const sourcePdfPath = resolveWorkspaceBackupStoragePath(
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
  const backupIdentity = await createRealPortableWorkspaceBackup({
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
      createWorkspaceBackupCandidateRuntimeFactory(),
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
    workspaceBackupMigrationsDirectory,
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

  const importedDocument = readWorkspaceBackupInvoiceDocument(
    paths.publishedDatabaseFilePath,
    sourceInvoice.invoiceId,
  );
  expect(importedDocument).toEqual(sourceDocument);
  expect(
    await sha256File(
      resolveWorkspaceBackupStoragePath(
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

  const historical = await createHistoricalPortableWorkspaceBackup({
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
      createWorkspaceBackupCandidateRuntimeFactory(),
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
  const currentManifest = readMigrationManifest(
    workspaceBackupMigrationsDirectory,
  );
  const importedInspection = inspectSqliteProfileDatabase(
    paths.publishedDatabaseFilePath,
    workspaceBackupMigrationsDirectory,
    'exactCurrentManifest',
  );
  expect(importedInspection.profileId).toBe(historical.profileId);
  expect(importedInspection.migrationChainIdentity).not.toBe(
    historical.migrationChainIdentity,
  );
  expect(readWorkspaceBackupMigrationCount(paths.publishedDatabaseFilePath)).toBe(
    currentManifest.length,
  );
  expect(
    inspectSqliteProfileDatabase(
      historical.databaseFilePath,
      workspaceBackupMigrationsDirectory,
      'compatibleHistoricalPrefix',
    ),
  ).toEqual({
    migrationChainIdentity: historical.migrationChainIdentity,
    profileId: historical.profileId,
  });
  expect(readWorkspaceBackupMigrationCount(historical.databaseFilePath)).toBe(
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

function assertManagedProcessStopped(
  child: { readonly exitCode: number | null; readonly signalCode: string | null },
): void {
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
}

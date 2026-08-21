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
import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../data/syntheticBusinessInputs.js';

interface WorkspaceBackupCandidateMigrationInput {
  readonly artifactRoot: string;
  readonly databaseFilePath: string;
  readonly expectedProfileId: string;
  readonly expectedSourceMigrationChainIdentity: string;
  readonly importStagingRoot: string;
}

interface WorkspaceBackupCandidateValidationInput {
  readonly artifactRoot: string;
  readonly databaseFilePath: string;
  readonly expectedProfileId: string;
  readonly importStagingRoot: string;
}

interface PublishedWorkspaceBackupValidationInput {
  readonly artifactRoot: string;
  readonly databaseFilePath: string;
  readonly expectedProfileId: string;
}

interface WorkspaceBackupCandidateReadiness {
  readonly actorId: 'local-owner';
  readonly artifactRootHealth: 'ready';
  readonly companyId: string;
  readonly databaseHealth: 'healthy';
  readonly foreignKeyHealth: 'healthy';
  readonly handlesClosed: true;
  readonly lineageIdentity: Readonly<{
    readonly formatVersion: 1;
    readonly profileId: string;
  }>;
  readonly migrationChainIdentity: string;
  readonly migrationState: 'current';
}

export const workspaceBackupTestAppVersion = '0.2.6';
export const workspaceBackupMigrationsDirectory = resolve(
  import.meta.dirname,
  '../../../backend/src/database/migrations',
);

export async function createApprovedInvoiceWithPdfForWorkspaceBackup(
  api: APIRequestContext,
  overrides?: {
    readonly customerName?: string;
    readonly customerNumber?: string;
    readonly subject?: string;
  },
): Promise<{ invoiceId: string }> {
  assertHttpStatus(
    await api.put('/company-settings', {
      data: createSyntheticCompanySettingsInput(),
    }),
    [200],
    'COMPANY_SETTINGS_SETUP_FAILED',
  );
  assertHttpStatus(
    await api.put('/invoice-numbering-settings', {
      data: {
        firstSequenceNumber: 1,
        fiscalYearStartMonth: 1,
        mode: 'calendarYearSequence',
        sequencePadding: 4,
      },
    }),
    [200],
    'NUMBERING_SETUP_FAILED',
  );
  const customerResponse = await api.post('/customers', {
    data: createSyntheticCustomerInput({
      customerNumber: overrides?.customerNumber ?? 'E2E-WORKSPACE-1',
      name:
        overrides?.customerName ??
        'Synthetic Workspace Backup Customer Oy',
    }),
  });
  assertHttpStatus(customerResponse, [201], 'CUSTOMER_SETUP_FAILED');
  const customerBody = (await customerResponse.json()) as {
    customer?: { id?: unknown };
  };
  if (typeof customerBody.customer?.id !== 'string') {
    throw new Error('CUSTOMER_RESPONSE_INVALID');
  }
  const draftResponse = await api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerBody.customer.id, {
      subject:
        overrides?.subject ?? 'Synthetic workspace backup invoice',
    }),
  });
  assertHttpStatus(draftResponse, [201], 'DRAFT_SETUP_FAILED');
  const draftBody = (await draftResponse.json()) as {
    invoiceDraft?: { id?: unknown };
  };
  if (typeof draftBody.invoiceDraft?.id !== 'string') {
    throw new Error('DRAFT_RESPONSE_INVALID');
  }
  const approvalResponse = await api.post(
    `/invoice-drafts/${draftBody.invoiceDraft.id}/approve`,
  );
  assertHttpStatus(approvalResponse, [200], 'APPROVAL_SETUP_FAILED');
  const approvalBody = (await approvalResponse.json()) as {
    approvedInvoice?: { invoiceId?: unknown };
  };
  if (typeof approvalBody.approvedInvoice?.invoiceId !== 'string') {
    throw new Error('APPROVAL_RESPONSE_INVALID');
  }
  const pdfResponse = await api.post(
    `/invoices/${approvalBody.approvedInvoice.invoiceId}/pdf`,
  );
  assertHttpStatus(pdfResponse, [200, 201], 'PDF_SETUP_FAILED');
  return { invoiceId: approvalBody.approvedInvoice.invoiceId };
}

export function readWorkspaceBackupInvoiceDocument(
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

export function createWorkspaceBackupCandidateRuntimeFactory() {
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
        workspaceBackupMigrationsDirectory,
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
          migrationsDirectory: workspaceBackupMigrationsDirectory,
          releaseIdentity: {
            appVersion: workspaceBackupTestAppVersion,
            buildRevision: '3'.repeat(40),
          },
        });
      } finally {
        database.close();
      }
      return {
        stopAndProveHandlesClosed: async () => true,
        inspectStoppedMigrationResult: async () => ({
          ...inspectSqliteProfileDatabase(
            input.databaseFilePath,
            workspaceBackupMigrationsDirectory,
            'exactCurrentManifest',
          ),
          handlesClosed: true as const,
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

export async function inspectWorkspaceCandidateReadiness(input: {
  readonly artifactRoot: string;
  readonly databaseFilePath: string;
  readonly expectedProfileId: string;
}): Promise<Readonly<WorkspaceBackupCandidateReadiness>> {
  const inspection = inspectSqliteProfileDatabase(
    input.databaseFilePath,
    workspaceBackupMigrationsDirectory,
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
    if (!stringArraysEqual(actualStoragePaths, expectedStoragePaths)) {
      throw new Error('PUBLISHED_ARTIFACT_CATALOG_MISMATCH');
    }
    for (const artifact of artifacts) {
      const path = resolveWorkspaceBackupStoragePath(
        input.artifactRoot,
        artifact.storagePath,
      );
      if ((await sha256File(path)) !== artifact.sha256) {
        throw new Error('PUBLISHED_ARTIFACT_HASH_MISMATCH');
      }
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

export async function createRealPortableWorkspaceBackup(input: {
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
      migrationsDirectory: workspaceBackupMigrationsDirectory,
      stagingRoot: input.stagingRoot,
    });
    await snapshotService.createProfileSnapshot({
      migrationPolicy: 'exactCurrentManifest',
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
    workspaceBackupMigrationsDirectory,
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
      appVersion: workspaceBackupTestAppVersion,
      createdAtEpochMilliseconds: BigInt(
        new Date('2026-08-19T11:00:00.000Z').getTime(),
      ),
      ...inspection,
    },
    password: input.password,
  });
  return inspection;
}

export async function createHistoricalPortableWorkspaceBackup(input: {
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

  const currentManifest = readMigrationManifest(
    workspaceBackupMigrationsDirectory,
  );
  if (currentManifest.length < 2) {
    throw new Error('HISTORICAL_MIGRATION_FIXTURE_UNAVAILABLE');
  }
  for (const migration of currentManifest.slice(0, -1)) {
    await copyFile(
      join(workspaceBackupMigrationsDirectory, migration.fileName),
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
    workspaceBackupMigrationsDirectory,
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

export function readWorkspaceBackupMigrationCount(
  databaseFilePath: string,
): number {
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

export function resolveWorkspaceBackupStoragePath(
  root: string,
  storagePath: string,
): string {
  return resolveContainedPath(root, storagePath);
}

export async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
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
      inspectWorkspaceCandidateReadiness({
        artifactRoot: input.artifactRoot,
        databaseFilePath: input.databaseFilePath,
        expectedProfileId: input.expectedProfileId,
      }),
  };
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

function stringArraysEqual(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function assertHttpStatus(
  response: { status(): number },
  expected: readonly number[],
  errorCode: string,
): void {
  if (!expected.includes(response.status())) throw new Error(errorCode);
}

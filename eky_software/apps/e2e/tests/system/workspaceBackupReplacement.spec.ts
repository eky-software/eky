import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { createDatabaseConnection } from '../../../backend/src/database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../backend/src/database/migration/runMigrations.js';
import { InMemoryWorkspaceMaintenanceLease } from '../../../desktop/src/workspaces/maintenance/workspaceMaintenanceLease.js';
import { WorkspaceBackupPlaintextQuarantine } from '../../../desktop/src/workspaces/import/workspaceBackupPlaintextQuarantine.js';
import { PrivateWorkspaceBackupCandidateAdapter } from '../../../desktop/src/workspaces/import/privateWorkspaceBackupCandidateAdapter.js';
import { WorkspaceBackupContainerAdapter } from '../../../desktop/src/workspaces/import/workspaceBackupContainerAdapter.js';
import { deriveWorkspaceRoot } from '../../../desktop/src/workspaces/registry/deriveWorkspaceRoot.js';
import { createReadyWorkspaceEntry } from '../../../desktop/src/workspaces/registry/workspaceRegistryMutations.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../../../desktop/src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../../../desktop/src/workspaces/registry/workspaceRegistryStore.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../../../desktop/src/workspaces/registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../../../desktop/src/workspaces/registry/workspaceIdValidation.js';
import type { ActiveWorkspaceLifecyclePort } from '../../../desktop/src/workspaces/runtime/activeWorkspaceLifecyclePort.js';
import { ProfileRestoreWorkspaceReplacementActivationFactory } from '../../../desktop/src/workspaces/replacement/workspaceBackupReplacementActivationFactory.js';
import { WorkspaceBackupReplacementCoordinator } from '../../../desktop/src/workspaces/replacement/workspaceBackupReplacementCoordinator.js';
import { WorkspaceBackupReplacementError } from '../../../desktop/src/workspaces/replacement/workspaceBackupReplacementError.js';
import { validateWorkspaceBackupReplacementOperationId } from '../../../desktop/src/workspaces/replacement/workspaceBackupReplacementOperationId.js';
import { deriveWorkspaceBackupReplacementPaths } from '../../../desktop/src/workspaces/replacement/workspaceBackupReplacementPaths.js';
import { NodeWorkspaceBackupReplacementRootStore } from '../../../desktop/src/workspaces/replacement/workspaceBackupReplacementRootStore.js';
import {
  expect,
  test,
} from '../../src/fixtures/isolatedBackendTest.js';
import { createSyntheticCustomerInput } from '../../src/data/syntheticBusinessInputs.js';
import {
  createApprovedInvoiceWithPdfForWorkspaceBackup,
  createHistoricalPortableWorkspaceBackup,
  createRealPortableWorkspaceBackup,
  createWorkspaceBackupCandidateRuntimeFactory,
  inspectWorkspaceCandidateReadiness,
  readWorkspaceBackupInvoiceDocument,
  readWorkspaceBackupMigrationCount,
  resolveWorkspaceBackupStoragePath,
  sha256File,
  workspaceBackupMigrationsDirectory,
} from '../../src/workspaces/workspaceBackupSystemTestSupport.js';

const backupPassword = 'synthetic-workspace-replacement-password';
const targetWorkspaceId = validateWorkspaceId(
  '55555555-5555-4555-8555-555555555555',
);
const otherWorkspaceId = validateWorkspaceId(
  '66666666-6666-4666-8666-666666666666',
);
const operationId = validateWorkspaceBackupReplacementOperationId(
  '77777777-7777-4777-8777-777777777777',
);
const postBackupCustomerNumber = 'E2E-POST-BACKUP';

test('WORKSPACE-REPLACE-001 @critical @recovery replaces the active exact-lineage workspace from a real encrypted backup without merging newer data', async ({
  e2eBackend,
}) => {
  const sourceInvoice = await createApprovedInvoiceWithPdfForWorkspaceBackup(
    e2eBackend.api,
    { customerNumber: 'E2E-REPLACE-1' },
  );
  const sourceDocument = readWorkspaceBackupInvoiceDocument(
    e2eBackend.paths.databaseFilePath,
    sourceInvoice.invoiceId,
  );
  const sourcePdfHash = await sha256File(
    resolveWorkspaceBackupStoragePath(
      e2eBackend.paths.documentsRoot,
      sourceDocument.storagePath,
    ),
  );

  await e2eBackend.backend.stop();
  assertManagedProcessStopped(e2eBackend.backend.managedProcess.child);
  const backupPath = join(e2eBackend.runRoot, 'same-lineage-source.ekybackup');
  const backupIdentity = await createRealPortableWorkspaceBackup({
    backupPath,
    databaseFilePath: e2eBackend.paths.databaseFilePath,
    invoiceDocumentStorageRoot: e2eBackend.paths.documentsRoot,
    password: backupPassword,
    stagingRoot: join(e2eBackend.runRoot, 'same-lineage-snapshot'),
  });

  await e2eBackend.restartBackend();
  const markerResponse = await e2eBackend.api.post('/customers', {
    data: createSyntheticCustomerInput({
      customerNumber: postBackupCustomerNumber,
      name: 'Synthetic post-backup customer',
    }),
  });
  expect(markerResponse.status()).toBe(201);
  await e2eBackend.backend.stop();
  assertManagedProcessStopped(e2eBackend.backend.managedProcess.child);

  const fixture = await createReplacementSystemFixture({
    activeArtifactSourceRoot: e2eBackend.paths.documentsRoot,
    activeDatabaseSourcePath: e2eBackend.paths.databaseFilePath,
    expectedProfileId: backupIdentity.profileId,
    root: join(e2eBackend.runRoot, 'replacement-user-data'),
  });
  const before = await fixture.captureUnrelatedState();
  const activeDatabaseHashBefore = await sha256File(
    fixture.paths.activeDatabasePath,
  );
  const backupHashBefore = await sha256File(backupPath);

  await expect(
    fixture.coordinator.replace({
      containerPath: backupPath,
      password: backupPassword,
      targetWorkspaceId,
    }),
  ).resolves.toEqual({
    migrationChainIdentity: expect.stringMatching(/^[0-9a-f]{64}$/u),
    profileId: backupIdentity.profileId,
    workspaceId: targetWorkspaceId,
  });

  expect(customerNumberExists(fixture.paths.activeDatabasePath, postBackupCustomerNumber)).toBe(
    false,
  );
  const restoredDocument = readWorkspaceBackupInvoiceDocument(
    fixture.paths.activeDatabasePath,
    sourceInvoice.invoiceId,
  );
  expect(restoredDocument).toEqual(sourceDocument);
  expect(
    await sha256File(
      resolveWorkspaceBackupStoragePath(
        fixture.paths.activeArtifactRoot,
        restoredDocument.storagePath,
      ),
    ),
  ).toBe(sourcePdfHash);
  expect(await fixture.captureUnrelatedState()).toEqual(before);
  expect(await sha256File(backupPath)).toBe(backupHashBefore);
  expect(await sha256File(fixture.preRestoreDatabasePath)).toBe(
    activeDatabaseHashBefore,
  );
  expect(fixture.lifecycle.maximumBackendOwners).toBe(1);
  expect(fixture.lifecycle.maximumSqliteOwners).toBe(1);
  expect(fixture.lifecycle.backendOwners).toBe(1);
  expect(fixture.lifecycle.sqliteOwners).toBe(1);
  expect(fixture.lifecycle.sessionRotations).toBe(1);
  expect(fixture.lifecycle.events).toEqual([
    'runtime.quiesced',
    'preRestore.created',
    'runtime.stopped',
    'runtime.absent',
    'runtime.started',
    'runtime.validated',
  ]);
  await expect(readFile(fixture.paths.activationJournalPath)).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(readdir(fixture.paths.importRoot)).resolves.toEqual([]);
  await expect(readdir(fixture.paths.activationStagingRoot)).resolves.toEqual([]);
  await expect(readdir(fixture.paths.activationRollbackRoot)).resolves.toEqual([]);
});

test('WORKSPACE-REPLACE-002 @critical @recovery forward-migrates an authenticated historical same-lineage backup without changing its source', async ({
  e2eBackend,
}) => {
  await e2eBackend.backend.stop();
  assertManagedProcessStopped(e2eBackend.backend.managedProcess.child);
  const historical = await createHistoricalPortableWorkspaceBackup({
    backupPath: join(e2eBackend.runRoot, 'historical-replacement.ekybackup'),
    password: backupPassword,
    root: join(e2eBackend.runRoot, 'historical-replacement-source'),
  });
  const sourceDatabaseHash = await sha256File(historical.databaseFilePath);
  const sourceBackupHash = await sha256File(historical.backupPath);
  const activeDatabaseSourcePath = join(
    e2eBackend.runRoot,
    'historical-current-target.sqlite',
  );
  await copyPrivateFile(historical.databaseFilePath, activeDatabaseSourcePath);
  await migrateDatabaseToCurrent(activeDatabaseSourcePath);
  const emptyArtifactRoot = join(e2eBackend.runRoot, 'historical-empty-artifacts');
  await mkdir(emptyArtifactRoot, { mode: 0o700 });

  const fixture = await createReplacementSystemFixture({
    activeArtifactSourceRoot: emptyArtifactRoot,
    activeDatabaseSourcePath,
    expectedProfileId: historical.profileId,
    root: join(e2eBackend.runRoot, 'historical-replacement-user-data'),
  });

  await expect(
    fixture.coordinator.replace({
      containerPath: historical.backupPath,
      password: backupPassword,
      targetWorkspaceId,
    }),
  ).resolves.toMatchObject({
    profileId: historical.profileId,
    workspaceId: targetWorkspaceId,
  });

  const currentMigrationCount = readWorkspaceBackupMigrationCount(
    fixture.paths.activeDatabasePath,
  );
  expect(currentMigrationCount).toBeGreaterThan(
    readWorkspaceBackupMigrationCount(historical.databaseFilePath),
  );
  expect(await sha256File(historical.databaseFilePath)).toBe(
    sourceDatabaseHash,
  );
  expect(await sha256File(historical.backupPath)).toBe(sourceBackupHash);
  expect(fixture.lifecycle.backendOwners).toBe(1);
  expect(fixture.lifecycle.sqliteOwners).toBe(1);
});

test('WORKSPACE-REPLACE-003 @security rejects wrong-password and tampered containers before quiescing or changing the active workspace', async ({
  e2eBackend,
}) => {
  const sourceInvoice = await createApprovedInvoiceWithPdfForWorkspaceBackup(
    e2eBackend.api,
    { customerNumber: 'E2E-REPLACE-DENY' },
  );
  expect(sourceInvoice.invoiceId).toEqual(expect.any(String));
  await e2eBackend.backend.stop();
  assertManagedProcessStopped(e2eBackend.backend.managedProcess.child);
  const backupPath = join(e2eBackend.runRoot, 'authenticated-source.ekybackup');
  const identity = await createRealPortableWorkspaceBackup({
    backupPath,
    databaseFilePath: e2eBackend.paths.databaseFilePath,
    invoiceDocumentStorageRoot: e2eBackend.paths.documentsRoot,
    password: backupPassword,
    stagingRoot: join(e2eBackend.runRoot, 'authenticated-source-staging'),
  });
  const fixture = await createReplacementSystemFixture({
    activeArtifactSourceRoot: e2eBackend.paths.documentsRoot,
    activeDatabaseSourcePath: e2eBackend.paths.databaseFilePath,
    expectedProfileId: identity.profileId,
    root: join(e2eBackend.runRoot, 'replacement-deny-user-data'),
  });
  const activeHashBefore = await sha256File(fixture.paths.activeDatabasePath);
  const registryBefore = await readFile(fixture.registryPath);

  await expectReplacementFailure(
    fixture.coordinator.replace({
      containerPath: backupPath,
      password: 'synthetic-wrong-password',
      targetWorkspaceId,
    }),
    backupPassword,
  );

  const tamperedPath = join(e2eBackend.runRoot, 'tampered-source.ekybackup');
  const tamperedBytes = Buffer.from(await readFile(backupPath));
  const finalByteIndex = tamperedBytes.length - 1;
  const finalByte = tamperedBytes[finalByteIndex];
  if (finalByte === undefined) throw new Error('SYNTHETIC_BACKUP_EMPTY');
  tamperedBytes[finalByteIndex] = finalByte ^ 0xff;
  await writeFile(tamperedPath, tamperedBytes, { mode: 0o600 });
  await expectReplacementFailure(
    fixture.coordinator.replace({
      containerPath: tamperedPath,
      password: backupPassword,
      targetWorkspaceId,
    }),
    tamperedPath,
  );

  expect(fixture.lifecycle.events).toEqual([]);
  expect(await sha256File(fixture.paths.activeDatabasePath)).toBe(
    activeHashBefore,
  );
  expect(await readFile(fixture.registryPath)).toEqual(registryBefore);
  expect(fixture.lifecycle.backendOwners).toBe(1);
  expect(fixture.lifecycle.sqliteOwners).toBe(1);
});

interface ReplacementSystemFixtureInput {
  readonly activeArtifactSourceRoot: string;
  readonly activeDatabaseSourcePath: string;
  readonly expectedProfileId: string;
  readonly root: string;
}

async function createReplacementSystemFixture(
  input: Readonly<ReplacementSystemFixtureInput>,
) {
  await mkdir(input.root, { mode: 0o700 });
  const paths = deriveWorkspaceBackupReplacementPaths(
    input.root,
    operationId,
    targetWorkspaceId,
  );
  await copyPrivateFile(
    input.activeDatabaseSourcePath,
    paths.activeDatabasePath,
  );
  await copyPrivateTree(
    input.activeArtifactSourceRoot,
    paths.activeArtifactRoot,
  );

  const otherWorkspaceRoot = deriveWorkspaceRoot(
    input.root,
    otherWorkspaceId,
    1,
  ).workspaceRoot;
  const otherWorkspaceDatabasePath = join(
    otherWorkspaceRoot,
    'runtime',
    'data',
    'eky.sqlite',
  );
  await writePrivateFile(otherWorkspaceDatabasePath, 'other workspace');
  const registryPath = join(input.root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({
    filePath: registryPath,
    installationRoot: input.root,
  });
  const registryValue: Readonly<LocalWorkspaceRegistryV1> = Object.freeze({
    activeWorkspaceId: targetWorkspaceId,
    formatVersion: 1,
    workspaces: Object.freeze([
      createReadyWorkspaceEntry({
        createdAt: '2026-08-19T12:00:00.000Z',
        lineageIdentity: {
          formatVersion: 1,
          profileId: input.expectedProfileId,
        },
        workspaceId: targetWorkspaceId,
        workspaceLabel: 'Synthetic active workspace',
      }),
      createReadyWorkspaceEntry({
        createdAt: '2026-08-19T12:01:00.000Z',
        lineageIdentity: {
          formatVersion: 1,
          profileId: 'f'.repeat(64),
        },
        workspaceId: otherWorkspaceId,
        workspaceLabel: 'Synthetic other workspace',
      }),
    ]),
  });
  await registry.write(registryValue);

  const deviceLocalPaths = [
    join(input.root, 'runtime', 'secrets', 'company-email-smtp-v1.dat'),
    join(input.root, 'runtime', 'settings', 'invoice-pdf-archive-v1.json'),
    join(
      input.root,
      'runtime',
      'archive',
      'invoice-pdf-archive-journal-v1.json',
    ),
    join(input.root, 'update-state', 'accepted-build-v1.json'),
    join(input.root, 'update-state', 'cache', 'candidate.bin'),
    join(input.root, 'logs', 'desktop-events.jsonl'),
    join(
      input.root,
      'runtime',
      'recovery-points',
      otherWorkspaceId,
      'synthetic-point.bin',
    ),
  ];
  for (const [index, path] of deviceLocalPaths.entries()) {
    await writePrivateFile(path, `device local ${index}`);
  }

  const lifecycle = createReplacementLifecycle();
  const preRestoreRoot = join(
    input.root,
    'runtime',
    'recovery-points',
    targetWorkspaceId,
    operationId,
  );
  const preRestoreDatabasePath = join(preRestoreRoot, 'profile.sqlite');
  const plaintextQuarantine = new WorkspaceBackupPlaintextQuarantine({
    userDataRoot: input.root,
  });
  const coordinator = new WorkspaceBackupReplacementCoordinator({
    activationAuthorityFactory:
      new ProfileRestoreWorkspaceReplacementActivationFactory(),
    activeWorkspaceLifecycle: lifecycle.port,
    backupCandidate: new PrivateWorkspaceBackupCandidateAdapter(
      createWorkspaceBackupCandidateRuntimeFactory(),
    ),
    backupContainer: new WorkspaceBackupContainerAdapter({
      plaintextQuarantine,
    }),
    generateOperationId: () => operationId,
    maintenanceLease: new InMemoryWorkspaceMaintenanceLease(),
    operationGuard: {
      assertNoUnresolvedOperations: async () => undefined,
    },
    preRestoreRecoveryPoint: {
      createPreRestore: async ({ workspaceId }) => {
        expect(workspaceId).toBe(targetWorkspaceId);
        await copyPrivateFile(paths.activeDatabasePath, preRestoreDatabasePath);
        await copyPrivateTree(
          paths.activeArtifactRoot,
          join(preRestoreRoot, 'storage', 'invoices'),
        );
        lifecycle.events.push('preRestore.created');
      },
    },
    registry,
    rootStore: new NodeWorkspaceBackupReplacementRootStore(),
    runtimeReadiness: {
      assertReady: async ({ expectedProfileId, workspaceId }) => {
        expect(workspaceId).toBe(targetWorkspaceId);
        const readiness = await inspectWorkspaceCandidateReadiness({
          artifactRoot: paths.activeArtifactRoot,
          databaseFilePath: paths.activeDatabasePath,
          expectedProfileId,
        });
        if (lifecycle.backendOwners !== 1 || lifecycle.sqliteOwners !== 1) {
          throw new Error('SYNTHETIC_RUNTIME_OWNER_MISMATCH');
        }
        lifecycle.events.push('runtime.validated');
        return {
          artifactRootHealth: 'ready',
          backendOwnerCount: 1,
          databaseHealth: readiness.databaseHealth,
          foreignKeyHealth: readiness.foreignKeyHealth,
          migrationChainIdentity: readiness.migrationChainIdentity,
          profileId: readiness.lineageIdentity.profileId,
          runtimeSessionState: 'rotated',
          sqliteOwnerCount: 1,
          workspaceId,
        };
      },
    },
    userDataRoot: input.root,
    workspaceRuntimeAbsence: {
      assertNoActiveWorkspaceRuntime: async () => {
        if (lifecycle.backendOwners !== 0 || lifecycle.sqliteOwners !== 0) {
          throw new Error('SYNTHETIC_RUNTIME_STILL_PRESENT');
        }
        lifecycle.events.push('runtime.absent');
      },
    },
  });
  const unrelatedPaths = [
    registryPath,
    otherWorkspaceDatabasePath,
    ...deviceLocalPaths,
  ];

  return {
    captureUnrelatedState: async () =>
      Promise.all(unrelatedPaths.map((path) => sha256File(path))),
    coordinator,
    lifecycle,
    paths,
    preRestoreDatabasePath,
    registryPath,
  };
}

function createReplacementLifecycle() {
  const state = {
    backendOwners: 1,
    events: [] as string[],
    maximumBackendOwners: 1,
    maximumSqliteOwners: 1,
    sessionRotations: 0,
    sqliteOwners: 1,
  };
  const assertTarget = (workspaceId: WorkspaceId | null): void => {
    if (workspaceId !== targetWorkspaceId) {
      throw new Error('SYNTHETIC_TARGET_MISMATCH');
    }
  };
  const port: ActiveWorkspaceLifecyclePort = {
    quiesceWrites: async (workspaceId) => {
      assertTarget(workspaceId);
      state.events.push('runtime.quiesced');
    },
    stopAndProveHandlesClosed: async (workspaceId) => {
      assertTarget(workspaceId);
      state.backendOwners = 0;
      state.sqliteOwners = 0;
      state.events.push('runtime.stopped');
      return { handlesClosed: true };
    },
    ensurePreviousWorkspaceRunning: async (workspaceId) => {
      assertTarget(workspaceId);
      if (state.backendOwners !== 0 || state.sqliteOwners !== 0) {
        throw new Error('SYNTHETIC_DUPLICATE_OWNER');
      }
      state.backendOwners = 1;
      state.sqliteOwners = 1;
      state.maximumBackendOwners = Math.max(
        state.maximumBackendOwners,
        state.backendOwners,
      );
      state.maximumSqliteOwners = Math.max(
        state.maximumSqliteOwners,
        state.sqliteOwners,
      );
      state.sessionRotations += 1;
      state.events.push('runtime.started');
    },
  };
  return Object.assign(state, { port });
}

async function copyPrivateTree(sourceRoot: string, targetRoot: string) {
  await mkdir(targetRoot, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(targetRoot, 0o700);
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const sourcePath = join(sourceRoot, entry.name);
    const targetPath = join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      await copyPrivateTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyPrivateFile(sourcePath, targetPath);
    } else {
      throw new Error('SYNTHETIC_UNSAFE_SOURCE_ENTRY');
    }
  }
}

async function copyPrivateFile(sourcePath: string, targetPath: string) {
  await mkdir(dirname(targetPath), { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(dirname(targetPath), 0o700);
  await copyFile(sourcePath, targetPath);
  if (process.platform !== 'win32') await chmod(targetPath, 0o600);
}

async function writePrivateFile(path: string, content: string) {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(dirname(path), 0o700);
  await writeFile(path, content, { mode: 0o600 });
}

function customerNumberExists(
  databaseFilePath: string,
  customerNumber: string,
): boolean {
  const database = createDatabaseConnection({ databaseFilePath });
  try {
    const row = database
      .prepare<[string], { customer_count: number }>(
        'SELECT count(*) AS customer_count FROM customers WHERE customer_number = ?',
      )
      .get(customerNumber);
    return row?.customer_count === 1;
  } finally {
    database.close();
  }
}

async function migrateDatabaseToCurrent(
  databaseFilePath: string,
): Promise<void> {
  const database = createDatabaseConnection({ databaseFilePath });
  try {
    await runMigrations(database, {
      migrationsDirectory: workspaceBackupMigrationsDirectory,
      releaseIdentity: {
        appVersion: '0.2.6',
        buildRevision: '4'.repeat(40),
      },
    });
  } finally {
    database.close();
  }
}

async function expectReplacementFailure(
  operation: Promise<unknown>,
  forbiddenText: string,
): Promise<void> {
  try {
    await operation;
    throw new Error('EXPECTED_REPLACEMENT_FAILURE');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceBackupReplacementError);
    const replacementError = error as WorkspaceBackupReplacementError;
    expect(replacementError.code).toBe('WORKSPACE_REPLACEMENT_BACKUP_FAILED');
    expect(replacementError.stage).toBe('backupPreflight');
    expect(replacementError.message).not.toContain(forbiddenText);
    expect(replacementError.stack ?? '').not.toContain(forbiddenText);
  }
}

function assertManagedProcessStopped(
  child: { readonly exitCode: number | null; readonly signalCode: string | null },
): void {
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
}

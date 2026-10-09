import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { startDesktopComposition } from '../src/main/desktopComposition.js';
import { createDesktopProfilePaths } from '../src/runtime/desktopProfilePaths.js';
import { WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../src/workspaces/creation/workspaceCreationJournalPaths.js';
import { serializeWorkspaceCreationJournal } from '../src/workspaces/creation/workspaceCreationJournalSerializer.js';
import { WorkspaceCreationJournalStore } from '../src/workspaces/creation/workspaceCreationJournalStore.js';
import { validateWorkspaceCreationOperationId } from '../src/workspaces/creation/workspaceCreationOperationId.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../src/workspaces/import/workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from '../src/workspaces/import/workspaceBackupImportJournalSerializer.js';
import { WorkspaceBackupImportJournalStore } from '../src/workspaces/import/workspaceBackupImportJournalStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import { deriveWorkspaceRoot } from '../src/workspaces/registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import {
  createWorkspaceFirstStartProofFactories,
  createWorkspaceFirstStartProofRegistry,
  type WorkspaceFirstStartProofReservationScope,
} from './workspaceFirstStartMigrationProofFixtures.js';
import {
  assertProofSingleInstanceOwnership,
  captureUtilityProcessBaseline,
  waitForProofUtilityProcessesReleased,
} from './workspaceManagementCompositionProofRuntime.js';
import type { WorkspaceStartupRecoveryProofInput } from './workspaceStartupRecoveryProofTypes.js';

const revision = 'a'.repeat(40);

/** Real cold composition and utility validator; stop before starting another business UI. */
export async function provePublishedWorkspaceColdRecovery(
  input: Readonly<WorkspaceStartupRecoveryProofInput>,
): Promise<{ readonly publishedCreationRecovered: true; readonly publishedImportRecovered: true }> {
  const baseline = captureUtilityProcessBaseline();
  const factories = await createWorkspaceFirstStartProofFactories({
    appVersion: input.appVersion, buildRevision: revision, resourcesPath: input.resourcesPath,
  });
  try {
    for (const kind of ['creation', 'import'] as const) {
      const root = join(input.userDataRoot, kind === 'creation' ? 'c' : 'i');
      await mkdir(root, { recursive: true, mode: 0o700 });
      const registry = new WorkspaceRegistryStore({
        installationRoot: root, filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME),
      });
      const journalPath = join(root, kind === 'creation'
        ? WORKSPACE_CREATION_JOURNAL_FILE_NAME : WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
      const journal = kind === 'creation'
        ? new WorkspaceCreationJournalStore({ installationRoot: root, filePath: journalPath })
        : new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath: journalPath });
      const fixture = await factories.withWorkspaceReservation(root, async scope => {
        const original = await scope.createCurrentFixture();
        // Empty-company creation cannot already contain the import fixture's invoices.
        const target = kind === 'creation' ? await createEmptyPublishedWorkspace(scope, root)
          : await scope.createCurrentFixture();
        const initialRegistry = createWorkspaceFirstStartProofRegistry([original], original.workspaceId);
        await registry.write(initialRegistry);
        const paths = [original.databaseFilePath, original.businessArtifactPath, target.databaseFilePath,
          ...('businessArtifactPath' in target ? [target.businessArtifactPath] : [])];
        const before = await Promise.all(paths.map(path => readFile(path)));
        const value = {
          formatVersion: 2, operationId: randomUUID(), workspaceId: target.workspaceId,
          workspaceLabel: 'Synthetic interrupted workspace', previousActiveWorkspaceId: original.workspaceId,
          state: 'rootPublished', createdAt: '2026-08-21T00:01:00.000Z',
          lineageIdentity: { formatVersion: 1, profileId: target.profileId },
        };
        // A validated on-disk interruption fixture, not a new journal writer path.
        const bytes = kind === 'creation' ? serializeWorkspaceCreationJournal(value)
          : serializeWorkspaceBackupImportJournal(value);
        await writeFile(journalPath, bytes, { mode: 0o600 });
        requireProof((await journal.read())?.state === 'rootPublished', 'FIXTURE_JOURNAL');
        const expectedRegistry = {
          ...initialRegistry,
          workspaces: [...initialRegistry.workspaces, {
            workspaceId: target.workspaceId, workspaceLabel: value.workspaceLabel,
            createdAt: value.createdAt, layoutVersion: 1, lifecycleState: 'ready', lineageIdentity: value.lineageIdentity,
          }],
        };
        return { paths, before, expectedRegistry };
      });
      for (const phase of ['RECOVERED_REGISTRY', 'RESTART_IDEMPOTENCE'] as const) {
        await runColdStartupToBusinessBoundary({ ...input, userDataRoot: root });
        // Acquire before store reads, which may repair slots, not just before deletion.
        await factories.withWorkspaceReservation(root, async () => {
          requireProof((await journal.read()) === undefined
            && isDeepStrictEqual(await registry.read(), fixture.expectedRegistry), phase);
          const after = await Promise.all(fixture.paths.map(path => readFile(path)));
          requireProof(fixture.before.every((bytes, index) => bytes.equals(after[index]!)), 'ARTIFACT_PRESERVATION');
        });
      }
    }
    requireProof(await waitForProofUtilityProcessesReleased(baseline), 'PROCESS_CLEANUP');
    // Failure leaves the fixture and migration prefix available for investigation.
    await factories.cleanup();
    return { publishedCreationRecovered: true, publishedImportRecovered: true };
  } catch (error) {
    if (factories.reservationCleanupFailed) {
      throw new Error('WORKSPACE_PUBLISHED_COLD_RECOVERY_CLEANUP_FAILED', { cause: error });
    }
    throw error;
  }
}

async function createEmptyPublishedWorkspace(scope: Readonly<WorkspaceFirstStartProofReservationScope>, root: string) {
  const workspaceId = validateWorkspaceId(randomUUID());
  const workspaceRoot = deriveWorkspaceRoot(root, workspaceId, 1).workspaceRoot;
  const paths = createDesktopProfilePaths(workspaceRoot);
  await mkdir(dirname(paths.databaseFilePath), { recursive: true, mode: 0o700 });
  await mkdir(paths.invoiceDocumentStorageRoot, { recursive: true, mode: 0o700 });
  const runtime = await scope.current.start({
    artifactRoot: paths.invoiceDocumentStorageRoot, candidateRoot: workspaceRoot,
    databaseFilePath: paths.databaseFilePath, operationId: validateWorkspaceCreationOperationId(randomUUID()), workspaceId,
  });
  requireProof(await runtime.stopAndProveHandlesClosed(), 'PROCESS_CLEANUP');
  const readiness = await runtime.inspectStoppedReadiness();
  return { databaseFilePath: paths.databaseFilePath, profileId: readiness.lineageIdentity.profileId, workspaceId };
}

async function runColdStartupToBusinessBoundary(input: Readonly<WorkspaceStartupRecoveryProofInput>): Promise<void> {
  let boundaryCount = 0;
  let backendStarts = 0;
  let relaunches = 0;
  let caught: unknown;
  try {
    const lifecycle = await startDesktopComposition({
      assertSingleInstanceOwnership: assertProofSingleInstanceOwnership,
      appVersion: input.appVersion, applicationPath: process.execPath,
      buildInfo: { appVersion: input.appVersion, buildCreatedAt: '2026-08-21T00:02:00.000Z',
        buildDirty: false, buildRevision: revision, schemaVersion: 1 },
      dependencies: {
        async resolveActiveWorkspace() {
          boundaryCount += 1;
          throw new Error('SYNTHETIC_COLD_RECOVERY_BOUNDARY');
        },
        async startBackend() { backendStarts += 1; throw new Error('UNEXPECTED_PROOF_BACKEND'); },
      },
      quitApplication: () => undefined, relaunchApplication: () => { relaunches += 1; },
      releaseInfo: { appIdentity: 'Eky', appVersion: input.appVersion, architecture: 'x64',
        buildRevision: revision, msiProductVersion: input.appVersion, platform: 'win32', releaseChannel: 'pilot',
        schemaVersion: 1, upgradeCode: '11111111-1111-4111-8111-111111111111' },
      reportSmokeStage: async () => undefined, resourcesPath: input.resourcesPath, runtimeInstanceId: randomUUID(),
      smokeConfiguration: { enabled: false, phase: 'initial', root: undefined, userDataPath: undefined },
      userDataPath: input.userDataRoot,
    });
    await lifecycle?.shutdown();
  } catch (error) { caught = error; }
  if (boundaryCount === 0 && caught instanceof Error) throw caught;
  requireProof(boundaryCount === 1 && backendStarts === 0 && relaunches === 0
    && caught instanceof Error && caught.message === 'DESKTOP_START_FAILED', 'BUSINESS_BOUNDARY');
}

function requireProof(condition: boolean, stage: 'FIXTURE_JOURNAL' | 'RECOVERED_REGISTRY'
  | 'RESTART_IDEMPOTENCE' | 'ARTIFACT_PRESERVATION' | 'PROCESS_CLEANUP' | 'BUSINESS_BOUNDARY'): asserts condition {
  if (!condition) throw new Error(`WORKSPACE_PUBLISHED_COLD_RECOVERY_PROOF_${stage}_FAILED`);
}

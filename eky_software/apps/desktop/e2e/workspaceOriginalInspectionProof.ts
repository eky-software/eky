import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';

import { protocol } from 'electron';

import { startDesktopComposition, type DesktopLifecycleHandle } from '../src/main/desktopComposition.js';
import type { startDesktopBackend } from '../src/runtime/backendProcess.js';
import { createDesktopProfilePaths } from '../src/runtime/desktopProfilePaths.js';
import type { projectExceptionChain } from '../src/main/startupExceptionEvidence.js';
import { createProfileSnapshotRuntimePaths } from '../src/profileBackup/profileSnapshotRuntimePaths.js';
import { ProfileRestoreActivationJournalStore } from '../src/profileBackup/restore/profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from '../src/profileBackup/restore/profileRestoreActivationTransaction.js';
import { createWorkspaceRemnantBindingPaths } from '../src/workspaces/deletion/workspaceRemnantBindingPaths.js';
import { createReadOnlyJournalSlotPaths } from '../src/workspaces/management/mainOwnedWorkspaceManagementOperationGuard.js';
import { hasAnyJournalSlot } from '../src/workspaces/persistence/readOnlyJournalSlots.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import { createElectronE2eRuntimeSessionFactory } from './electronE2eRuntimeSession.js';
import { createWorkspaceFirstStartProofFactories, createWorkspaceFirstStartProofRegistry,
  snapshotWorkspaceFirstStartProofBusinessData } from './workspaceFirstStartMigrationProofFixtures.js';
import { assertProofSingleInstanceOwnership, captureUtilityProcessBaseline,
  waitForProofUtilityProcessesReleased } from './workspaceManagementCompositionProofRuntime.js';

export interface WorkspaceOriginalInspectionProofResult {
  readonly originalRecoveredBeforeBackend: true;
  readonly inspectionMetadataCleared: true;
  readonly journalCleared: true;
  readonly businessAndPdfPreservedAfterRestart: true;
  readonly backendExitAndReservationReleased: true;
  readonly backendStarts: 2;
}

export type WorkspaceOriginalInspectionProofReply =
  | Readonly<{ status: 'completed'; result: Readonly<WorkspaceOriginalInspectionProofResult> }>
  | Readonly<{ status: 'failed'; runtimeInstanceId: string; exception: ReturnType<typeof projectExceptionChain> }>;

/** A real Main/original-inspection path; interruption is seeded only in closed synthetic data. */
export async function runWorkspaceOriginalInspectionProof(input: Readonly<{
  applicationPath: string;
  appVersion: string;
  resourcesPath: string;
  runtimeSessionSecret: string;
  userDataRoot: string;
  startBackend: typeof startDesktopBackend;
  observeFailure(error: unknown, secrets?: readonly string[], runtimeInstanceId?: string): void;
}>): Promise<Readonly<WorkspaceOriginalInspectionProofResult>> {
  const root = await mkdtemp(join(input.userDataRoot, 'oi-'));
  const baseline = captureUtilityProcessBaseline();
  const factories = await createWorkspaceFirstStartProofFactories({
    appVersion: input.appVersion, buildRevision: 'development', resourcesPath: input.resourcesPath,
  });
  const nextSession = createElectronE2eRuntimeSessionFactory(input.runtimeSessionSecret);
  const sessions: string[] = [];
  let lifecycle: DesktopLifecycleHandle | undefined;
  let starts = 0;
  let currentRuntimeInstanceId: string | undefined;
  const exits: string[] = [];
  let failed = false;
  const observeFailure = (error: unknown, secrets: readonly string[] = [], runtimeInstanceId = currentRuntimeInstanceId) => {
    try { input.observeFailure(error, [...sessions, ...secrets], runtimeInstanceId); } catch { /* Optional private evidence. */ }
  };
  const stop = async () => {
    const current = lifecycle;
    lifecycle = undefined;
    await current?.shutdown();
    requireProof(exits.length === starts && exits.every(outcome => outcome === 'exited'), 'BACKEND_EXIT');
  };
  try {
    const fixture = await factories.withWorkspaceReservation(root, scope => scope.createCurrentFixture());
    const profile = createDesktopProfilePaths(fixture.workspaceRoot);
    const paths = createProfileSnapshotRuntimePaths(profile.runtimeRoot);
    const journal = new ProfileRestoreActivationJournalStore(paths.restoreActivationJournalPath);
    const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) });
    const registryValue = createWorkspaceFirstStartProofRegistry([fixture], fixture.workspaceId);
    const before = await snapshotWorkspaceFirstStartProofBusinessData(fixture);
    const original = await readFile(fixture.databaseFilePath);
    const originalPdf = await readFile(fixture.businessArtifactPath);
    const operationId = randomUUID();
    const bindingDirectory = createWorkspaceRemnantBindingPaths(root, {
      owner: 'profileInspection', operationId, generationId: randomUUID(),
    }).directoryPath;

    await factories.withWorkspaceReservation(root, async scope => {
      await registry.write(registryValue);
      const stagedRoot = join(paths.stagingRoot, operationId);
      const stagedDocuments = join(stagedRoot, 'activation', 'storage', 'invoices');
      await mkdir(stagedRoot, { recursive: true, mode: 0o700 });
      const candidateDatabasePath = join(stagedRoot, 'profile.sqlite');
      await copyFile(fixture.databaseFilePath, candidateDatabasePath);
      // Only the owned synthetic candidate changes; leave the original database closed and untouched.
      const candidate = new DatabaseSync(candidateDatabasePath);
      try {
        const changed = candidate.prepare('UPDATE customers SET name = ? WHERE id = ?')
          .run('Synthetic Rejected Candidate Oy', 'workspace-proof-customer');
        requireProof(changed.changes === 1, 'CANDIDATE_ROW');
      } finally { candidate.close(); }
      await cp(fixture.artifactRoot, stagedDocuments, { recursive: true, force: false, errorOnExist: true });
      // Deliberately invalid candidate PDF; rollback must recover the independent original bytes.
      const candidatePdf = join(stagedDocuments, relative(fixture.artifactRoot, fixture.businessArtifactPath));
      await writeFile(candidatePdf, '%PDF-1.7\n% SYNTHETIC_REJECTED_CANDIDATE\n', { mode: 0o600 });
      const interruption = new Error('WORKSPACE_ORIGINAL_PROOF_SYNTHETIC_INTERRUPTION');
      const transaction = new ProfileRestoreActivationTransaction({ journalStore: journal,
        paths: { activeDatabasePath: fixture.databaseFilePath, activeDocumentsRoot: fixture.artifactRoot,
          stagingRoot: paths.stagingRoot, rollbackRoot: paths.restoreRollbackRoot, failedRoot: paths.restoreFailedRoot },
        afterPhasePersisted(phase) { if (phase === 'rollbackStarting') throw interruption; },
      });
      await transaction.prepare(operationId, scope.assertMainOwned, undefined, scope.assertCurrent);
      const prepared = await journal.peek();
      requireProof(prepared !== undefined, 'SEEDED_PHASE');
      const activated = await transaction.advanceToValidation(prepared, scope.assertMainOwned);
      let interrupted = false;
      try { await transaction.rollback(activated, scope.assertMainOwned); }
      catch (error) { if (error !== interruption) throw error; interrupted = true; }
      requireProof(interrupted && (await journal.peek())?.phase === 'rollbackStarting', 'SEEDED_PHASE');
      requireProof(!(await readFile(fixture.databaseFilePath)).equals(original), 'CANDIDATE_DATABASE_DIFFERS');
      requireProof(!(await readFile(fixture.businessArtifactPath)).equals(originalPdf), 'CANDIDATE_DIFFERS');
      let missing = false;
      try { await readdir(bindingDirectory); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; missing = true; }
      requireProof(missing, 'INITIAL_INSPECTION_METADATA');
      await scope.assertMainOwned();
    });

    for (const phase of ['rollback', 'restart'] as const) {
      protocol.unhandle('eky');
      const runtimeInstanceId = randomUUID();
      currentRuntimeInstanceId = runtimeInstanceId;
      lifecycle = await startDesktopComposition({
        assertSingleInstanceOwnership: assertProofSingleInstanceOwnership,
        appVersion: input.appVersion, applicationPath: input.applicationPath,
        buildInfo: { appVersion: input.appVersion, buildCreatedAt: '2026-10-30T00:00:00.000Z',
          buildDirty: false, buildRevision: 'development', schemaVersion: 1 },
        dependencies: {
          createRuntimeSession() { const value = nextSession(); sessions.push(value); return value; },
          async startBackend(options) {
            requireProof(options.config.databaseFilePath === fixture.databaseFilePath, 'BACKEND_TARGET');
            requireProof((await readFile(fixture.databaseFilePath)).equals(original), 'ORIGINAL_DATABASE');
            requireProof((await readFile(fixture.businessArtifactPath)).equals(originalPdf), 'ORIGINAL_PDF');
            // The directory was absent before startup. It must now exist with every binding slot retired.
            requireProof((await readdir(bindingDirectory)).length === 0, 'INSPECTION_METADATA');
            requireProof(phase !== 'rollback' || (await journal.peek())?.phase === 'rolledBack', 'ROLLBACK_BEFORE_BACKEND');
            starts += 1;
            const backend = await input.startBackend(options);
            return { ...backend, assertRunning: backend.assertRunning.bind(backend), async stop() {
              const outcome = await backend.stop(); exits.push(outcome); return outcome;
            } };
          },
        },
        observeStartupException: (error, _stage, secrets) => observeFailure(error, secrets, runtimeInstanceId),
        quitApplication() {}, relaunchApplication() { throw new Error('WORKSPACE_ORIGINAL_PROOF_UNEXPECTED_RELAUNCH'); },
        reportSmokeStage: async () => undefined, releaseInfo: undefined,
        resourcesPath: input.resourcesPath, runtimeInstanceId,
        smokeConfiguration: { enabled: false, phase: 'initial', root: undefined, userDataPath: undefined },
        userDataPath: root,
      });
      requireProof(lifecycle !== undefined, 'LIFECYCLE');
      await stop();
      await factories.withWorkspaceReservation(root, async scope => {
        requireProof(!await hasAnyJournalSlot(createReadOnlyJournalSlotPaths(paths.restoreActivationJournalPath)), 'JOURNAL');
        requireProof((await readdir(bindingDirectory)).length === 0, 'INSPECTION_METADATA');
        requireProof(isDeepStrictEqual(await registry.inspect(), registryValue), 'REGISTRY');
        requireProof(isDeepStrictEqual(await snapshotWorkspaceFirstStartProofBusinessData(fixture), before), 'BUSINESS_SNAPSHOT');
        requireProof((await readFile(fixture.databaseFilePath)).equals(original) &&
          (await readFile(fixture.businessArtifactPath)).equals(originalPdf), 'PRESERVED_BYTES');
        await scope.assertMainOwned();
      });
    }
    requireProof(starts === 2 && sessions.length === 2 && sessions[0] !== sessions[1], 'RUNTIME_GENERATIONS');
    requireProof(await waitForProofUtilityProcessesReleased(baseline), 'UTILITY_EXIT');
    await factories.cleanup();
    await rm(root, { recursive: true, force: true });
    return Object.freeze({ originalRecoveredBeforeBackend: true, inspectionMetadataCleared: true,
      journalCleared: true, businessAndPdfPreservedAfterRestart: true,
      backendExitAndReservationReleased: true, backendStarts: 2 });
  } catch (error) { failed = true; observeFailure(error); throw error; }
  finally {
    if (lifecycle !== undefined) {
      try { await stop(); } catch (error) { observeFailure(error); if (!failed) throw error; }
    }
    // Failed or uncertain work retains the fixture and its original failure evidence.
  }
}

function requireProof(condition: boolean, phase: string): asserts condition {
  if (!condition) throw new Error(`WORKSPACE_ORIGINAL_INSPECTION_PROOF_${phase}_FAILED`);
}

import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { protocol } from 'electron';

import { startDesktopComposition, type DesktopLifecycleHandle } from '../src/main/desktopComposition.js';
import type { startDesktopBackend, DesktopBackendHandle } from '../src/runtime/backendProcess.js';
import type { projectExceptionChain } from '../src/main/startupExceptionEvidence.js';
import { createDesktopProfilePaths } from '../src/runtime/desktopProfilePaths.js';
import { WorkspaceLegacyAdoptionJournalStore } from '../src/workspaces/adoption/workspaceLegacyAdoptionJournal.js';
import { WorkspaceRemnantBindingStore } from '../src/workspaces/deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey, type WorkspaceRemnantBindingV1 } from '../src/workspaces/deletion/workspaceRemnantBindingCodec.js';
import type { WorkspaceRemnantBindingAuthority } from '../src/workspaces/deletion/workspaceRemnantBindingStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import { resolveActiveWorkspaceStartup, type ActiveWorkspaceStartupSelection } from '../src/workspaces/runtime/resolveActiveWorkspaceStartup.js';
import { createElectronE2eRuntimeSessionFactory } from './electronE2eRuntimeSession.js';
import { createWorkspaceFirstStartProofFactories, snapshotWorkspaceFirstStartProofBusinessData } from './workspaceFirstStartMigrationProofFixtures.js';
import { assertProofSingleInstanceOwnership, captureUtilityProcessBaseline, waitForProofUtilityProcessesReleased } from './workspaceManagementCompositionProofRuntime.js';

export interface WorkspaceAdoptionAcceptanceProofResult {
  readonly registryAbsentBeforeBackend: true;
  readonly bindingMatchesAcceptedProfile: true;
  readonly journalCleared: true;
  readonly sourceBytesPreserved: true;
  readonly businessAndPdfPreservedAfterRestart: true;
  readonly backendExitAndReservationReleased: true;
  readonly backendStarts: 2;
}

export type WorkspaceAdoptionAcceptanceProofReply =
  | Readonly<{ status: 'completed'; result: Readonly<WorkspaceAdoptionAcceptanceProofResult> }>
  | Readonly<{ status: 'failed'; runtimeInstanceId: string; exception: ReturnType<typeof projectExceptionChain> }>;

export async function runWorkspaceAdoptionAcceptanceProof(input: Readonly<{
  applicationPath: string;
  appVersion: string;
  resourcesPath: string;
  runtimeSessionSecret: string;
  userDataRoot: string;
  startBackend: typeof startDesktopBackend;
  observeFailure(error: unknown, secrets?: readonly string[], runtimeInstanceId?: string): void;
}>): Promise<Readonly<WorkspaceAdoptionAcceptanceProofResult>> {
  const proofRoot = await mkdtemp(join(input.userDataRoot, 'ad-'));
  const root = join(proofRoot, 'target');
  const baseline = captureUtilityProcessBaseline();
  const factories = await createWorkspaceFirstStartProofFactories({
    appVersion: input.appVersion, buildRevision: 'development', resourcesPath: input.resourcesPath,
  });
  const sessions: string[] = [];
  const nextSession = createElectronE2eRuntimeSessionFactory(input.runtimeSessionSecret);
  let lifecycle: DesktopLifecycleHandle | undefined;
  let selection: Readonly<ActiveWorkspaceStartupSelection> | undefined;
  let activeBackend: DesktopBackendHandle | undefined;
  let expectedBinding: WorkspaceRemnantBindingV1 | undefined;
  let starts = 0;
  const exits: string[] = [];
  let failed = false;
  const observeFailure = (error: unknown, secrets: readonly string[] = [], runtimeInstanceId?: string) => {
    try { input.observeFailure(error, [...sessions, ...secrets], runtimeInstanceId); } catch { /* Optional private evidence. */ }
  };
  const stop = async () => {
    const current = lifecycle;
    lifecycle = undefined;
    await current?.shutdown();
    requireProof(exits.length === starts && exits.every(outcome => outcome === 'exited'), 'BACKEND_EXIT');
  };
  try {
    const seedRoot = join(proofRoot, 'seed');
    await mkdir(seedRoot, { mode: 0o700 });
    const seed = await factories.withWorkspaceReservation(seedRoot, scope => scope.createCurrentFixture());
    const before = await snapshotWorkspaceFirstStartProofBusinessData(seed);
    const legacy = createDesktopProfilePaths(root);
    await mkdir(dirname(legacy.databaseFilePath), { recursive: true, mode: 0o700 });
    await mkdir(dirname(legacy.invoiceDocumentStorageRoot), { recursive: true, mode: 0o700 });
    // Copy only closed authoritative bytes, never the seed's registry or workspace roots.
    await copyFile(seed.databaseFilePath, legacy.databaseFilePath);
    await cp(seed.artifactRoot, legacy.invoiceDocumentStorageRoot, { recursive: true, force: false, errorOnExist: true });
    const legacyPdf = join(legacy.invoiceDocumentStorageRoot, relative(seed.artifactRoot, seed.businessArtifactPath));
    const sourceFiles = [legacy.databaseFilePath, legacyPdf];
    const sourceBytes = await Promise.all(sourceFiles.map(path => readFile(path)));
    const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) });
    const journal = new WorkspaceLegacyAdoptionJournalStore(root);
    requireProof(await registry.inspect() === undefined, 'INITIAL_REGISTRY');
    const assertAcceptedMetadata = async (selected: Readonly<ActiveWorkspaceStartupSelection>, authority: WorkspaceRemnantBindingAuthority) => {
      authority.assertAuthority();
      const published = await registry.inspect();
      requireProof(published?.activeWorkspaceId === selected.workspaceId && published.workspaces.length === 1
        && published.workspaces[0]?.lineageIdentity.profileId === seed.profileId, 'REGISTRY_LINEAGE');
      const observed = await journal.inspectRecoverySelection(authority.assertAuthority);
      requireProof(observed.bytes === undefined && Object.values(observed.identities).every(identity => identity === undefined), 'JOURNAL');
      requireProof(expectedBinding !== undefined, 'ADOPTION_CONTEXT');
      const binding = await new WorkspaceRemnantBindingStore(root, workspaceRemnantBindingKey(expectedBinding)).inspect(authority);
      requireProof(binding.mode === 'published' && isDeepStrictEqual(binding.value, expectedBinding)
        && binding.slots.next === undefined && binding.slots.backup === undefined, 'BINDING');
      await authority.assertExternalSelection();
      authority.assertAuthority();
    };

    for (const phase of ['adoption', 'normal'] as const) {
      protocol.unhandle('eky');
      const runtimeInstanceId = randomUUID();
      lifecycle = await startDesktopComposition({
        assertSingleInstanceOwnership: assertProofSingleInstanceOwnership,
        appVersion: input.appVersion, applicationPath: input.applicationPath,
        buildInfo: { appVersion: input.appVersion, buildCreatedAt: '2026-10-30T00:00:00.000Z',
          buildDirty: false, buildRevision: 'development', schemaVersion: 1 },
        releaseInfo: undefined,
        dependencies: {
          createRuntimeSession() { const value = nextSession(); sessions.push(value); return value; },
          async resolveActiveWorkspace(userDataRoot, options) {
            const resolved = await resolveActiveWorkspaceStartup(userDataRoot, options);
            requireProof(resolved.mode === phase, 'STARTUP_MODE');
            selection = resolved;
            return resolved;
          },
          async startBackend(options) {
            if (starts === 0) requireProof(await registry.inspect() === undefined, 'EARLY_PUBLICATION');
            starts += 1;
            const backend = await input.startBackend(options);
            activeBackend = backend;
            return {
              ...backend,
              assertRunning: backend.assertRunning.bind(backend),
              async stop() {
                const outcome = await backend.stop();
                exits.push(outcome);
                return outcome;
              },
            };
          },
        },
        observeStartupException: (error, _stage, secrets) => observeFailure(error, secrets, runtimeInstanceId),
        quitApplication() {}, relaunchApplication() { throw new Error('WORKSPACE_ADOPTION_PROOF_UNEXPECTED_RELAUNCH'); },
        reportSmokeStage: async () => undefined, resourcesPath: input.resourcesPath, runtimeInstanceId,
        smokeConfiguration: { enabled: false, phase: 'initial', root: undefined, userDataPath: undefined },
        userDataPath: root,
      });
      requireProof(lifecycle !== undefined && selection !== undefined, 'LIFECYCLE');
      const selected = selection;
      if (phase === 'adoption') {
        const context = selected.adoptionContext;
        requireProof(context !== undefined && context.sourceKind === 'legacy', 'ADOPTION_CONTEXT');
        expectedBinding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceLegacyAdoption',
          operationId: context.operationId, workspaceId: selected.workspaceId,
          lineageIdentity: { formatVersion: 1, profileId: seed.profileId } });
      }
      const backend = activeBackend;
      requireProof(backend !== undefined, 'LIFECYCLE');
      const assertLive = () => { assertProofSingleInstanceOwnership(); backend.assertRunning(); };
      // Publication must already be complete with the real backend still live.
      await assertAcceptedMetadata(selected, { assertAuthority: assertLive,
        async assertExternalSelection() { assertLive(); } });
      await stop();
      // Reacquisition proves physical release, not merely a zero observer counter.
      await factories.withWorkspaceReservation(root, async scope => {
        await assertAcceptedMetadata(selected, { assertAuthority: scope.assertCurrent, assertExternalSelection: scope.assertMainOwned });
        const paths = createDesktopProfilePaths(selected.workspaceRoot);
        const after = await snapshotWorkspaceFirstStartProofBusinessData({ ...seed,
          workspaceRoot: selected.workspaceRoot, databaseFilePath: paths.databaseFilePath,
          artifactRoot: paths.invoiceDocumentStorageRoot,
          businessArtifactPath: join(paths.invoiceDocumentStorageRoot, relative(seed.artifactRoot, seed.businessArtifactPath)),
        });
        requireProof(isDeepStrictEqual(before, after), 'BUSINESS_SNAPSHOT');
        const remaining = await Promise.all(sourceFiles.map(path => readFile(path)));
        requireProof(sourceBytes.every((bytes, index) => bytes.equals(remaining[index]!)), 'SOURCE_BYTES');
      });
    }
    requireProof(starts === 2 && sessions.length === 2 && sessions[0] !== sessions[1], 'RUNTIME_GENERATIONS');
    requireProof(await waitForProofUtilityProcessesReleased(baseline), 'UTILITY_EXIT');
    await factories.cleanup();
    await rm(proofRoot, { recursive: true, force: true });
    return Object.freeze({ registryAbsentBeforeBackend: true, bindingMatchesAcceptedProfile: true,
      journalCleared: true, sourceBytesPreserved: true, businessAndPdfPreservedAfterRestart: true,
      backendExitAndReservationReleased: true, backendStarts: 2 });
  } catch (error) {
    failed = true;
    observeFailure(error);
    throw error;
  } finally {
    if (lifecycle !== undefined) {
      try { await stop(); }
      catch (error) { observeFailure(error); if (!failed) throw error; }
    }
    // Uncertain or failed work retains its source and destination evidence.
  }
}

function requireProof(condition: boolean, phase: string): asserts condition {
  if (!condition) throw new Error(`WORKSPACE_ADOPTION_ACCEPTANCE_PROOF_${phase}_FAILED`);
}

import { randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';

import { protocol } from 'electron';

import {
  startDesktopComposition,
  type DesktopLifecycleHandle,
} from '../src/main/desktopComposition.js';
import { createDesktopProfilePaths } from '../src/runtime/desktopProfilePaths.js';
import type {
  DesktopBackendHandle,
  StartDesktopBackendOptions,
} from '../src/runtime/backendProcess.js';
import type { DesktopReleaseInfo } from '../src/release/desktopReleaseInfo.js';
import { AcceptedBuildMetadataStore } from '../src/update/acceptedBuildMetadataStore.js';
import { DirectSetupMigrationRecoveryStore } from '../src/update/directSetupMigrationRecoveryStore.js';
import { createLocalUpdateRuntimePaths } from '../src/update/localUpdateRuntimePaths.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../src/workspaces/registry/workspaceRegistryTypes.js';
import { WorkspaceFirstStartMigrationJournalStore } from '../src/workspaces/update/workspaceFirstStartMigrationJournalStore.js';
import {
  corruptWorkspaceFirstStartProofDatabase,
  createWorkspaceFirstStartProofFactories,
  createWorkspaceFirstStartProofFixture,
  createWorkspaceFirstStartProofRegistry,
  inspectWorkspaceFirstStartProofFixture,
  snapshotWorkspaceFirstStartProofDirectory,
  snapshotWorkspaceFirstStartProofFile,
  workspaceFirstStartProofSnapshotsEqual,
  type WorkspaceFirstStartProofFactories,
  type WorkspaceFirstStartProofFixture,
} from './workspaceFirstStartMigrationProofFixtures.js';
import type {
  WorkspaceFirstStartMigrationProofInput,
  WorkspaceFirstStartMigrationProofResult,
} from './workspaceFirstStartMigrationProofTypes.js';
import {
  captureUtilityProcessBaseline,
  waitForProofUtilityProcessesReleased,
} from './workspaceManagementCompositionProofRuntime.js';

const sourceBuildRevision = 'a'.repeat(40);
const targetBuildRevision = 'b'.repeat(40);
const proofUpgradeCode = '11111111-1111-4111-8111-111111111111';

type ProofStage =
  | 'setup'
  | 'mixedActiveFixture'
  | 'mixedCompatibleFixture'
  | 'mixedInvalidFixture'
  | 'mixedStores'
  | 'mixedSnapshotsBefore'
  | 'mixedStartup'
  | 'mixedRuntimeReadback'
  | 'mixedShutdown'
  | 'mixedActiveInspection'
  | 'mixedCompatibleInspection'
  | 'mixedInvalidInspection'
  | 'mixedSnapshotsAfter'
  | 'mixedRestart'
  | 'mixedComplete'
  | 'allCurrentFixtures'
  | 'allCurrentStores'
  | 'allCurrentSnapshotsBefore'
  | 'allCurrentStartup'
  | 'allCurrentRuntimeReadback'
  | 'allCurrentShutdown'
  | 'allCurrentSnapshotsAfter'
  | 'allCurrentRestart'
  | 'allCurrentComplete'
  | 'cleanup';

interface ProofProgress {
  readonly stage: ProofStage;
  checkpoint(checkpoint: ProofCheckpoint): Promise<void>;
  enter(stage: ProofStage): Promise<void>;
}

type ProofShutdownCheckpoint =
  | 'lifecycleShutdownCompleted'
  | 'windowCleanupDeferred'
  | 'protocolUnregistered';

type ProofCheckpoint = ProofShutdownCheckpoint;

interface ProofBuildIdentity {
  readonly sourceVersion: string;
  readonly targetRelease: Readonly<DesktopReleaseInfo>;
}

interface BackendProofTracker {
  readonly activeHandles: Set<DesktopBackendHandle>;
  startCount: number;
}

interface MixedScenarioResult {
  readonly activePointerPreserved: boolean;
  readonly artifactRootsPreserved: boolean;
  readonly directSetupRecoveryCleared: boolean;
  readonly exactAcceptedRestartSkippedInventory: boolean;
  readonly invalidPassiveWorkspaceQuarantined: boolean;
  readonly migrationJournalCleared: boolean;
  readonly mixedActiveWorkspaceMigrated: boolean;
  readonly passiveCompatibleWorkspacePreserved: boolean;
  readonly preparedBeforeBackend: boolean;
  readonly targetAcceptedAfterRegistryTransition: boolean;
}

interface AllCurrentScenarioResult {
  readonly allCurrentCompletedWithoutJournal: boolean;
  readonly acceptedSourceBuildBeforeBackend: boolean;
  readonly acceptedTargetBuildAfterBackend: boolean;
  readonly allCurrentRegistryPreserved: boolean;
  readonly artifactRootsPreserved: boolean;
  readonly directSetupRecoveryCleared: boolean;
  readonly exactAcceptedRestartSkippedInventory: boolean;
  readonly journalAbsentAfterBackend: boolean;
  readonly journalAbsentBeforeBackend: boolean;
  readonly migrationJournalCleared: boolean;
  readonly registryPreservedBeforeBackend: boolean;
}

export async function runWorkspaceFirstStartMigrationProof(
  input: Readonly<WorkspaceFirstStartMigrationProofInput>,
): Promise<Readonly<WorkspaceFirstStartMigrationProofResult>> {
  await mkdir(input.userDataRoot, { mode: 0o700, recursive: true });
  const proofRoot = await mkdtemp(
    join(input.userDataRoot, 'w6-'),
  );
  const utilityProcessBaseline = captureUtilityProcessBaseline();
  const build = createProofBuildIdentity(input.appVersion);
  const tracker: BackendProofTracker = {
    activeHandles: new Set(),
    startCount: 0,
  };
  let factories: Readonly<WorkspaceFirstStartProofFactories> | undefined;
  const progress = createProofProgress(join(proofRoot, 'progress.jsonl'));

  try {
    await progress.enter('setup');
    factories = await createWorkspaceFirstStartProofFactories({
      appVersion: build.sourceVersion,
      buildRevision: sourceBuildRevision,
      resourcesPath: input.resourcesPath,
    });

    const mixed = await proveMixedScenario({
      build,
      factories,
      input,
      progress,
      proofRoot: join(proofRoot, 'm'),
      tracker,
    });

    const allCurrent = await proveAllCurrentScenario({
      build,
      factories,
      input,
      progress,
      proofRoot: join(proofRoot, 'c'),
      tracker,
    });
    requireAllCurrentScenarioResult(allCurrent);

    await progress.enter('cleanup');
    unregisterApplicationProtocol();
    const candidateProcessesReleased =
      await waitForProofUtilityProcessesReleased(utilityProcessBaseline);
    const result = Object.freeze({
      activePointerPreserved: mixed.activePointerPreserved,
      allCurrentCompletedWithoutJournal:
        allCurrent.allCurrentCompletedWithoutJournal,
      allCurrentRegistryPreserved: allCurrent.allCurrentRegistryPreserved,
      artifactRootsPreserved:
        mixed.artifactRootsPreserved && allCurrent.artifactRootsPreserved,
      backendStartCount: tracker.startCount,
      backendStoppedAfterProof: tracker.activeHandles.size === 0,
      candidateProcessesReleased,
      directSetupRecoveryCleared:
        mixed.directSetupRecoveryCleared &&
        allCurrent.directSetupRecoveryCleared,
      exactAcceptedRestartSkippedInventory:
        mixed.exactAcceptedRestartSkippedInventory &&
        allCurrent.exactAcceptedRestartSkippedInventory,
      invalidPassiveWorkspaceQuarantined:
        mixed.invalidPassiveWorkspaceQuarantined,
      migrationJournalCleared:
        mixed.migrationJournalCleared && allCurrent.migrationJournalCleared,
      mixedActiveWorkspaceMigrated: mixed.mixedActiveWorkspaceMigrated,
      passiveCompatibleWorkspacePreserved:
        mixed.passiveCompatibleWorkspacePreserved,
      preparedBeforeBackend: mixed.preparedBeforeBackend,
      relaunchCount: 0,
      targetAcceptedAfterRegistryTransition:
        mixed.targetAcceptedAfterRegistryTransition,
    });
    requireProofResult(result);
    return result;
  } catch (error) {
    throw new Error(
      `WORKSPACE_FIRST_START_MIGRATION_PROOF_FAILED_${progress.stage.toUpperCase()}_${readSafeErrorCode(error)}`,
    );
  } finally {
    unregisterApplicationProtocol();
    await stopTrackedBackends(tracker);
    await factories?.cleanup().catch(() => undefined);
    await rm(proofRoot, { force: true, recursive: true }).catch(
      () => undefined,
    );
  }
}

async function proveMixedScenario(input: {
  readonly build: Readonly<ProofBuildIdentity>;
  readonly factories: Readonly<WorkspaceFirstStartProofFactories>;
  readonly input: Readonly<WorkspaceFirstStartMigrationProofInput>;
  readonly progress: ProofProgress;
  readonly proofRoot: string;
  readonly tracker: BackendProofTracker;
}): Promise<Readonly<MixedScenarioResult>> {
  await mkdir(input.proofRoot, { mode: 0o700, recursive: true });
  await input.progress.enter('mixedActiveFixture');
  const active = await createWorkspaceFirstStartProofFixture({
    factory: input.factories.historical,
    userDataRoot: input.proofRoot,
  });
  await input.progress.enter('mixedCompatibleFixture');
  const compatiblePassive = await createWorkspaceFirstStartProofFixture({
    factory: input.factories.historical,
    userDataRoot: input.proofRoot,
  });
  await input.progress.enter('mixedInvalidFixture');
  const invalidPassive = await createWorkspaceFirstStartProofFixture({
    factory: input.factories.current,
    userDataRoot: input.proofRoot,
  });
  await corruptWorkspaceFirstStartProofDatabase(invalidPassive);
  const fixtures = [active, compatiblePassive, invalidPassive] as const;
  await input.progress.enter('mixedStores');
  const stores = await createProofStores({
    activeWorkspaceId: active.workspaceId,
    fixtures,
    proofRoot: input.proofRoot,
    sourceVersion: input.build.sourceVersion,
  });
  await input.progress.enter('mixedSnapshotsBefore');
  const activeBefore = await snapshotWorkspaceFirstStartProofFile(
    active.databaseFilePath,
  );
  const compatibleBefore = await snapshotWorkspaceFirstStartProofFile(
    compatiblePassive.databaseFilePath,
  );
  const invalidBefore = await snapshotWorkspaceFirstStartProofFile(
    invalidPassive.databaseFilePath,
  );
  const artifactRootsBefore = await snapshotArtifactRoots(fixtures);
  let preparedBeforeBackend = false;

  let firstLifecycle: DesktopLifecycleHandle;
  try {
    await input.progress.enter('mixedStartup');
    firstLifecycle = await startProofComposition({
      beforeBackendStart: async () => {
        const [journal, acceptedBuild, registry, activeAtGate] =
          await Promise.all([
            stores.journal.read(),
            stores.acceptedBuild.read(),
            stores.registry.read(),
            snapshotWorkspaceFirstStartProofFile(active.databaseFilePath),
          ]);
        preparedBeforeBackend =
          journal?.state === 'prepared' &&
          acceptedBuild?.appVersion === input.build.sourceVersion &&
          workspaceFirstStartProofSnapshotsEqual(
            registry,
            stores.registryBefore,
          ) &&
          workspaceFirstStartProofSnapshotsEqual(activeAtGate, activeBefore);
      },
      build: input.build,
      input: input.input,
      tracker: input.tracker,
      userDataPath: input.proofRoot,
    });
  } catch (error) {
    const recoveryPointErrorCode =
      await readLatestRecoveryPointFailureCode(input.proofRoot);
    if (recoveryPointErrorCode !== undefined) {
      throw new Error(
        `DESKTOP_SMOKE_WORKSPACE_FIRST_START_RECOVERY_POINT_${recoveryPointErrorCode}`,
      );
    }
    throw error;
  }
  await input.progress.enter('mixedRuntimeReadback');
  const registryAfter = await stores.registry.read();
  const acceptedAfter = await stores.acceptedBuild.read();
  const journalAfter = await stores.journal.read();
  const directSetupAfter = await stores.directSetup.read();
  await input.progress.enter('mixedShutdown');
  await stopProofComposition(firstLifecycle, (checkpoint) =>
    input.progress.checkpoint(checkpoint),
  );

  await input.progress.enter('mixedActiveInspection');
  const activeInspection = await inspectWorkspaceFirstStartProofFixture(
    input.factories.current,
    active,
  );
  await input.progress.enter('mixedCompatibleInspection');
  const compatibleInspection = await inspectWorkspaceFirstStartProofFixture(
    input.factories.current,
    compatiblePassive,
  );
  await input.progress.enter('mixedInvalidInspection');
  const invalidInspection = await inspectWorkspaceFirstStartProofFixture(
    input.factories.current,
    invalidPassive,
  );
  await input.progress.enter('mixedSnapshotsAfter');
  const activeAfter = await snapshotWorkspaceFirstStartProofFile(
    active.databaseFilePath,
  );
  const compatibleAfter = await snapshotWorkspaceFirstStartProofFile(
    compatiblePassive.databaseFilePath,
  );
  const invalidAfter = await snapshotWorkspaceFirstStartProofFile(
    invalidPassive.databaseFilePath,
  );
  const artifactRootsAfter = await snapshotArtifactRoots(fixtures);

  await input.progress.enter('mixedRestart');
  const exactRestartSkippedInventory = await runExactAcceptedRestart({
    build: input.build,
    factories: input.factories,
    input: input.input,
    tracker: input.tracker,
    userDataPath: input.proofRoot,
  });
  const registryAfterRestart = await stores.registry.read();

  const compatibleRegistryEntry = registryAfter?.workspaces.find(
    (entry) => entry.workspaceId === compatiblePassive.workspaceId,
  );
  const invalidRegistryEntry = registryAfter?.workspaces.find(
    (entry) => entry.workspaceId === invalidPassive.workspaceId,
  );
  await input.progress.enter('mixedComplete');
  return Object.freeze({
    activePointerPreserved:
      registryAfter?.activeWorkspaceId === active.workspaceId &&
      registryAfterRestart?.activeWorkspaceId === active.workspaceId,
    artifactRootsPreserved: workspaceFirstStartProofSnapshotsEqual(
      artifactRootsBefore,
      artifactRootsAfter,
    ),
    directSetupRecoveryCleared:
      directSetupAfter === undefined &&
      (await stores.directSetup.read()) === undefined,
    exactAcceptedRestartSkippedInventory: exactRestartSkippedInventory,
    invalidPassiveWorkspaceQuarantined:
      invalidInspection.status === 'invalidHistory' &&
      invalidRegistryEntry?.lifecycleState === 'recoveryRequired' &&
      workspaceFirstStartProofSnapshotsEqual(invalidBefore, invalidAfter),
    migrationJournalCleared:
      journalAfter === undefined && (await stores.journal.read()) === undefined,
    mixedActiveWorkspaceMigrated:
      activeInspection.status === 'current' &&
      !workspaceFirstStartProofSnapshotsEqual(activeBefore, activeAfter),
    passiveCompatibleWorkspacePreserved:
      compatibleInspection.status === 'compatiblePending' &&
      compatibleRegistryEntry?.lifecycleState === 'ready' &&
      workspaceFirstStartProofSnapshotsEqual(
        compatibleBefore,
        compatibleAfter,
      ),
    preparedBeforeBackend,
    targetAcceptedAfterRegistryTransition:
      acceptedAfter?.appVersion === input.build.targetRelease.appVersion &&
      invalidRegistryEntry?.lifecycleState === 'recoveryRequired' &&
      compatibleRegistryEntry?.lifecycleState === 'ready',
  });
}

async function proveAllCurrentScenario(input: {
  readonly build: Readonly<ProofBuildIdentity>;
  readonly factories: Readonly<WorkspaceFirstStartProofFactories>;
  readonly input: Readonly<WorkspaceFirstStartMigrationProofInput>;
  readonly progress: ProofProgress;
  readonly proofRoot: string;
  readonly tracker: BackendProofTracker;
}): Promise<Readonly<AllCurrentScenarioResult>> {
  await mkdir(input.proofRoot, { mode: 0o700, recursive: true });
  await input.progress.enter('allCurrentFixtures');
  const fixtures = await Promise.all(
    [0, 1, 2].map(() =>
      createWorkspaceFirstStartProofFixture({
        factory: input.factories.current,
        userDataRoot: input.proofRoot,
      }),
    ),
  );
  const active = requireFixture(fixtures[0]);
  await input.progress.enter('allCurrentStores');
  const stores = await createProofStores({
    activeWorkspaceId: active.workspaceId,
    fixtures,
    proofRoot: input.proofRoot,
    sourceVersion: input.build.sourceVersion,
  });
  await input.progress.enter('allCurrentSnapshotsBefore');
  const artifactRootsBefore = await snapshotArtifactRoots(fixtures);
  let acceptedSourceBuildBeforeBackend = false;
  let journalAbsentBeforeBackend = false;
  let registryPreservedBeforeBackend = false;

  await input.progress.enter('allCurrentStartup');
  const firstLifecycle = await startProofComposition({
    beforeBackendStart: async () => {
      const [journal, acceptedBuild, registry] = await Promise.all([
        stores.journal.read(),
        stores.acceptedBuild.read(),
        stores.registry.read(),
      ]);
      journalAbsentBeforeBackend = journal === undefined;
      acceptedSourceBuildBeforeBackend =
        acceptedBuild?.appVersion === input.build.sourceVersion;
      registryPreservedBeforeBackend = workspaceFirstStartProofSnapshotsEqual(
        registry,
        stores.registryBefore,
      );
    },
    build: input.build,
    input: input.input,
    tracker: input.tracker,
    userDataPath: input.proofRoot,
  });
  await input.progress.enter('allCurrentRuntimeReadback');
  const [registryAfter, acceptedAfter, journalAfter, directSetupAfter] =
    await Promise.all([
      stores.registry.read(),
      stores.acceptedBuild.read(),
      stores.journal.read(),
      stores.directSetup.read(),
    ]);
  await input.progress.enter('allCurrentShutdown');
  await stopProofComposition(firstLifecycle, (checkpoint) =>
    input.progress.checkpoint(checkpoint),
  );
  await input.progress.enter('allCurrentSnapshotsAfter');
  const artifactRootsAfter = await snapshotArtifactRoots(fixtures);

  await input.progress.enter('allCurrentRestart');
  const exactRestartSkippedInventory = await runExactAcceptedRestart({
    build: input.build,
    factories: input.factories,
    input: input.input,
    tracker: input.tracker,
    userDataPath: input.proofRoot,
  });
  const registryAfterRestart = await stores.registry.read();
  const journalAbsentAfterBackend =
    journalAfter === undefined && (await stores.journal.read()) === undefined;
  const acceptedTargetBuildAfterBackend =
    acceptedAfter?.appVersion === input.build.targetRelease.appVersion;

  await input.progress.enter('allCurrentComplete');
  return Object.freeze({
    acceptedSourceBuildBeforeBackend,
    acceptedTargetBuildAfterBackend,
    allCurrentCompletedWithoutJournal:
      journalAbsentBeforeBackend &&
      journalAbsentAfterBackend &&
      acceptedTargetBuildAfterBackend,
    allCurrentRegistryPreserved:
      workspaceFirstStartProofSnapshotsEqual(
        stores.registryBefore,
        registryAfter,
      ) &&
      workspaceFirstStartProofSnapshotsEqual(
        stores.registryBefore,
        registryAfterRestart,
      ),
    artifactRootsPreserved: workspaceFirstStartProofSnapshotsEqual(
      artifactRootsBefore,
      artifactRootsAfter,
    ),
    directSetupRecoveryCleared:
      directSetupAfter === undefined &&
      (await stores.directSetup.read()) === undefined,
    exactAcceptedRestartSkippedInventory: exactRestartSkippedInventory,
    journalAbsentAfterBackend,
    journalAbsentBeforeBackend,
    migrationJournalCleared: journalAbsentAfterBackend,
    registryPreservedBeforeBackend,
  });
}

function createProofProgress(filePath: string): ProofProgress {
  let stage: ProofStage = 'setup';
  return {
    get stage() {
      return stage;
    },
    async checkpoint(checkpoint) {
      await appendFile(
        filePath,
        `${JSON.stringify({ checkpoint, stage })}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
    },
    async enter(nextStage) {
      stage = nextStage;
      await appendFile(
        filePath,
        `${JSON.stringify({ stage: nextStage })}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
    },
  };
}

async function createProofStores(input: {
  readonly activeWorkspaceId: WorkspaceId;
  readonly fixtures: readonly Readonly<WorkspaceFirstStartProofFixture>[];
  readonly proofRoot: string;
  readonly sourceVersion: string;
}): Promise<{
  readonly acceptedBuild: AcceptedBuildMetadataStore;
  readonly directSetup: DirectSetupMigrationRecoveryStore;
  readonly journal: WorkspaceFirstStartMigrationJournalStore;
  readonly registry: WorkspaceRegistryStore;
  readonly registryBefore: Readonly<LocalWorkspaceRegistryV1>;
}> {
  const registry = new WorkspaceRegistryStore({
    filePath: join(input.proofRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: input.proofRoot,
  });
  const registryBefore = createWorkspaceFirstStartProofRegistry(
    input.fixtures,
    input.activeWorkspaceId,
  );
  await registry.write(registryBefore);
  const updatePaths = createLocalUpdateRuntimePaths({
    legacyRuntimeRoot: createDesktopProfilePaths(input.proofRoot).runtimeRoot,
    userDataPath: input.proofRoot,
  });
  const acceptedBuild = new AcceptedBuildMetadataStore(
    updatePaths.acceptedBuildMetadataPath,
  );
  await acceptedBuild.write({
    acceptedAt: '2026-08-21T00:00:00.000Z',
    appVersion: input.sourceVersion,
    buildRevision: sourceBuildRevision,
    formatVersion: 1,
    releaseChannel: 'pilot',
  });
  return Object.freeze({
    acceptedBuild,
    directSetup: new DirectSetupMigrationRecoveryStore(
      updatePaths.directSetupMigrationRecoveryPath,
    ),
    journal: new WorkspaceFirstStartMigrationJournalStore({
      userDataPath: input.proofRoot,
    }),
    registry,
    registryBefore,
  });
}

async function startProofComposition(input: {
  readonly beforeBackendStart?: () => Promise<void>;
  readonly build: Readonly<ProofBuildIdentity>;
  readonly input: Readonly<WorkspaceFirstStartMigrationProofInput>;
  readonly tracker: BackendProofTracker;
  readonly userDataPath: string;
}): Promise<DesktopLifecycleHandle> {
  unregisterApplicationProtocol();
  const lifecycle = await startDesktopComposition({
    appVersion: input.build.targetRelease.appVersion,
    applicationPath: input.input.applicationPath,
    buildInfo: {
      appVersion: input.build.targetRelease.appVersion,
      buildCreatedAt: '2026-08-21T00:01:00.000Z',
      buildDirty: false,
      buildRevision: targetBuildRevision,
      schemaVersion: 1,
    },
    dependencies: {
      createRuntimeSession: createRuntimeSessionFactory(
        input.input.runtimeSessionSecret,
      ),
      startBackend: createTrackedBackendStarter({
        delegate: input.input.startBackend,
        tracker: input.tracker,
        ...(input.beforeBackendStart === undefined
          ? {}
          : { beforeStart: input.beforeBackendStart }),
      }),
    },
    quitApplication: () => undefined,
    releaseInfo: input.build.targetRelease,
    relaunchApplication: () => undefined,
    reportSmokeStage: async () => undefined,
    resourcesPath: input.input.resourcesPath,
    runtimeInstanceId: randomUUID(),
    smokeConfiguration: {
      enabled: false,
      phase: 'initial',
      root: undefined,
      userDataPath: undefined,
    },
    userDataPath: input.userDataPath,
  });
  if (lifecycle === undefined) {
    throw new Error('WORKSPACE_FIRST_START_PROOF_RELAUNCH_UNEXPECTED');
  }
  return lifecycle;
}

async function runExactAcceptedRestart(input: {
  readonly build: Readonly<ProofBuildIdentity>;
  readonly factories: Readonly<WorkspaceFirstStartProofFactories>;
  readonly input: Readonly<WorkspaceFirstStartMigrationProofInput>;
  readonly tracker: BackendProofTracker;
  readonly userDataPath: string;
}): Promise<boolean> {
  const restoreRunner = await disableCandidateRunner(
    input.factories.runnerPath,
  );
  let restoredBeforeBackend = false;
  try {
    const lifecycle = await startProofComposition({
      beforeBackendStart: async () => {
        await restoreRunner();
        restoredBeforeBackend = true;
      },
      build: input.build,
      input: input.input,
      tracker: input.tracker,
      userDataPath: input.userDataPath,
    });
    await stopProofComposition(lifecycle);
    return restoredBeforeBackend;
  } finally {
    await restoreRunner();
  }
}

function createTrackedBackendStarter(input: {
  readonly beforeStart?: () => Promise<void>;
  readonly delegate: (
    options: StartDesktopBackendOptions,
  ) => Promise<DesktopBackendHandle>;
  readonly tracker: BackendProofTracker;
}): (
  options: StartDesktopBackendOptions,
) => Promise<DesktopBackendHandle> {
  return async (options) => {
    await input.beforeStart?.();
    input.tracker.startCount += 1;
    let migrationGateErrorCode: string | undefined;
    let delegateHandle: DesktopBackendHandle;
    try {
      delegateHandle = await input.delegate({
        ...options,
        async beforeMigrations(inspection, control) {
          try {
            await options.beforeMigrations(inspection, control);
          } catch (error) {
            migrationGateErrorCode = readSafeErrorCode(error);
            throw error;
          }
        },
      });
    } catch (error) {
      if (migrationGateErrorCode !== undefined) {
        throw new Error(
          `DESKTOP_SMOKE_WORKSPACE_FIRST_START_MIGRATION_GATE_${migrationGateErrorCode}`,
        );
      }
      throw new Error(
        `DESKTOP_SMOKE_WORKSPACE_FIRST_START_${readSafeErrorCode(error)}`,
      );
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      input.tracker.activeHandles.delete(handle);
    };
    const handle: DesktopBackendHandle = {
      onUnexpectedExit(callback) {
        delegateHandle.onUnexpectedExit(callback);
      },
      port: delegateHandle.port,
      async stop() {
        try {
          await delegateHandle.stop();
        } finally {
          release();
        }
      },
      async stopForUpdate() {
        try {
          await delegateHandle.stopForUpdate();
        } finally {
          release();
        }
      },
    };
    input.tracker.activeHandles.add(handle);
    return handle;
  };
}

async function stopProofComposition(
  lifecycle: DesktopLifecycleHandle,
  reportCheckpoint?: (checkpoint: ProofShutdownCheckpoint) => Promise<void>,
): Promise<void> {
  try {
    await lifecycle.shutdown();
    await reportCheckpoint?.('lifecycleShutdownCompleted');
  } finally {
    // BrowserWindow close/destroy can deadlock when this proof runs inside
    // ElectronApplication.evaluate. The isolated fixture owns process cleanup.
    await reportCheckpoint?.('windowCleanupDeferred');
    unregisterApplicationProtocol();
    await reportCheckpoint?.('protocolUnregistered');
  }
}

async function stopTrackedBackends(
  tracker: BackendProofTracker,
): Promise<void> {
  for (const handle of [...tracker.activeHandles]) {
    await handle.stop().catch(() => undefined);
  }
}

async function disableCandidateRunner(
  runnerPath: string,
): Promise<() => Promise<void>> {
  const disabledPath = `${runnerPath}.w6a2b-disabled`;
  await rm(disabledPath, { force: true });
  await rename(runnerPath, disabledPath);
  let disabled = true;
  return async () => {
    if (!disabled) return;
    await rename(disabledPath, runnerPath);
    disabled = false;
  };
}

async function snapshotArtifactRoots(
  fixtures: readonly Readonly<WorkspaceFirstStartProofFixture>[],
): Promise<readonly (readonly string[])[]> {
  return Promise.all(
    fixtures.map((fixture) =>
      snapshotWorkspaceFirstStartProofDirectory(fixture.artifactRoot),
    ),
  );
}

function createProofBuildIdentity(
  targetVersion: string,
): Readonly<ProofBuildIdentity> {
  const sourceVersion = resolvePreviousVersion(targetVersion);
  return Object.freeze({
    sourceVersion,
    targetRelease: Object.freeze({
      appIdentity: 'Eky',
      appVersion: targetVersion,
      architecture: 'x64',
      buildRevision: targetBuildRevision,
      msiProductVersion: targetVersion,
      platform: 'win32',
      releaseChannel: 'pilot',
      schemaVersion: 1,
      upgradeCode: proofUpgradeCode,
    }),
  });
}

function resolvePreviousVersion(targetVersion: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(targetVersion);
  if (match === null) {
    throw new Error('WORKSPACE_FIRST_START_PROOF_VERSION_INVALID');
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (patch > 0) return `${major}.${minor}.${patch - 1}`;
  if (minor > 0) return `${major}.${minor - 1}.0`;
  if (major > 0) return `${major - 1}.0.0`;
  throw new Error('WORKSPACE_FIRST_START_PROOF_VERSION_INVALID');
}

function createRuntimeSessionFactory(primary: string): () => string {
  const alternate = primary === 'A'.repeat(43) ? 'B'.repeat(43) : 'A'.repeat(43);
  let callCount = 0;
  return () => {
    callCount += 1;
    return callCount === 1 ? primary : alternate;
  };
}

function unregisterApplicationProtocol(): void {
  if (protocol.isProtocolHandled('eky')) {
    protocol.unhandle('eky');
  }
}

function requireFixture(
  fixture: Readonly<WorkspaceFirstStartProofFixture> | undefined,
): Readonly<WorkspaceFirstStartProofFixture> {
  if (fixture === undefined) {
    throw new Error('WORKSPACE_FIRST_START_PROOF_FIXTURE_MISSING');
  }
  return fixture;
}

function requireProofResult(
  result: Readonly<WorkspaceFirstStartMigrationProofResult>,
): void {
  requireProofAssertion(
    result.activePointerPreserved,
    'WORKSPACE_FIRST_START_PROOF_ACTIVE_POINTER_CHANGED',
  );
  requireProofAssertion(
    result.allCurrentCompletedWithoutJournal,
    'WORKSPACE_FIRST_START_PROOF_ALL_CURRENT_JOURNAL_CREATED',
  );
  requireProofAssertion(
    result.allCurrentRegistryPreserved,
    'WORKSPACE_FIRST_START_PROOF_ALL_CURRENT_REGISTRY_CHANGED',
  );
  requireProofAssertion(
    result.artifactRootsPreserved,
    'WORKSPACE_FIRST_START_PROOF_ARTIFACT_ROOT_CHANGED',
  );
  requireProofAssertion(
    result.backendStartCount === 4,
    'WORKSPACE_FIRST_START_PROOF_BACKEND_START_COUNT_INVALID',
  );
  requireProofAssertion(
    result.backendStoppedAfterProof,
    'WORKSPACE_FIRST_START_PROOF_BACKEND_STILL_RUNNING',
  );
  requireProofAssertion(
    result.candidateProcessesReleased,
    'WORKSPACE_FIRST_START_PROOF_CANDIDATE_PROCESS_REMAINED',
  );
  requireProofAssertion(
    result.directSetupRecoveryCleared,
    'WORKSPACE_FIRST_START_PROOF_DIRECT_SETUP_RECOVERY_REMAINED',
  );
  requireProofAssertion(
    result.exactAcceptedRestartSkippedInventory,
    'WORKSPACE_FIRST_START_PROOF_EXACT_RESTART_INSPECTED',
  );
  requireProofAssertion(
    result.invalidPassiveWorkspaceQuarantined,
    'WORKSPACE_FIRST_START_PROOF_INVALID_PASSIVE_NOT_QUARANTINED',
  );
  requireProofAssertion(
    result.migrationJournalCleared,
    'WORKSPACE_FIRST_START_PROOF_MIGRATION_JOURNAL_REMAINED',
  );
  requireProofAssertion(
    result.mixedActiveWorkspaceMigrated,
    'WORKSPACE_FIRST_START_PROOF_ACTIVE_NOT_MIGRATED',
  );
  requireProofAssertion(
    result.passiveCompatibleWorkspacePreserved,
    'WORKSPACE_FIRST_START_PROOF_PASSIVE_COMPATIBLE_CHANGED',
  );
  requireProofAssertion(
    result.preparedBeforeBackend,
    'WORKSPACE_FIRST_START_PROOF_NOT_PREPARED_BEFORE_BACKEND',
  );
  requireProofAssertion(
    result.relaunchCount === 0,
    'WORKSPACE_FIRST_START_PROOF_UNEXPECTED_RELAUNCH',
  );
  requireProofAssertion(
    result.targetAcceptedAfterRegistryTransition,
    'WORKSPACE_FIRST_START_PROOF_TARGET_ACCEPTED_TOO_EARLY',
  );
}

function requireAllCurrentScenarioResult(
  result: Readonly<AllCurrentScenarioResult>,
): void {
  requireProofAssertion(
    result.journalAbsentBeforeBackend,
    'WORKSPACE_FIRST_START_PROOF_ALL_CURRENT_JOURNAL_BEFORE_BACKEND',
  );
  requireProofAssertion(
    result.acceptedSourceBuildBeforeBackend,
    'WORKSPACE_FIRST_START_PROOF_ALL_CURRENT_SOURCE_NOT_PRESERVED_BEFORE_BACKEND',
  );
  requireProofAssertion(
    result.registryPreservedBeforeBackend,
    'WORKSPACE_FIRST_START_PROOF_ALL_CURRENT_REGISTRY_CHANGED_BEFORE_BACKEND',
  );
  requireProofAssertion(
    result.journalAbsentAfterBackend,
    'WORKSPACE_FIRST_START_PROOF_ALL_CURRENT_JOURNAL_AFTER_BACKEND',
  );
  requireProofAssertion(
    result.acceptedTargetBuildAfterBackend,
    'WORKSPACE_FIRST_START_PROOF_ALL_CURRENT_TARGET_NOT_ACCEPTED_AFTER_BACKEND',
  );
}

function requireProofAssertion(condition: boolean, errorCode: string): void {
  if (!condition) throw new Error(errorCode);
}

function readSafeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : undefined;
  return value !== undefined && /^[A-Z][A-Z0-9_]{2,120}$/u.test(value)
    ? value
    : 'UNAVAILABLE';
}

async function readLatestRecoveryPointFailureCode(
  userDataPath: string,
): Promise<string | undefined> {
  const logDirectory = join(userDataPath, 'runtime', 'logs', 'desktop');
  let names: string[];
  try {
    names = (await readdir(logDirectory))
      .filter((name) => /^desktop-warning-error-\d{4}-\d{2}-\d{3}\.jsonl$/u.test(name))
      .sort()
      .reverse();
  } catch {
    return undefined;
  }

  for (const name of names) {
    let lines: string[];
    try {
      lines = (await readFile(join(logDirectory, name), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .reverse();
    } catch {
      continue;
    }
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (
          event.eventName === 'recoveryPoint.failed' &&
          typeof event.errorCode === 'string' &&
          /^[A-Z][A-Z0-9_]{2,120}$/u.test(event.errorCode)
        ) {
          return event.errorCode;
        }
      } catch {
        // The proof only consumes valid allowlisted operational events.
      }
    }
  }
  return undefined;
}

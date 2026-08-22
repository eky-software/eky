import { createHash, randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
} from 'node:fs/promises';
import { join, relative } from 'node:path';

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
import { createProfileSnapshotRuntimePaths } from '../src/profileBackup/profileSnapshotRuntimePaths.js';
import {
  RecoveryPointIndexStore,
  recoveryPointIndexFileName,
} from '../src/profileBackup/recoveryPoint/recoveryPointIndexStore.js';
import { ProfileRestoreActivationJournalStore } from '../src/profileBackup/restore/profileRestoreActivationJournalStore.js';
import type { DesktopReleaseInfo } from '../src/release/desktopReleaseInfo.js';
import { AcceptedBuildMetadataStore } from '../src/update/acceptedBuildMetadataStore.js';
import { createLocalUpdateRuntimePaths } from '../src/update/localUpdateRuntimePaths.js';
import {
  selectActiveWorkspace,
} from '../src/workspaces/registry/workspaceRegistryMutations.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../src/workspaces/registry/workspaceRegistryTypes.js';
import {
  deriveWorkspaceBackupReplacementPaths,
  deriveWorkspaceBackupReplacementRuntimePaths,
} from '../src/workspaces/replacement/workspaceBackupReplacementPaths.js';
import {
  generateWorkspaceBackupReplacementOperationId,
  type WorkspaceBackupReplacementOperationId,
} from '../src/workspaces/replacement/workspaceBackupReplacementOperationId.js';
import { WorkspaceSwitchJournalStore } from '../src/workspaces/switch/workspaceSwitchJournal.js';
import {
  corruptWorkspaceFirstStartProofDatabase,
  createWorkspaceFirstStartProofFactories,
  createWorkspaceFirstStartProofFixture,
  createWorkspaceFirstStartProofRegistry,
  inspectWorkspaceFirstStartProofFixture,
  snapshotWorkspaceFirstStartProofBusinessData,
  snapshotWorkspaceFirstStartProofFile,
  validateWorkspaceFirstStartProofHistoricalFixture,
  workspaceFirstStartProofSnapshotsEqual,
  type WorkspaceFirstStartProofFactories,
  type WorkspaceFirstStartProofFixture,
} from './workspaceFirstStartMigrationProofFixtures.js';
import type {
  WorkspaceActivationMigrationProofInput,
  WorkspaceActivationMigrationProofResult,
} from './workspaceActivationMigrationProofTypes.js';
import {
  captureUtilityProcessBaseline,
  waitForProofUtilityProcessesReleased,
} from './workspaceManagementCompositionProofRuntime.js';

const targetBuildRevision = 'c'.repeat(40);
const proofUpgradeCode = '11111111-1111-4111-8111-111111111111';

type ProofStage =
  | 'setup'
  | 'fixtures'
  | 'compatiblePrepared'
  | 'compatibleInspection'
  | 'compatibleHistoricalValidation'
  | 'compatibleMigration'
  | 'compatibleValidation'
  | 'compatibleRestart'
  | 'currentSwitch'
  | 'invalidSwitch'
  | 'invalidRecovery'
  | 'faultSwitch'
  | 'faultRecovery'
  | 'assertions'
  | 'cleanup';

interface ProofProgress {
  readonly stage: ProofStage;
  enter(stage: ProofStage): Promise<void>;
}

interface BackendProofTracker {
  readonly activeHandles: Set<DesktopBackendHandle>;
  readonly databaseStarts: string[];
  relaunchCount: number;
  startCount: number;
  successfulStartCount: number;
}

interface ProofStores {
  readonly acceptedBuild: AcceptedBuildMetadataStore;
  readonly activationJournals: ReadonlyMap<
    WorkspaceId,
    ProfileRestoreActivationJournalStore
  >;
  readonly registry: WorkspaceRegistryStore;
  readonly switchJournal: WorkspaceSwitchJournalStore;
}

interface ProofFixtures {
  readonly compatibleTarget: Readonly<WorkspaceFirstStartProofFixture>;
  readonly currentSource: Readonly<WorkspaceFirstStartProofFixture>;
  readonly faultTarget: Readonly<WorkspaceFirstStartProofFixture>;
  readonly invalidTarget: Readonly<WorkspaceFirstStartProofFixture>;
  readonly all: readonly Readonly<WorkspaceFirstStartProofFixture>[];
}

interface FileState {
  readonly mtimeMs: number;
  readonly sha256: string;
  readonly size: number;
}

export async function runWorkspaceActivationMigrationProof(
  input: Readonly<WorkspaceActivationMigrationProofInput>,
): Promise<Readonly<WorkspaceActivationMigrationProofResult>> {
  await mkdir(input.userDataRoot, { mode: 0o700, recursive: true });
  const proofRoot = await mkdtemp(join(input.userDataRoot, 'a3-'));
  const progress = createProofProgress(join(proofRoot, 'progress.jsonl'));
  const utilityProcessBaseline = captureUtilityProcessBaseline();
  const tracker: BackendProofTracker = {
    activeHandles: new Set(),
    databaseStarts: [],
    relaunchCount: 0,
    startCount: 0,
    successfulStartCount: 0,
  };
  let factories: Readonly<WorkspaceFirstStartProofFactories> | undefined;

  try {
    await progress.enter('setup');
    const release = createProofRelease(input.appVersion);
    factories = await createWorkspaceFirstStartProofFactories({
      appVersion: release.appVersion,
      buildRevision: targetBuildRevision,
      resourcesPath: input.resourcesPath,
    });

    await progress.enter('fixtures');
    const fixtures = await createProofFixtures({
      factories,
      proofRoot,
    });
    const stores = await createProofStores({
      fixtures,
      proofRoot,
      release,
    });
    const databaseBefore = await snapshotDatabases(fixtures.all);
    const artifactsBefore = await snapshotArtifactRoots(fixtures.all);
    const businessDataBefore = await snapshotBusinessData([
      fixtures.currentSource,
      fixtures.compatibleTarget,
      fixtures.faultTarget,
    ]);

    await progress.enter('compatiblePrepared');
    const compatibleBefore = requireSnapshot(
      databaseBefore,
      fixtures.compatibleTarget.workspaceId,
    );
    const recoveryPointCountBefore = await readRecoveryPointCount(
      fixtures.compatibleTarget,
    );
    await seedSwitch({
      registry: stores.registry,
      sourceWorkspaceId: fixtures.currentSource.workspaceId,
      switchJournal: stores.switchJournal,
      targetWorkspaceId: fixtures.compatibleTarget.workspaceId,
    });

    await progress.enter('compatibleInspection');
    const compatibleBeforeActivation =
      await inspectWorkspaceFirstStartProofFixture(
        factories.current,
        fixtures.compatibleTarget,
      );
    if (compatibleBeforeActivation.status !== 'compatiblePending') {
      throw new Error(
        'WORKSPACE_ACTIVATION_PROOF_COMPATIBLE_INSPECTION_INVALID',
      );
    }

    await progress.enter('compatibleHistoricalValidation');
    const historicalReadiness =
      await validateWorkspaceFirstStartProofHistoricalFixture(
        factories.current,
        fixtures.compatibleTarget,
      );
    if (
      historicalReadiness.handlesClosed !== true ||
      historicalReadiness.migrationState !== 'compatiblePending' ||
      historicalReadiness.lineageIdentity.profileId !==
        fixtures.compatibleTarget.profileId
    ) {
      throw new Error(
        'WORKSPACE_ACTIVATION_PROOF_HISTORICAL_VALIDATION_INVALID',
      );
    }

    await progress.enter('compatibleMigration');
    const migrationStartCount = tracker.startCount;
    const migrationLifecycle = await startProofComposition({
      input,
      release,
      tracker,
      userDataPath: proofRoot,
    });
    if (migrationLifecycle !== undefined) {
      await stopProofComposition(migrationLifecycle);
    }
    const compatibleJournalAfterMigration =
      await requireActivationJournal(
        stores,
        fixtures.compatibleTarget.workspaceId,
      ).read();
    const switchJournalAfterMigration = await stores.switchJournal.read();

    await progress.enter('compatibleValidation');
    await runExpectedLifecycle({
      input,
      release,
      tracker,
      userDataPath: proofRoot,
    });
    const compatibleAfterAcceptance =
      await snapshotWorkspaceFirstStartProofFile(
        fixtures.compatibleTarget.databaseFilePath,
      );
    const compatibleInspection =
      await inspectWorkspaceFirstStartProofFixture(
        factories.current,
        fixtures.compatibleTarget,
      );
    const recoveryPointCountAfterAcceptance = await readRecoveryPointCount(
      fixtures.compatibleTarget,
    );
    const registryAfterAcceptance = requireRegistry(
      await stores.registry.read(),
    );

    await progress.enter('compatibleRestart');
    const compatibleStartCountBeforeRestart = tracker.startCount;
    await runExpectedLifecycle({
      input,
      release,
      tracker,
      userDataPath: proofRoot,
    });
    const compatibleAfterRestart =
      await snapshotWorkspaceFirstStartProofFile(
        fixtures.compatibleTarget.databaseFilePath,
      );
    const recoveryPointCountAfterRestart = await readRecoveryPointCount(
      fixtures.compatibleTarget,
    );

    await progress.enter('currentSwitch');
    const currentBefore = requireSnapshot(
      databaseBefore,
      fixtures.currentSource.workspaceId,
    );
    await seedSwitch({
      registry: stores.registry,
      sourceWorkspaceId: fixtures.compatibleTarget.workspaceId,
      switchJournal: stores.switchJournal,
      targetWorkspaceId: fixtures.currentSource.workspaceId,
    });
    await runExpectedLifecycle({
      input,
      release,
      tracker,
      userDataPath: proofRoot,
    });
    const currentAfter = await snapshotWorkspaceFirstStartProofFile(
      fixtures.currentSource.databaseFilePath,
    );

    await progress.enter('invalidSwitch');
    const invalidBefore = requireSnapshot(
      databaseBefore,
      fixtures.invalidTarget.workspaceId,
    );
    await seedSwitch({
      registry: stores.registry,
      sourceWorkspaceId: fixtures.currentSource.workspaceId,
      switchJournal: stores.switchJournal,
      targetWorkspaceId: fixtures.invalidTarget.workspaceId,
    });
    const backendStartsBeforeInvalid = tracker.startCount;
    const invalidLifecycle = await startProofComposition({
      input,
      release,
      tracker,
      userDataPath: proofRoot,
    });
    if (invalidLifecycle !== undefined) {
      await stopProofComposition(invalidLifecycle);
    }
    const invalidRejectedBeforeBackend =
      tracker.startCount === backendStartsBeforeInvalid;
    const invalidRegistry = requireRegistry(await stores.registry.read());
    const invalidJournal = await stores.switchJournal.read();
    const invalidAfter = await snapshotWorkspaceFirstStartProofFile(
      fixtures.invalidTarget.databaseFilePath,
    );

    await progress.enter('invalidRecovery');
    await runExpectedLifecycle({
      input,
      release,
      tracker,
      userDataPath: proofRoot,
    });

    await progress.enter('faultSwitch');
    const faultBefore = requireSnapshot(
      databaseBefore,
      fixtures.faultTarget.workspaceId,
    );
    const faultOperationId = await seedSwitch({
      registry: stores.registry,
      sourceWorkspaceId: fixtures.currentSource.workspaceId,
      switchJournal: stores.switchJournal,
      targetWorkspaceId: fixtures.faultTarget.workspaceId,
    });
    const faultPaths = deriveWorkspaceBackupReplacementPaths(
      proofRoot,
      faultOperationId,
      fixtures.faultTarget.workspaceId,
    );
    await mkdir(faultPaths.activationStagingOperationRoot, {
      mode: 0o700,
      recursive: true,
    });
    const faultLifecycle = await startProofComposition({
      input,
      release,
      tracker,
      userDataPath: proofRoot,
    });
    if (faultLifecycle !== undefined) {
      await stopProofComposition(faultLifecycle);
    }
    const faultRegistry = requireRegistry(await stores.registry.read());
    const faultJournal = await stores.switchJournal.read();
    const faultAfter = await snapshotWorkspaceFirstStartProofFile(
      fixtures.faultTarget.databaseFilePath,
    );
    const faultStagingRemoved = await pathIsMissing(
      faultPaths.activationStagingOperationRoot,
    );

    await progress.enter('faultRecovery');
    await runExpectedLifecycle({
      input,
      release,
      tracker,
      userDataPath: proofRoot,
    });

    await progress.enter('assertions');
    const finalRegistry = requireRegistry(await stores.registry.read());
    const finalDatabase = await snapshotDatabases(fixtures.all);
    const artifactsAfter = await snapshotArtifactRoots(fixtures.all);
    const businessDataAfter = await snapshotBusinessData([
      fixtures.currentSource,
      fixtures.compatibleTarget,
      fixtures.faultTarget,
    ]);
    const activationJournalsCleared = await allActivationJournalsCleared(
      stores,
    );
    const candidateProcessesReleased =
      await waitForProofUtilityProcessesReleased(utilityProcessBaseline);
    const result = Object.freeze({
      activationJournalsCleared,
      artifactRootsPreserved: workspaceFirstStartProofSnapshotsEqual(
        artifactsBefore,
        artifactsAfter,
      ),
      backendStartCount: tracker.startCount,
      backendStoppedAfterProof: tracker.activeHandles.size === 0,
      businessDataPreserved: workspaceFirstStartProofSnapshotsEqual(
        businessDataBefore,
        businessDataAfter,
      ),
      candidateProcessesReleased,
      compatibleTargetMigratedOnlyOnActivation:
        migrationLifecycle === undefined &&
        tracker.startCount >= migrationStartCount + 1 &&
        compatibleInspection.status === 'current' &&
        !workspaceFirstStartProofSnapshotsEqual(
          compatibleBefore,
          compatibleAfterAcceptance,
        ),
      currentTargetPreserved:
        workspaceFirstStartProofSnapshotsEqual(currentBefore, currentAfter) &&
        workspaceFirstStartProofSnapshotsEqual(
          currentBefore,
          requireSnapshot(
            finalDatabase,
            fixtures.currentSource.workspaceId,
          ),
        ),
      faultTargetPreserved:
        workspaceFirstStartProofSnapshotsEqual(faultBefore, faultAfter) &&
        workspaceFirstStartProofSnapshotsEqual(
          faultBefore,
          requireSnapshot(finalDatabase, fixtures.faultTarget.workspaceId),
        ) &&
        faultStagingRemoved &&
        (await requireActivationJournal(
          stores,
          fixtures.faultTarget.workspaceId,
        ).read()) === undefined,
      invalidTargetQuarantined:
        invalidRegistry.activeWorkspaceId ===
          fixtures.currentSource.workspaceId &&
        requireWorkspace(
          invalidRegistry,
          fixtures.invalidTarget.workspaceId,
        ).lifecycleState === 'recoveryRequired' &&
        invalidJournal?.state === 'rollbackSelected' &&
        workspaceFirstStartProofSnapshotsEqual(invalidBefore, invalidAfter),
      invalidTargetRejectedBeforeBackend:
        invalidLifecycle === undefined && invalidRejectedBeforeBackend,
      migrationRecoveryPointCreated:
        recoveryPointCountBefore === 0 &&
        recoveryPointCountAfterAcceptance === 1,
      registryRecoveredAfterFault:
        faultRegistry.activeWorkspaceId ===
          fixtures.currentSource.workspaceId &&
        requireWorkspace(
          faultRegistry,
          fixtures.faultTarget.workspaceId,
        ).lifecycleState === 'ready' &&
        faultJournal?.state === 'rollbackSelected' &&
        finalRegistry.activeWorkspaceId ===
          fixtures.currentSource.workspaceId,
      relaunchCount: tracker.relaunchCount,
      secondTargetStartupIdempotent:
        tracker.startCount >= compatibleStartCountBeforeRestart + 1 &&
        workspaceFirstStartProofSnapshotsEqual(
          compatibleAfterAcceptance,
          compatibleAfterRestart,
        ) &&
        recoveryPointCountAfterAcceptance ===
          recoveryPointCountAfterRestart,
      switchJournalsCleared:
        (await stores.switchJournal.read()) === undefined,
      targetAcceptedAfterValidation:
        compatibleJournalAfterMigration !== undefined &&
        switchJournalAfterMigration?.state === 'targetSelected' &&
        registryAfterAcceptance.activeWorkspaceId ===
          fixtures.compatibleTarget.workspaceId &&
        (await requireActivationJournal(
          stores,
          fixtures.compatibleTarget.workspaceId,
        ).read()) === undefined,
      targetLifecycleWithheldUntilReady:
        migrationLifecycle === undefined,
    });
    requireProofResult(result);
    return result;
  } catch (error) {
    throw new Error(
      `WORKSPACE_ACTIVATION_MIGRATION_PROOF_FAILED_${progress.stage.toUpperCase()}_${readSafeErrorCode(error)}`,
    );
  } finally {
    await progress.enter('cleanup').catch(() => undefined);
    unregisterApplicationProtocol();
    await stopTrackedBackends(tracker);
    await factories?.cleanup().catch(() => undefined);
    await rm(proofRoot, { force: true, recursive: true }).catch(() => undefined);
  }
}

async function createProofFixtures(input: {
  readonly factories: Readonly<WorkspaceFirstStartProofFactories>;
  readonly proofRoot: string;
}): Promise<Readonly<ProofFixtures>> {
  const currentSource = await createWorkspaceFirstStartProofFixture({
    factory: input.factories.current,
    userDataRoot: input.proofRoot,
  });
  const compatibleTarget = await createWorkspaceFirstStartProofFixture({
    factory: input.factories.historical,
    userDataRoot: input.proofRoot,
  });
  const invalidTarget = await createWorkspaceFirstStartProofFixture({
    factory: input.factories.current,
    userDataRoot: input.proofRoot,
  });
  await corruptWorkspaceFirstStartProofDatabase(invalidTarget);
  const faultTarget = await createWorkspaceFirstStartProofFixture({
    factory: input.factories.historical,
    userDataRoot: input.proofRoot,
  });
  return Object.freeze({
    all: Object.freeze([
      currentSource,
      compatibleTarget,
      invalidTarget,
      faultTarget,
    ]),
    compatibleTarget,
    currentSource,
    faultTarget,
    invalidTarget,
  });
}

async function createProofStores(input: {
  readonly fixtures: Readonly<ProofFixtures>;
  readonly proofRoot: string;
  readonly release: Readonly<DesktopReleaseInfo>;
}): Promise<Readonly<ProofStores>> {
  const registry = new WorkspaceRegistryStore({
    filePath: join(input.proofRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: input.proofRoot,
  });
  await registry.write(
    createWorkspaceFirstStartProofRegistry(
      input.fixtures.all,
      input.fixtures.currentSource.workspaceId,
    ),
  );
  const updatePaths = createLocalUpdateRuntimePaths({
    legacyRuntimeRoot: createDesktopProfilePaths(input.proofRoot).runtimeRoot,
    userDataPath: input.proofRoot,
  });
  const acceptedBuild = new AcceptedBuildMetadataStore(
    updatePaths.acceptedBuildMetadataPath,
  );
  await acceptedBuild.write({
    acceptedAt: '2026-08-22T00:00:00.000Z',
    appVersion: input.release.appVersion,
    buildRevision: input.release.buildRevision,
    formatVersion: 1,
    releaseChannel: 'pilot',
  });
  return Object.freeze({
    acceptedBuild,
    activationJournals: new Map(
      input.fixtures.all.map((fixture) => [
        fixture.workspaceId,
        new ProfileRestoreActivationJournalStore(
          deriveWorkspaceBackupReplacementRuntimePaths(
            input.proofRoot,
            fixture.workspaceId,
          ).activationJournalPath,
        ),
      ]),
    ),
    registry,
    switchJournal: new WorkspaceSwitchJournalStore(input.proofRoot),
  });
}

async function seedSwitch(input: {
  readonly registry: WorkspaceRegistryStore;
  readonly sourceWorkspaceId: WorkspaceId;
  readonly switchJournal: WorkspaceSwitchJournalStore;
  readonly targetWorkspaceId: WorkspaceId;
}): Promise<WorkspaceBackupReplacementOperationId> {
  const operationId = generateWorkspaceBackupReplacementOperationId();
  const prepared = Object.freeze({
    createdAt: '2026-08-22T00:01:00.000Z',
    formatVersion: 1 as const,
    operationId,
    sourceWorkspaceId: input.sourceWorkspaceId,
    state: 'prepared' as const,
    targetWorkspaceId: input.targetWorkspaceId,
  });
  await input.switchJournal.write(prepared);
  const registry = requireRegistry(await input.registry.read());
  await input.registry.write(
    selectActiveWorkspace(
      registry,
      input.sourceWorkspaceId,
      input.targetWorkspaceId,
    ),
  );
  await input.switchJournal.write({
    ...prepared,
    state: 'targetSelected',
  });
  return operationId;
}

async function startProofComposition(input: {
  readonly input: Readonly<WorkspaceActivationMigrationProofInput>;
  readonly release: Readonly<DesktopReleaseInfo>;
  readonly tracker: BackendProofTracker;
  readonly userDataPath: string;
}): Promise<DesktopLifecycleHandle | undefined> {
  unregisterApplicationProtocol();
  return startDesktopComposition({
    appVersion: input.release.appVersion,
    applicationPath: input.input.applicationPath,
    buildInfo: {
      appVersion: input.release.appVersion,
      buildCreatedAt: '2026-08-22T00:02:00.000Z',
      buildDirty: false,
      buildRevision: input.release.buildRevision,
      schemaVersion: 1,
    },
    dependencies: {
      createRuntimeSession: createRuntimeSessionFactory(
        input.input.runtimeSessionSecret,
      ),
      startBackend: createTrackedBackendStarter({
        delegate: input.input.startBackend,
        tracker: input.tracker,
      }),
    },
    quitApplication: () => undefined,
    releaseInfo: input.release,
    relaunchApplication: () => {
      input.tracker.relaunchCount += 1;
    },
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
}

async function runExpectedLifecycle(input: {
  readonly input: Readonly<WorkspaceActivationMigrationProofInput>;
  readonly release: Readonly<DesktopReleaseInfo>;
  readonly tracker: BackendProofTracker;
  readonly userDataPath: string;
}): Promise<void> {
  const lifecycle = await startProofComposition(input);
  if (lifecycle === undefined) {
    throw new Error('WORKSPACE_ACTIVATION_PROOF_LIFECYCLE_MISSING');
  }
  await stopProofComposition(lifecycle);
}

function createTrackedBackendStarter(input: {
  readonly delegate: (
    options: StartDesktopBackendOptions,
  ) => Promise<DesktopBackendHandle>;
  readonly tracker: BackendProofTracker;
}): (
  options: StartDesktopBackendOptions,
) => Promise<DesktopBackendHandle> {
  return async (options) => {
    input.tracker.startCount += 1;
    input.tracker.databaseStarts.push(options.config.databaseFilePath);
    const delegateHandle = await input.delegate(options);
    input.tracker.successfulStartCount += 1;
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
): Promise<void> {
  try {
    await lifecycle.shutdown();
  } finally {
    // The isolated Electron fixture owns BrowserWindow process cleanup.
    unregisterApplicationProtocol();
  }
}

async function stopTrackedBackends(
  tracker: BackendProofTracker,
): Promise<void> {
  for (const handle of [...tracker.activeHandles]) {
    await handle.stop().catch(() => undefined);
  }
}

async function snapshotDatabases(
  fixtures: readonly Readonly<WorkspaceFirstStartProofFixture>[],
): Promise<ReadonlyMap<WorkspaceId, Readonly<FileState>>> {
  return new Map(
    await Promise.all(
      fixtures.map(async (fixture) => [
        fixture.workspaceId,
        await snapshotWorkspaceFirstStartProofFile(
          fixture.databaseFilePath,
        ),
      ] as const),
    ),
  );
}

async function snapshotArtifactRoots(
  fixtures: readonly Readonly<WorkspaceFirstStartProofFixture>[],
): Promise<readonly (readonly string[])[]> {
  return Promise.all(
    fixtures.map((fixture) => snapshotDirectoryContent(fixture.artifactRoot)),
  );
}

async function snapshotBusinessData(
  fixtures: readonly Readonly<WorkspaceFirstStartProofFixture>[],
): Promise<readonly unknown[]> {
  return Promise.all(
    fixtures.map((fixture) =>
      snapshotWorkspaceFirstStartProofBusinessData(fixture),
    ),
  );
}

async function snapshotDirectoryContent(
  root: string,
): Promise<readonly string[]> {
  const snapshots: string[] = [];
  await appendDirectoryContentSnapshot(root, root, snapshots);
  return Object.freeze(snapshots.sort());
}

async function appendDirectoryContentSnapshot(
  root: string,
  current: string,
  snapshots: string[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(current, entry.name);
    const relativePath = relative(root, path).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      snapshots.push(`directory:${relativePath}`);
      await appendDirectoryContentSnapshot(root, path, snapshots);
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('WORKSPACE_ACTIVATION_PROOF_ARTIFACT_INVALID');
    }
    const bytes = await readFile(path);
    snapshots.push(
      `file:${relativePath}:${bytes.byteLength}:${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
}

async function readRecoveryPointCount(
  fixture: Readonly<WorkspaceFirstStartProofFixture>,
): Promise<number> {
  const profilePaths = createDesktopProfilePaths(fixture.workspaceRoot);
  const snapshotPaths = createProfileSnapshotRuntimePaths(
    profilePaths.runtimeRoot,
  );
  const index = await new RecoveryPointIndexStore(
    join(
      snapshotPaths.recoveryPointsRoot,
      fixture.profileId,
      recoveryPointIndexFileName,
    ),
  ).read();
  return index.points.length;
}

async function allActivationJournalsCleared(
  stores: Readonly<ProofStores>,
): Promise<boolean> {
  const values = await Promise.all(
    [...stores.activationJournals.values()].map((store) => store.read()),
  );
  return values.every((value) => value === undefined);
}

function requireActivationJournal(
  stores: Readonly<ProofStores>,
  workspaceId: WorkspaceId,
): ProfileRestoreActivationJournalStore {
  const store = stores.activationJournals.get(workspaceId);
  if (store === undefined) {
    throw new Error('WORKSPACE_ACTIVATION_PROOF_JOURNAL_MISSING');
  }
  return store;
}

function requireSnapshot(
  snapshots: ReadonlyMap<WorkspaceId, Readonly<FileState>>,
  workspaceId: WorkspaceId,
): Readonly<FileState> {
  const snapshot = snapshots.get(workspaceId);
  if (snapshot === undefined) {
    throw new Error('WORKSPACE_ACTIVATION_PROOF_SNAPSHOT_MISSING');
  }
  return snapshot;
}

function requireRegistry(
  registry: Readonly<LocalWorkspaceRegistryV1> | undefined,
): Readonly<LocalWorkspaceRegistryV1> {
  if (registry === undefined) {
    throw new Error('WORKSPACE_ACTIVATION_PROOF_REGISTRY_MISSING');
  }
  return registry;
}

function requireWorkspace(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  workspaceId: WorkspaceId,
): Readonly<LocalWorkspaceRegistryEntryV1> {
  const workspace = registry.workspaces.find(
    (entry) => entry.workspaceId === workspaceId,
  );
  if (workspace === undefined) {
    throw new Error('WORKSPACE_ACTIVATION_PROOF_WORKSPACE_MISSING');
  }
  return workspace;
}

async function pathIsMissing(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return false;
  } catch (error) {
    return isNodeError(error) && error.code === 'EISDIR'
      ? false
      : isNodeError(error) && error.code === 'ENOENT';
  }
}

function createProofRelease(
  appVersion: string,
): Readonly<DesktopReleaseInfo> {
  if (!/^\d+\.\d+\.\d+$/u.test(appVersion)) {
    throw new Error('WORKSPACE_ACTIVATION_PROOF_VERSION_INVALID');
  }
  return Object.freeze({
    appIdentity: 'Eky',
    appVersion,
    architecture: 'x64',
    buildRevision: targetBuildRevision,
    msiProductVersion: appVersion,
    platform: 'win32',
    releaseChannel: 'pilot',
    schemaVersion: 1,
    upgradeCode: proofUpgradeCode,
  });
}

function createRuntimeSessionFactory(primary: string): () => string {
  const alternate =
    primary === 'A'.repeat(43) ? 'B'.repeat(43) : 'A'.repeat(43);
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

function createProofProgress(filePath: string): ProofProgress {
  let stage: ProofStage = 'setup';
  return {
    get stage() {
      return stage;
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

function requireProofResult(
  result: Readonly<WorkspaceActivationMigrationProofResult>,
): void {
  const assertions = [
    [result.activationJournalsCleared, 'ACTIVATION_JOURNALS_REMAINED'],
    [result.artifactRootsPreserved, 'ARTIFACT_ROOT_CHANGED'],
    [result.backendStartCount === 7, 'BACKEND_START_COUNT_INVALID'],
    [result.backendStoppedAfterProof, 'BACKEND_REMAINED'],
    [result.businessDataPreserved, 'BUSINESS_DATA_CHANGED'],
    [result.candidateProcessesReleased, 'UTILITY_PROCESS_REMAINED'],
    [result.compatibleTargetMigratedOnlyOnActivation, 'TARGET_NOT_MIGRATED'],
    [result.currentTargetPreserved, 'CURRENT_TARGET_CHANGED'],
    [result.faultTargetPreserved, 'FAULT_TARGET_CHANGED'],
    [result.invalidTargetQuarantined, 'INVALID_TARGET_NOT_QUARANTINED'],
    [result.invalidTargetRejectedBeforeBackend, 'INVALID_TARGET_STARTED'],
    [result.migrationRecoveryPointCreated, 'RECOVERY_POINT_INVALID'],
    [result.registryRecoveredAfterFault, 'FAULT_SOURCE_NOT_RECOVERED'],
    [result.relaunchCount === 3, 'RELAUNCH_COUNT_INVALID'],
    [result.secondTargetStartupIdempotent, 'SECOND_START_NOT_IDEMPOTENT'],
    [result.switchJournalsCleared, 'SWITCH_JOURNAL_REMAINED'],
    [result.targetAcceptedAfterValidation, 'TARGET_NOT_ACCEPTED'],
    [result.targetLifecycleWithheldUntilReady, 'TARGET_UI_OPENED_EARLY'],
  ] as const;
  for (const [condition, suffix] of assertions) {
    if (!condition) {
      throw new Error(`WORKSPACE_ACTIVATION_PROOF_${suffix}`);
    }
  }
}

function readSafeErrorCode(error: unknown): string {
  const code =
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.message
        : undefined;
  return code !== undefined && /^[A-Z][A-Z0-9_]{2,120}$/u.test(code)
    ? code
    : 'UNAVAILABLE';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

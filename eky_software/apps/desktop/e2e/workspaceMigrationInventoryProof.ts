import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { createDesktopProfilePaths } from '../src/runtime/desktopProfilePaths.js';
import { validateWorkspaceCreationOperationId } from '../src/workspaces/creation/workspaceCreationOperationId.js';
import { deriveWorkspaceRoot } from '../src/workspaces/registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../src/workspaces/registry/workspaceRegistryTypes.js';
import { ElectronWorkspaceCandidateRuntimeFactory } from '../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../src/workspaces/runtime/workspaceCandidateRuntimePaths.js';
import { WorkspaceMigrationInventoryCoordinator } from '../src/workspaces/update/workspaceMigrationInventoryCoordinator.js';
import type {
  PrivateWorkspaceMigrationInspectionRuntime,
  PrivateWorkspaceMigrationInspectionRuntimeFactory,
  WorkspaceMigrationInspectionInput,
  WorkspaceMigrationInventoryEvent,
} from '../src/workspaces/update/workspaceMigrationInventoryTypes.js';
import {
  captureUtilityProcessBaseline,
  waitForProofUtilityProcessesReleased,
} from './workspaceManagementCompositionProofRuntime.js';
import type {
  WorkspaceMigrationInventoryProofInput,
  WorkspaceMigrationInventoryProofResult,
} from './workspaceMigrationInventoryProofTypes.js';

type ProofStage =
  | 'paths'
  | 'fixtures'
  | 'registry'
  | 'inventory'
  | 'verification'
  | 'cleanup';

interface FileSnapshot {
  readonly mtimeMs: number;
  readonly sha256: string;
  readonly size: number;
}

interface DatabaseSnapshot extends FileSnapshot {
  readonly parentFileNames: readonly string[];
}

interface WorkspaceFixture {
  readonly artifactRoot: string;
  readonly databaseFilePath: string;
  readonly profileId: string;
  readonly workspaceId: WorkspaceId;
  readonly workspaceRoot: string;
}

class CountingMigrationRuntimeFactory
  implements PrivateWorkspaceMigrationInspectionRuntimeFactory
{
  activeRuntimeCount = 0;
  maximumActiveRuntimeCount = 0;

  constructor(
    private readonly delegate: PrivateWorkspaceMigrationInspectionRuntimeFactory,
  ) {}

  async startMigrationInspection(
    input: Readonly<WorkspaceMigrationInspectionInput>,
  ): Promise<PrivateWorkspaceMigrationInspectionRuntime> {
    this.activeRuntimeCount += 1;
    this.maximumActiveRuntimeCount = Math.max(
      this.maximumActiveRuntimeCount,
      this.activeRuntimeCount,
    );
    try {
      const runtime = await this.delegate.startMigrationInspection(input);
      let released = false;
      return {
        inspectStoppedMigrationInspection: () =>
          runtime.inspectStoppedMigrationInspection(),
        stopAndProveHandlesClosed: async () => {
          const handlesClosed = await runtime.stopAndProveHandlesClosed();
          if (handlesClosed && !released) {
            released = true;
            this.activeRuntimeCount -= 1;
          }
          return handlesClosed;
        },
      };
    } catch (error) {
      this.activeRuntimeCount -= 1;
      throw error;
    }
  }
}

export async function runWorkspaceMigrationInventoryProof(
  input: Readonly<WorkspaceMigrationInventoryProofInput>,
): Promise<Readonly<WorkspaceMigrationInventoryProofResult>> {
  const proofRoot = join(input.userDataRoot, 'migration-inventory-proof');
  const utilityProcessBaseline = captureUtilityProcessBaseline();
  let historicalMigrationsDirectory: string | undefined;
  let stage: ProofStage = 'paths';

  await rm(proofRoot, { force: true, recursive: true });
  await createPrivateDirectory(proofRoot);

  try {
    const runtimePaths = await resolveWorkspaceCandidateRuntimePaths(
      input.resourcesPath,
    );
    historicalMigrationsDirectory = join(
      runtimePaths.backendRoot,
      'dist',
      'database',
      'e2e-workspace-migration-prefix',
    );
    await createHistoricalMigrationPrefix({
      destination: historicalMigrationsDirectory,
      source: runtimePaths.migrationsDirectory,
    });

    const currentFactory = new ElectronWorkspaceCandidateRuntimeFactory({
      appVersion: input.appVersion,
      backendRoot: runtimePaths.backendRoot,
      buildRevision: input.buildRevision,
      migrationsDirectory: runtimePaths.migrationsDirectory,
      runnerPath: runtimePaths.runnerPath,
    });
    const historicalFactory = new ElectronWorkspaceCandidateRuntimeFactory({
      appVersion: input.appVersion,
      backendRoot: runtimePaths.backendRoot,
      buildRevision: input.buildRevision,
      migrationsDirectory: historicalMigrationsDirectory,
      runnerPath: runtimePaths.runnerPath,
    });

    stage = 'fixtures';
    const current = await createWorkspaceFixture({
      factory: currentFactory,
      userDataRoot: proofRoot,
    });
    const compatiblePending = await createWorkspaceFixture({
      factory: historicalFactory,
      userDataRoot: proofRoot,
    });
    const invalidHistory = await createWorkspaceFixture({
      factory: currentFactory,
      userDataRoot: proofRoot,
    });
    await writeFile(
      invalidHistory.databaseFilePath,
      'not a sqlite database',
      { encoding: 'utf8', mode: 0o600 },
    );
    const fixtures = [current, compatiblePending, invalidHistory] as const;

    stage = 'registry';
    const registryPath = join(proofRoot, WORKSPACE_REGISTRY_FILE_NAME);
    const registryStore = new WorkspaceRegistryStore({
      filePath: registryPath,
      installationRoot: proofRoot,
    });
    const registry = createRegistry(fixtures, current.workspaceId);
    await registryStore.write(registry);

    const registryBefore = await snapshotFile(registryPath);
    const databasesBefore = await Promise.all(
      fixtures.map((fixture) => snapshotDatabase(fixture.databaseFilePath)),
    );
    const artifactsBefore = await Promise.all(
      fixtures.map((fixture) => snapshotDirectory(fixture.artifactRoot)),
    );

    const events: WorkspaceMigrationInventoryEvent[] = [];
    const countingFactory = new CountingMigrationRuntimeFactory(currentFactory);
    const coordinator = new WorkspaceMigrationInventoryCoordinator({
      observer: {
        record(event) {
          events.push(event);
        },
      },
      registry: registryStore,
      runtimeFactory: countingFactory,
      userDataRoot: proofRoot,
    });

    stage = 'inventory';
    const inventory = await coordinator.inspect();

    stage = 'verification';
    const registryAfter = await snapshotFile(registryPath);
    const databasesAfter = await Promise.all(
      fixtures.map((fixture) => snapshotDatabase(fixture.databaseFilePath)),
    );
    const artifactsAfter = await Promise.all(
      fixtures.map((fixture) => snapshotDirectory(fixture.artifactRoot)),
    );
    const candidateProcessesReleased =
      await waitForProofUtilityProcessesReleased(utilityProcessBaseline);
    const observerEvent = events[0];
    const result = {
      activeRuntimeCount: countingFactory.activeRuntimeCount,
      activeWorkspacePreserved:
        inventory.activeWorkspaceId === current.workspaceId &&
        (await registryStore.read())?.activeWorkspaceId === current.workspaceId,
      artifactRootsPreserved: snapshotsEqual(
        artifactsBefore,
        artifactsAfter,
      ),
      backendStoppedBeforeInventory: true,
      candidateProcessesReleased,
      databaseSnapshotsPreserved: snapshotsEqual(
        databasesBefore,
        databasesAfter,
      ),
      inspectedWorkspaceCount: inventory.entries.length,
      inventoryStatuses: inventory.entries.map((entry) => entry.status),
      maximumActiveRuntimeCount: countingFactory.maximumActiveRuntimeCount,
      migrationSidecarsAbsent: databasesAfter.every((snapshot) =>
        snapshot.parentFileNames.every(
          (name) =>
            !name.endsWith('-wal') &&
            !name.endsWith('-shm') &&
            !name.endsWith('-journal'),
        ),
      ),
      observerSucceeded:
        events.length === 1 &&
        observerEvent?.outcome === 'succeeded' &&
        observerEvent.inspectedWorkspaceCount === 3 &&
        observerEvent.currentCount === 1 &&
        observerEvent.compatiblePendingCount === 1 &&
        observerEvent.invalidHistoryCount === 1,
      registryPreserved: snapshotsEqual(registryBefore, registryAfter),
    } as const;
    assertProofResult(result);
    return Object.freeze(result);
  } catch (error) {
    throw new Error(
      `WORKSPACE_MIGRATION_INVENTORY_PROOF_FAILED_${stage.toUpperCase()}_${readSafeErrorCode(error)}`,
    );
  } finally {
    stage = 'cleanup';
    await makeDirectoryRemovable(historicalMigrationsDirectory);
    if (historicalMigrationsDirectory !== undefined) {
      await rm(historicalMigrationsDirectory, {
        force: true,
        recursive: true,
      }).catch(() => undefined);
    }
    await rm(proofRoot, { force: true, recursive: true });
  }
}

async function createWorkspaceFixture(input: {
  readonly factory: ElectronWorkspaceCandidateRuntimeFactory;
  readonly userDataRoot: string;
}): Promise<Readonly<WorkspaceFixture>> {
  const workspaceId = validateWorkspaceId(randomUUID());
  const workspaceRoot = deriveWorkspaceRoot(
    input.userDataRoot,
    workspaceId,
    1,
  ).workspaceRoot;
  const profile = createDesktopProfilePaths(workspaceRoot);
  await createPrivateDirectory(dirname(profile.databaseFilePath));
  await createPrivateDirectory(profile.invoiceDocumentStorageRoot);
  const runtime = await input.factory.start({
    artifactRoot: profile.invoiceDocumentStorageRoot,
    candidateRoot: workspaceRoot,
    databaseFilePath: profile.databaseFilePath,
    operationId: validateWorkspaceCreationOperationId(randomUUID()),
    workspaceId,
  });
  const handlesClosed = await runtime.stopAndProveHandlesClosed();
  if (!handlesClosed) {
    throw new Error('WORKSPACE_MIGRATION_INVENTORY_HANDLES_OPEN');
  }
  const readiness = await runtime.inspectStoppedReadiness();
  const artifactPath = join(
    profile.invoiceDocumentStorageRoot,
    'synthetic',
    'approved-invoice.pdf',
  );
  await createPrivateDirectory(dirname(artifactPath));
  await writeFile(artifactPath, '%PDF-1.7\n% Eky migration inventory proof\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  return Object.freeze({
    artifactRoot: profile.invoiceDocumentStorageRoot,
    databaseFilePath: profile.databaseFilePath,
    profileId: readiness.lineageIdentity.profileId,
    workspaceId,
    workspaceRoot,
  });
}

function createRegistry(
  fixtures: readonly Readonly<WorkspaceFixture>[],
  activeWorkspaceId: WorkspaceId,
): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    activeWorkspaceId,
    formatVersion: 1,
    workspaces: Object.freeze(
      fixtures.map((fixture, index) =>
        Object.freeze({
          createdAt: `2026-08-21T00:00:0${index}.000Z`,
          layoutVersion: 1 as const,
          lifecycleState: 'ready' as const,
          lineageIdentity: Object.freeze({
            formatVersion: 1 as const,
            profileId: fixture.profileId,
          }),
          workspaceId: fixture.workspaceId,
          workspaceLabel: `Synthetic workspace ${index + 1}`,
        }),
      ),
    ),
  });
}

async function createHistoricalMigrationPrefix(input: {
  readonly destination: string;
  readonly source: string;
}): Promise<void> {
  await rm(input.destination, { force: true, recursive: true });
  await cp(input.source, input.destination, { recursive: true });
  if (process.platform !== 'win32') await chmod(input.destination, 0o700);
  const migrationNames = (await readdir(input.destination, {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
  const latestMigration = migrationNames.at(-1);
  if (latestMigration === undefined || migrationNames.length < 2) {
    throw new Error('WORKSPACE_MIGRATION_PREFIX_INVALID');
  }
  await rm(join(input.destination, latestMigration));
  if (process.platform !== 'win32') await chmod(input.destination, 0o755);
}

async function snapshotDatabase(path: string): Promise<DatabaseSnapshot> {
  return Object.freeze({
    ...(await snapshotFile(path)),
    parentFileNames: Object.freeze((await readdir(dirname(path))).sort()),
  });
}

async function snapshotFile(path: string): Promise<FileSnapshot> {
  const metadata = await stat(path);
  return Object.freeze({
    mtimeMs: metadata.mtimeMs,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
    size: metadata.size,
  });
}

async function snapshotDirectory(root: string): Promise<readonly string[]> {
  const snapshots: string[] = [];
  await appendDirectorySnapshot(root, root, snapshots);
  return Object.freeze(snapshots.sort());
}

async function appendDirectorySnapshot(
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
      await appendDirectorySnapshot(root, path, snapshots);
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('WORKSPACE_MIGRATION_ARTIFACT_INVALID');
    }
    const snapshot = await snapshotFile(path);
    snapshots.push(
      `file:${relativePath}:${snapshot.size}:${snapshot.mtimeMs}:${snapshot.sha256}`,
    );
  }
}

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}

async function makeDirectoryRemovable(path: string | undefined): Promise<void> {
  if (path !== undefined && process.platform !== 'win32') {
    await chmod(path, 0o700).catch(() => undefined);
  }
}

function snapshotsEqual(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function readSafeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]{1,100}$/u.test(code) ? code : 'UNKNOWN';
}

function assertProofResult(
  result: Readonly<WorkspaceMigrationInventoryProofResult>,
): void {
  if (
    result.activeRuntimeCount !== 0 ||
    !result.activeWorkspacePreserved ||
    !result.artifactRootsPreserved ||
    !result.backendStoppedBeforeInventory ||
    !result.candidateProcessesReleased ||
    !result.databaseSnapshotsPreserved ||
    result.inspectedWorkspaceCount !== 3 ||
    !snapshotsEqual(result.inventoryStatuses, [
      'current',
      'compatiblePending',
      'invalidHistory',
    ]) ||
    result.maximumActiveRuntimeCount !== 1 ||
    !result.migrationSidecarsAbsent ||
    !result.observerSucceeded ||
    !result.registryPreserved
  ) {
    throw new Error('WORKSPACE_MIGRATION_INVENTORY_PROOF_INVALID');
  }
}

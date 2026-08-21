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
import { createProfileSnapshotRuntimePaths } from '../src/profileBackup/profileSnapshotRuntimePaths.js';
import { validateWorkspaceCreationOperationId } from '../src/workspaces/creation/workspaceCreationOperationId.js';
import { deriveWorkspaceRoot } from '../src/workspaces/registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../src/workspaces/registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../src/workspaces/registry/workspaceRegistryValidation.js';
import { ElectronWorkspaceCandidateRuntimeFactory } from '../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../src/workspaces/runtime/workspaceCandidateRuntimePaths.js';
import type { WorkspaceMigrationInspectionResult } from '../src/workspaces/update/workspaceMigrationInventoryTypes.js';

export interface WorkspaceFirstStartProofFixture {
  readonly artifactRoot: string;
  readonly databaseFilePath: string;
  readonly profileId: string;
  readonly workspaceId: WorkspaceId;
  readonly workspaceRoot: string;
}

export interface WorkspaceFirstStartProofFactories {
  readonly current: ElectronWorkspaceCandidateRuntimeFactory;
  readonly historical: ElectronWorkspaceCandidateRuntimeFactory;
  readonly runnerPath: string;
  cleanup(): Promise<void>;
}

interface FileSnapshot {
  readonly mtimeMs: number;
  readonly sha256: string;
  readonly size: number;
}

export async function createWorkspaceFirstStartProofFactories(input: {
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly resourcesPath: string;
}): Promise<Readonly<WorkspaceFirstStartProofFactories>> {
  const runtimePaths = await resolveWorkspaceCandidateRuntimePaths(
    input.resourcesPath,
  );
  const historicalMigrationsDirectory = join(
    runtimePaths.backendRoot,
    'dist',
    'database',
    `e2e-workspace-first-start-prefix-${randomUUID()}`,
  );
  await createHistoricalMigrationPrefix({
    destination: historicalMigrationsDirectory,
    source: runtimePaths.migrationsDirectory,
  });
  const common = {
    appVersion: input.appVersion,
    backendRoot: runtimePaths.backendRoot,
    buildRevision: input.buildRevision,
    runnerPath: runtimePaths.runnerPath,
  } as const;
  return Object.freeze({
    current: new ElectronWorkspaceCandidateRuntimeFactory({
      ...common,
      migrationsDirectory: runtimePaths.migrationsDirectory,
    }),
    historical: new ElectronWorkspaceCandidateRuntimeFactory({
      ...common,
      migrationsDirectory: historicalMigrationsDirectory,
    }),
    runnerPath: runtimePaths.runnerPath,
    async cleanup() {
      await makeDirectoryRemovable(historicalMigrationsDirectory);
      await rm(historicalMigrationsDirectory, {
        force: true,
        recursive: true,
      });
    },
  });
}

export async function createWorkspaceFirstStartProofFixture(input: {
  readonly factory: ElectronWorkspaceCandidateRuntimeFactory;
  readonly userDataRoot: string;
}): Promise<Readonly<WorkspaceFirstStartProofFixture>> {
  const workspaceId = validateWorkspaceId(randomUUID());
  const workspaceRoot = deriveWorkspaceRoot(
    input.userDataRoot,
    workspaceId,
    1,
  ).workspaceRoot;
  const profile = createDesktopProfilePaths(workspaceRoot);
  assertWindowsSnapshotPathBudget(profile.runtimeRoot);
  await createPrivateDirectory(dirname(profile.databaseFilePath));
  await createPrivateDirectory(profile.invoiceDocumentStorageRoot);
  const runtime = await input.factory.start({
    artifactRoot: profile.invoiceDocumentStorageRoot,
    candidateRoot: workspaceRoot,
    databaseFilePath: profile.databaseFilePath,
    operationId: validateWorkspaceCreationOperationId(randomUUID()),
    workspaceId,
  });
  if (!(await runtime.stopAndProveHandlesClosed())) {
    throw new Error('WORKSPACE_FIRST_START_PROOF_HANDLES_OPEN');
  }
  const readiness = await runtime.inspectStoppedReadiness();
  const artifactPath = join(
    profile.invoiceDocumentStorageRoot,
    'synthetic',
    'approved-invoice.pdf',
  );
  await createPrivateDirectory(dirname(artifactPath));
  await writeFile(
    artifactPath,
    '%PDF-1.7\n% Eky workspace first-start proof\n',
    { encoding: 'utf8', mode: 0o600 },
  );
  return Object.freeze({
    artifactRoot: profile.invoiceDocumentStorageRoot,
    databaseFilePath: profile.databaseFilePath,
    profileId: readiness.lineageIdentity.profileId,
    workspaceId,
    workspaceRoot,
  });
}

function assertWindowsSnapshotPathBudget(runtimeRoot: string): void {
  if (process.platform !== 'win32') {
    return;
  }
  const snapshotPaths = createProfileSnapshotRuntimePaths(runtimeRoot);
  const representativeOperationId = '11111111-1111-4111-8111-111111111111';
  const representativeSnapshotPath = join(
    snapshotPaths.stagingRoot,
    representativeOperationId,
    'profile.sqlite',
  );

  if (representativeSnapshotPath.length >= 260) {
    throw new Error('WORKSPACE_FIRST_START_PROOF_PATH_BUDGET_EXCEEDED');
  }
}

export function createWorkspaceFirstStartProofRegistry(
  fixtures: readonly Readonly<WorkspaceFirstStartProofFixture>[],
  activeWorkspaceId: WorkspaceId,
): Readonly<LocalWorkspaceRegistryV1> {
  return validateWorkspaceRegistry({
    activeWorkspaceId,
    formatVersion: 1,
    workspaces: fixtures.map((fixture, index) => ({
      createdAt: `2026-08-21T00:00:0${index}.000Z`,
      layoutVersion: 1 as const,
      lifecycleState: 'ready' as const,
      lineageIdentity: {
        formatVersion: 1 as const,
        profileId: fixture.profileId,
      },
      workspaceId: fixture.workspaceId,
      workspaceLabel: `First-start workspace ${index + 1}`,
    })),
  });
}

export async function inspectWorkspaceFirstStartProofFixture(
  factory: ElectronWorkspaceCandidateRuntimeFactory,
  fixture: Readonly<WorkspaceFirstStartProofFixture>,
): Promise<Readonly<WorkspaceMigrationInspectionResult>> {
  const runtime = await factory.startMigrationInspection({
    databaseFilePath: fixture.databaseFilePath,
    expectedProfileId: fixture.profileId,
    operationId: validateWorkspaceCreationOperationId(randomUUID()),
    publishedRoot: fixture.workspaceRoot,
  });
  try {
    if (!(await runtime.stopAndProveHandlesClosed())) {
      throw new Error('WORKSPACE_FIRST_START_PROOF_HANDLES_OPEN');
    }
    return await runtime.inspectStoppedMigrationInspection();
  } finally {
    await runtime.stopAndProveHandlesClosed().catch(() => false);
  }
}

export async function corruptWorkspaceFirstStartProofDatabase(
  fixture: Readonly<WorkspaceFirstStartProofFixture>,
): Promise<void> {
  await writeFile(fixture.databaseFilePath, 'not a sqlite database', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export async function snapshotWorkspaceFirstStartProofFile(
  path: string,
): Promise<Readonly<FileSnapshot>> {
  const metadata = await stat(path);
  return Object.freeze({
    mtimeMs: metadata.mtimeMs,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
    size: metadata.size,
  });
}

export async function snapshotWorkspaceFirstStartProofDirectory(
  root: string,
): Promise<readonly string[]> {
  const snapshots: string[] = [];
  await appendDirectorySnapshot(root, root, snapshots);
  return Object.freeze(snapshots.sort());
}

export function workspaceFirstStartProofSnapshotsEqual(
  first: unknown,
  second: unknown,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
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
    throw new Error('WORKSPACE_FIRST_START_PROOF_PREFIX_INVALID');
  }
  await rm(join(input.destination, latestMigration));
  if (process.platform !== 'win32') await chmod(input.destination, 0o755);
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
      throw new Error('WORKSPACE_FIRST_START_PROOF_ARTIFACT_INVALID');
    }
    const snapshot = await snapshotWorkspaceFirstStartProofFile(path);
    snapshots.push(
      `file:${relativePath}:${snapshot.size}:${snapshot.mtimeMs}:${snapshot.sha256}`,
    );
  }
}

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}

async function makeDirectoryRemovable(path: string): Promise<void> {
  if (process.platform !== 'win32') {
    await chmod(path, 0o700).catch(() => undefined);
  }
}

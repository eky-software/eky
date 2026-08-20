import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeBackupContainer } from '../src/profileBackup/container/backupContainerWriter.js';
import { createProfileBackupSourceEntries } from '../src/profileBackup/createProfileBackupSourceEntries.js';
import { validateWorkspaceBackupImportOperationId } from '../src/workspaces/import/workspaceBackupImportOperationId.js';
import { PrivateWorkspaceBackupCandidateAdapter } from '../src/workspaces/import/privateWorkspaceBackupCandidateAdapter.js';
import { deriveWorkspaceRoot } from '../src/workspaces/registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import type { WorkspaceId } from '../src/workspaces/registry/workspaceRegistryTypes.js';
import { ElectronWorkspaceCandidateRuntimeFactory } from '../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../src/workspaces/runtime/workspaceCandidateRuntimePaths.js';
import type { WorkspaceManagementCompositionProofInput } from './workspaceManagementCompositionProofTypes.js';

export const WORKSPACE_MANAGEMENT_PROOF_PASSWORD =
  'synthetic-composition-proof-password-Aa1!';

export async function createProofWorkspaceBackup(
  input: WorkspaceManagementCompositionProofInput & {
    readonly backupPath: string;
    readonly workspaceId: WorkspaceId;
  },
) {
  const readiness = await validateProofPublishedWorkspace(input);
  const workspaceRoot = deriveWorkspaceRoot(
    input.userDataRoot,
    input.workspaceId,
    1,
  ).workspaceRoot;
  const sourceRoot = join(
    input.userDataRoot,
    'workspace-composition-proof-backup-source',
    randomUUID(),
  );
  await mkdir(sourceRoot, { mode: 0o700, recursive: true });
  try {
    await copyFile(
      join(workspaceRoot, 'runtime', 'data', 'eky.sqlite'),
      join(sourceRoot, 'profile.sqlite'),
    );
    await writeFile(
      join(sourceRoot, 'snapshot-catalog-v1.json'),
      `${JSON.stringify({ artifacts: [], formatVersion: 1 })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    await writeBackupContainer({
      destinationPath: input.backupPath,
      entries: await createProfileBackupSourceEntries(sourceRoot),
      manifest: {
        appVersion: input.appVersion,
        createdAtEpochMilliseconds: BigInt(
          new Date('2026-08-20T00:00:00.000Z').getTime(),
        ),
        migrationChainIdentity: readiness.migrationChainIdentity,
        profileId: readiness.lineageIdentity.profileId,
      },
      password: WORKSPACE_MANAGEMENT_PROOF_PASSWORD,
    });
  } finally {
    await rm(sourceRoot, { force: true, recursive: true });
  }
  return readiness;
}

export async function validateProofPublishedWorkspace(
  input: WorkspaceManagementCompositionProofInput & {
    readonly expectedProfileId?: string;
    readonly workspaceId: WorkspaceId;
  },
) {
  const runtimePaths = await resolveWorkspaceCandidateRuntimePaths(
    input.resourcesPath,
  );
  const candidate = new PrivateWorkspaceBackupCandidateAdapter(
    new ElectronWorkspaceCandidateRuntimeFactory({
      appVersion: input.appVersion,
      backendRoot: runtimePaths.backendRoot,
      buildRevision: input.buildRevision,
      migrationsDirectory: runtimePaths.migrationsDirectory,
      runnerPath: runtimePaths.runnerPath,
    }),
  );
  const workspaceRoot = deriveWorkspaceRoot(
    input.userDataRoot,
    input.workspaceId,
    1,
  ).workspaceRoot;
  const registry = await readProofWorkspaceRegistry(input.userDataRoot);
  const entry = registry.workspaces.find(
    (workspace) => workspace.workspaceId === input.workspaceId,
  );
  const expectedProfileId =
    input.expectedProfileId ?? entry?.lineageIdentity.profileId;
  if (expectedProfileId === undefined) {
    throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
  }
  return candidate.validatePublished({
    artifactRoot: join(workspaceRoot, 'runtime', 'storage', 'invoices'),
    databaseFilePath: join(workspaceRoot, 'runtime', 'data', 'eky.sqlite'),
    expectedProfileId,
    operationId: validateWorkspaceBackupImportOperationId(randomUUID()),
    publishedRoot: workspaceRoot,
    workspaceId: input.workspaceId,
  });
}

export function readProofWorkspaceRegistry(userDataRoot: string) {
  return new WorkspaceRegistryStore({
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: userDataRoot,
  }).read().then((registry) => {
    if (registry === undefined) {
      throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
    }
    return registry;
  });
}

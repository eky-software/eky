import { chmod, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { deletionTestDigest as hash, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { readDeletionInventoryDirectoryIdentity } from './workspaceDeletionInventoryFile.js';
import { captureWorkspaceRemnantBinding, maximumWorkspaceRemnantBindingBytes, workspaceRemnantBindingKey,
  workspaceRemnantBindingSha256, type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore, type WorkspaceRemnantBindingCleanup } from './workspaceRemnantBindingStore.js';

export const remnantBindingTestOwners = ['workspaceReplacement', 'workspaceActivationMigration',
  'workspaceImport', 'workspaceLegacyAdoption', 'profileInspection'] as const;

export function remnantTestBinding(owner: WorkspaceRemnantBindingV1['owner'] = 'workspaceReplacement') {
  return captureWorkspaceRemnantBinding({ formatVersion: 1, owner, operationId: id(1), workspaceId: id(2),
    lineageIdentity: { formatVersion: 1, profileId: hash('lineage') },
    ...(owner === 'profileInspection' ? { generationId: id(3), rootIdentity: hash('copy-root'), parentIdentity: hash('copy-parent') } : {}) });
}

export async function remnantBindingFixture(context: TestContext, owner: WorkspaceRemnantBindingV1['owner'] = 'workspaceReplacement') {
  const root = await mkdtemp(join(tmpdir(), 'eky-remnant-binding-'));
  await chmod(root, 0o700);
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const binding = remnantTestBinding(owner);
  const key = workspaceRemnantBindingKey(binding);
  const paths = createWorkspaceRemnantBindingPaths(root, key);
  const fileSystem = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceRemnantBindingBytes);
  const store = (readDirectoryIdentity = readDeletionInventoryDirectoryIdentity) =>
    new WorkspaceRemnantBindingStore(root, key, fileSystem, readDirectoryIdentity);
  let owned = true;
  let external = true;
  let absent = true;
  const authority = { assertAuthority() { if (!owned) throw new Error('SYNTHETIC_LEASE_LOST'); },
    async assertExternalSelection() { if (!external) throw new Error('SYNTHETIC_TARGET_CHANGED'); } };
  const cleanup = (mode: WorkspaceRemnantBindingCleanup['mode'] = 'owner'): WorkspaceRemnantBindingCleanup => ({
    ...authority, mode, bindingSha256: workspaceRemnantBindingSha256(binding),
    async assertPayloadsAbsent() { if (!absent) throw new Error('SYNTHETIC_PAYLOAD_REMAINS'); },
  });
  return { root, binding, key, paths, fileSystem, store, authority, cleanup,
    expire() { owned = false; }, changeTarget() { external = false; }, payloadRemains() { absent = false; },
    async prepare() { await mkdir(paths.directoryPath, { recursive: true, mode: 0o700 }); },
    async snapshot() {
      const values: Record<string, string> = {};
      for (const name of await readdir(paths.directoryPath)) values[name] = (await readFile(join(paths.directoryPath, name))).toString('hex');
      return values;
    },
  };
}

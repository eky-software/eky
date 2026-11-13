import { lstat, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'vitest';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { deletionTestDigest as hash, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionRemnantReads as nativeReads } from './workspaceDeletionRemnantCensus.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

export const candidateObservationOwners = ['workspaceImport', 'workspaceLegacyAdoption'] as const;

export async function candidateObservationFixture(context: TestContext, owner: typeof candidateObservationOwners[number]) {
  const f = await remnantBindingFixture(context, owner);
  const authority = { ...f.authority,
    assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { authority.assertAuthority(); } };
  const candidate = deriveWorkspaceBackupImportPaths(f.root,
    validateWorkspaceBackupImportOperationId(f.binding.operationId), f.binding.workspaceId);
  const track = <T>(work: Promise<T>) => {
    context.onTestFinished(async () => { await work.catch(() => undefined); });
    return work;
  };
  return { ...f, authority, candidate, track,
    async publish() { await f.store().publish(f.binding, authority); },
    async addPayload() {
      await mkdir(candidate.candidateRoot, { recursive: true, mode: 0o700 });
      await writeFile(join(candidate.candidateRoot, 'retained-data'), 'synthetic-candidate', { flag: 'wx', mode: 0o600 });
    } };
}

export async function candidateObservationTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(directory: string, prefix: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) {
        result[relative + '/'] = 'directory';
        await walk(join(directory, entry.name), relative + '/');
      } else {
        if (!entry.isFile()) throw new Error('SYNTHETIC_UNEXPECTED_ENTRY');
        result[relative] = (await readFile(join(directory, entry.name))).toString('hex');
      }
    }
  }
  await walk(root, '');
  return result;
}

export async function candidateObservationEofFixture(context: TestContext, owner: typeof candidateObservationOwners[number]) {
  const f = await candidateObservationFixture(context, owner);
  await f.publish(); await f.addPayload();
  const foreign = captureWorkspaceRemnantBinding({ ...f.binding, operationId: id(9), workspaceId: id(8),
    lineageIdentity: { formatVersion: 1, profileId: hash('foreign-candidate') } });
  const foreignBindingPaths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(foreign));
  await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(foreign)).publish(foreign, f.authority);
  const foreignPaths = deriveWorkspaceBackupImportPaths(f.root,
    validateWorkspaceBackupImportOperationId(foreign.operationId), foreign.workspaceId);
  await mkdir(foreignPaths.candidateRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(foreignPaths.candidateRoot, 'keep'), 'foreign-candidate', { flag: 'wx', mode: 0o600 });
  await writeFile(join(f.root, 'unrelated'), 'unrelated-bytes', { flag: 'wx', mode: 0o600 });
  const originalBinding = await readFile(f.paths.currentPath), bindingIdentity = await lstat(f.paths.currentPath);
  const foreignBinding = await readFile(foreignBindingPaths.currentPath);
  const initialRootIdentity = await nativeReads.directoryIdentity(f.candidate.candidateRoot, f.authority.assertAuthority);
  const before = await candidateObservationTree(f.root), retained = join(f.root, 'retained-old-root');
  const expectedChangedTree = Object.freeze({ ...before, 'retained-old-root/': 'directory',
    'retained-old-root/retained-data': Buffer.from('synthetic-candidate').toString('hex') });
  const handles: { closeCalls: number; closed: boolean; pendingReads: number }[] = [];
  const fault: { armed: boolean; rootReads: number; injected: boolean;
    observedIdentity?: string; replacementIdentity?: string; changedTree?: Record<string, string> } = {
    armed: false, rootReads: 0, injected: false,
  };
  const reads: typeof nativeReads = { ...nativeReads,
    async directoryIdentity(path, guard) {
      const value = await nativeReads.directoryIdentity(path, guard);
      // R1 and R2 each read the real candidate twice. Replace only AFTER R2's last native result.
      if (fault.armed && path === f.candidate.candidateRoot && ++fault.rootReads === 4) {
        fault.observedIdentity = value;
        await rename(f.candidate.candidateRoot, retained); await f.addPayload();
        fault.injected = true;
        fault.replacementIdentity = await nativeReads.directoryIdentity(f.candidate.candidateRoot, guard);
        fault.changedTree = await candidateObservationTree(f.root);
      }
      return value;
    },
    async openDirectory(path) {
      const directory = await nativeReads.openDirectory(path);
      const handle = { closeCalls: 0, closed: false, pendingReads: 0 }; handles.push(handle);
      return {
        async read() {
          handle.pendingReads++;
          try { return await directory.read(); } finally { handle.pendingReads--; }
        },
        async close() { handle.closeCalls++; await directory.close(); handle.closed = true; },
      };
    },
  };
  return { ...f, foreignPaths, foreignBindingPaths, originalBinding, bindingIdentity, foreignBinding,
    initialRootIdentity, before, expectedChangedTree, retained, handles, fault, reads };
}

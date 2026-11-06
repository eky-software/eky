import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { createDesktopProfilePaths } from '../src/runtime/desktopProfilePaths.js';
import { acquireWorkspaceProcessReservation } from '../src/runtime/workspaceProcessReservation.js';
import { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../src/workspaces/creation/workspaceCreationJournalPaths.js';
import { serializeWorkspaceCreationJournal } from '../src/workspaces/creation/workspaceCreationJournalSerializer.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../src/workspaces/import/workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from '../src/workspaces/import/workspaceBackupImportJournalSerializer.js';
import { WorkspaceRemnantBindingStore } from '../src/workspaces/deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from '../src/workspaces/deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../src/workspaces/deletion/workspaceRemnantBindingPaths.js';
import { InMemoryWorkspaceMaintenanceLease } from '../src/workspaces/maintenance/workspaceMaintenanceLease.js';
import { deriveWorkspaceRoot } from '../src/workspaces/registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistryEntryV1, LocalWorkspaceRegistryV1 } from '../src/workspaces/registry/workspaceRegistryTypes.js';

/** Desktop-owned synthetic registry and journal; database preparation stays with its test owner. */
export async function prepareWorkspaceColdRecoveryRegistry(input: {
  readonly kind: 'creation' | 'import';
  readonly bindImport?: boolean;
  readonly userDataRoot: string;
  readonly prepareProfile: (input: {
    readonly paths: ReturnType<typeof createDesktopProfilePaths>;
    readonly role: 'original' | 'target';
  }) => Promise<{ readonly profileId: string; readonly preservedPaths: readonly string[] }>;
}) {
  if (process.env.EKY_E2E !== '1' || (input.kind !== 'creation' && input.kind !== 'import')
    || (input.bindImport !== undefined && typeof input.bindImport !== 'boolean')
    || (input.bindImport === true && input.kind !== 'import')) {
    throw new Error('WORKSPACE_COLD_PACKAGED_ADMISSION_FAILED');
  }
  const root = await realpath(input.userDataRoot);
  const relativeRoot = relative(join(await realpath(tmpdir()), 'eky-desktop-smoke'), root);
  const rootInfo = await lstat(input.userDataRoot);
  if (basename(relativeRoot) !== 'user-data' || !/^[a-f0-9]{32}$/.test(dirname(relativeRoot))
    || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('WORKSPACE_COLD_PACKAGED_ROOT_INVALID');
  }
  const reservation = await acquireWorkspaceProcessReservation({
    userDataRoot: root, signal: AbortSignal.timeout(5_000),
  });
  let firstError: unknown;
  let preparing = true;
  try {
    const original = await createWorkspace('Synthetic active workspace', 'original');
    const target = await createWorkspace('Synthetic interrupted workspace', 'target');
    const registry = new WorkspaceRegistryStore({ installationRoot: root,
      filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) });
    const initialRegistry: LocalWorkspaceRegistryV1 = { formatVersion: 1,
      activeWorkspaceId: original.entry.workspaceId, workspaces: [original.entry] };
    await registry.write(initialRegistry);
    const journal = { formatVersion: 2, operationId: randomUUID(), workspaceId: target.entry.workspaceId,
      workspaceLabel: target.entry.workspaceLabel, previousActiveWorkspaceId: original.entry.workspaceId,
      state: 'rootPublished', createdAt: target.entry.createdAt, lineageIdentity: target.entry.lineageIdentity };
    const journalPaths = input.kind === 'creation'
      ? createWorkspaceCreationJournalPaths(root, join(root, WORKSPACE_CREATION_JOURNAL_FILE_NAME))
      : createWorkspaceBackupImportJournalPaths(root, join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME));
    await writeFile(journalPaths.currentPath, input.kind === 'creation'
      ? serializeWorkspaceCreationJournal(journal) : serializeWorkspaceBackupImportJournal(journal),
    { flag: 'wx', mode: 0o600 });
    const binding = input.bindImport ? captureWorkspaceRemnantBinding({
      formatVersion: 1, owner: 'workspaceImport', operationId: journal.operationId,
      workspaceId: journal.workspaceId, lineageIdentity: journal.lineageIdentity,
    }) : undefined;
    if (binding !== undefined) {
      const maintenance = new InMemoryWorkspaceMaintenanceLease();
      const held = await maintenance.acquire('import');
      const assertLease = maintenance.captureCurrentOwner(['import'], held);
      const assertAuthority = () => {
        if (!preparing) throw new Error('WORKSPACE_COLD_PACKAGED_ADMISSION_FAILED');
        assertLease();
      };
      const authority = { assertAuthority, async assertExternalSelection() {
        assertAuthority(); await reservation.assertOwned(); assertAuthority();
      } };
      try {
        const store = new WorkspaceRemnantBindingStore(root, workspaceRemnantBindingKey(binding));
        await store.publish(binding, authority);
        const observed = await store.inspect(authority);
        if (observed.mode !== 'published' || !isDeepStrictEqual(observed.value, binding)) {
          throw new Error('WORKSPACE_COLD_PACKAGED_BINDING_MISSING');
        }
      } finally { await held.release(); }
    }
    const expectedRegistry: LocalWorkspaceRegistryV1 = {
      ...initialRegistry, workspaces: [original.entry, target.entry],
    };
    const before = await readIndependentFiles(target.preservedPaths);
    await reservation.assertOwned();
    return {
      expectedRegistry, journalPaths,
      bindingPaths: binding === undefined ? undefined : createWorkspaceRemnantBindingPaths(root, workspaceRemnantBindingKey(binding)),
      async verifyRecovered() {
        // Store reads can repair slots. Acquire the actual exclusion before inspection.
        const owner = await acquireWorkspaceProcessReservation({ userDataRoot: root, signal: AbortSignal.timeout(5_000) });
        let verificationError: unknown;
        let verifying = true;
        try {
          for (const path of [journalPaths.currentPath, journalPaths.nextPath, journalPaths.backupPath]) {
            try { await lstat(path); }
            catch (error) {
              if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
              throw error;
            }
            throw new Error('WORKSPACE_COLD_PACKAGED_JOURNAL_REMAINS');
          }
          if (!isDeepStrictEqual(await registry.read(), expectedRegistry)) throw new Error('WORKSPACE_COLD_PACKAGED_REGISTRY_MISMATCH');
          if (binding !== undefined) {
            const observed = await new WorkspaceRemnantBindingStore(root, workspaceRemnantBindingKey(binding)).inspect({
              assertAuthority() { if (!verifying) throw new Error('WORKSPACE_COLD_PACKAGED_ADMISSION_FAILED'); },
              async assertExternalSelection() { await owner.assertOwned(); },
            });
            if (observed.mode !== 'absent') throw new Error('WORKSPACE_COLD_PACKAGED_BINDING_REMAINS');
          }
          const after = await readIndependentFiles(target.preservedPaths);
          if (!before.every((bytes, index) => bytes.equals(after[index]!))) throw new Error('WORKSPACE_COLD_PACKAGED_CONTENT_CHANGED');
          await owner.assertOwned();
        } catch (error) { verificationError = error; throw error; }
        finally {
          verifying = false;
          try { await owner.release(); }
          catch (cleanupError) {
            throw new AggregateError([verificationError, cleanupError], 'WORKSPACE_COLD_PACKAGED_CLEANUP_FAILED',
              { cause: verificationError ?? cleanupError });
          }
        }
      },
    };
  } catch (error) { firstError = error; throw error; }
  finally {
    preparing = false;
    try { await reservation.release(); }
    catch (cleanupError) {
      throw new AggregateError([firstError, cleanupError], 'WORKSPACE_COLD_PACKAGED_CLEANUP_FAILED',
        { cause: firstError ?? cleanupError });
    }
  }

  async function createWorkspace(workspaceLabel: string, role: 'original' | 'target') {
    const workspaceId = validateWorkspaceId(randomUUID());
    const paths = createDesktopProfilePaths(deriveWorkspaceRoot(root, workspaceId, 1).workspaceRoot);
    await mkdir(paths.invoiceDocumentStorageRoot, { recursive: true, mode: 0o700 });
    const profile = await input.prepareProfile({ paths, role });
    const entry: LocalWorkspaceRegistryEntryV1 = { workspaceId, workspaceLabel, layoutVersion: 1, lifecycleState: 'ready',
      lineageIdentity: { formatVersion: 1, profileId: profile.profileId }, createdAt: '2026-08-21T00:01:00.000Z' };
    return { entry, preservedPaths: profile.preservedPaths };
  }
}

async function readIndependentFile(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size === 0) {
    throw new Error('WORKSPACE_COLD_PACKAGED_FILE_INVALID');
  }
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw new Error('WORKSPACE_COLD_PACKAGED_FILE_CHANGED');
  return bytes;
}

async function readIndependentFiles(paths: readonly string[]): Promise<Buffer[]> {
  let firstFailure: { error: unknown } | undefined;
  const results = await Promise.allSettled(paths.map(path => readIndependentFile(path).catch((error: unknown) => {
    firstFailure ??= { error }; throw error;
  })));
  if (firstFailure !== undefined) throw firstFailure.error;
  return results.map(result => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
}

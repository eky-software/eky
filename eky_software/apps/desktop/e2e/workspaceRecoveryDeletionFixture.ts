import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { acquireDesktopWorkspaceReservation } from '../src/main/desktopComposition.js';
import { WorkspaceRemnantBindingStore } from '../src/workspaces/deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from '../src/workspaces/deletion/workspaceRemnantBindingCodec.js';
import { WorkspaceBackupImportJournalStore } from '../src/workspaces/import/workspaceBackupImportJournalStore.js';
import { createNodeWorkspaceBackupImportJournalFileSystem, type WorkspaceBackupImportJournalFileSystem } from '../src/workspaces/import/workspaceBackupImportJournalFileSystem.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../src/workspaces/import/workspaceBackupImportJournalPaths.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES, getWorkspaceBackupImportStateIndex } from '../src/workspaces/import/workspaceBackupImportJournalValidation.js';
import { InMemoryWorkspaceMaintenanceLease } from '../src/workspaces/maintenance/workspaceMaintenanceLease.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';

// Only the isolated E2E assembly calls this after its real lifecycle has closed.
// It writes interruption metadata, never business data or a runtime-absence port.
export async function prepareWorkspaceRecoveryDeletionFixture(input: Readonly<{
  userDataRoot: string;
  workspaceId: string;
  assertMainCurrent(): void;
  assertAdmissionCurrent(): void;
  backendIsRunning(): boolean;
  journalFileSystem?: WorkspaceBackupImportJournalFileSystem;
}>) {
  const workspaceId = validateWorkspaceId(input.workspaceId);
  let firstFailure: { cause: unknown } | undefined;
  const pendingWriters = new Set<symbol>();
  const writerCloseFailures: unknown[] = [];
  const assertCleanupCurrent = () => {
    input.assertMainCurrent();
    if (input.backendIsRunning() !== false) throw new Error('WORKSPACE_RUNTIME_STILL_ACTIVE');
  };
  const assertCurrent = () => {
    if (firstFailure !== undefined) throw firstFailure.cause;
    try { input.assertAdmissionCurrent(); assertCleanupCurrent(); }
    catch (cause) { firstFailure ??= { cause }; throw cause; }
  };
  assertCurrent();
  const reservation = await acquireDesktopWorkspaceReservation({ userDataRoot: input.userDataRoot,
    assertSingleInstanceOwnership: assertCleanupCurrent, signal: new AbortController().signal });
  const failures: unknown[] = [];
  let held: Awaited<ReturnType<InMemoryWorkspaceMaintenanceLease['acquire']>> | undefined;
  try {
    const lease = new InMemoryWorkspaceMaintenanceLease();
    held = await lease.acquire('import');
    const leaseCurrent = lease.captureCurrentOwner(['import'], held);
    const authority = {
      assertAuthority() { assertCurrent(); leaseCurrent(); reservation.assertMainCurrent(); },
      async assertExternalSelection() {
        authority.assertAuthority(); await reservation.assertMainOwned(); authority.assertAuthority();
      },
    };
    await authority.assertExternalSelection();
    const registry = new WorkspaceRegistryStore({ installationRoot: input.userDataRoot,
      filePath: join(input.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME) });
    const selected = await registry.read();
    await authority.assertExternalSelection();
    const target = selected?.workspaces.find(entry => entry.workspaceId === workspaceId);
    if (selected === undefined || target === undefined) throw new Error('E2E_RECOVERY_DELETION_TARGET_MISSING');
    if (selected.activeWorkspaceId === target.workspaceId) throw new Error('E2E_RECOVERY_DELETION_SELF_IMPORT');
    const journalPath = join(input.userDataRoot, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
    const files = input.journalFileSystem ?? createNodeWorkspaceBackupImportJournalFileSystem(
      createWorkspaceBackupImportJournalPaths(input.userDataRoot, journalPath));
    const observeWriter = async <T>(work: () => Promise<T>): Promise<T> => {
      try { return await work(); }
      catch (cause) { firstFailure ??= { cause }; throw cause; }
    };
    const journal = new WorkspaceBackupImportJournalStore({ installationRoot: input.userDataRoot, filePath: journalPath,
      fileSystem: {
        readSlot: files.readSlot.bind(files), prepareDirectory: files.prepareDirectory.bind(files),
        moveSlot: files.moveSlot.bind(files), removeSlot: files.removeSlot.bind(files), syncDirectory: files.syncDirectory.bind(files),
        async createNextWriter(guard) {
          // Even a rejected creation may have opened a handle. Never infer closure.
          const token = Symbol(); pendingWriters.add(token);
          const writer = await observeWriter(() => files.createNextWriter(guard));
          const readIdentity = writer.readIdentity?.bind(writer);
          return {
            write: bytes => observeWriter(() => writer.write(bytes)),
            sync: () => observeWriter(() => writer.sync()),
            ...(readIdentity === undefined ? {} : { readIdentity: () => observeWriter(readIdentity) }),
            async close() {
              try { await observeWriter(() => writer.close()); pendingWriters.delete(token); }
              catch (cause) { writerCloseFailures.push(cause); throw cause; }
            },
          };
        },
      },
    });
    const slots = await journal.inspectSlots(authority.assertAuthority);
    if (Object.values(slots).some(slot => slot !== undefined)) throw new Error('E2E_RECOVERY_DELETION_JOURNAL_EXISTS');
    const operationId = randomUUID();
    const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceImport',
      workspaceId: target.workspaceId, operationId, lineageIdentity: target.lineageIdentity });
    const bindings = new WorkspaceRemnantBindingStore(input.userDataRoot, workspaceRemnantBindingKey(binding));
    if ((await bindings.inspect(authority)).mode !== 'absent') throw new Error('E2E_RECOVERY_DELETION_BINDING_EXISTS');
    await bindings.publish(binding, authority);
    for (const state of WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES) {
      await authority.assertExternalSelection();
      const selectedSlots = await journal.inspectSlots(authority.assertAuthority);
      await journal.writeSelected({ formatVersion: 2, operationId, workspaceId: target.workspaceId,
        workspaceLabel: target.workspaceLabel, previousActiveWorkspaceId: selected.activeWorkspaceId,
        createdAt: target.createdAt, state,
        lineageIdentity: getWorkspaceBackupImportStateIndex(state) >= getWorkspaceBackupImportStateIndex('candidateValidated')
          ? target.lineageIdentity : null }, {
        ...authority,
        expectedSlots: { current: selectedSlots.current?.bytes, next: selectedSlots.next?.bytes, backup: selectedSlots.backup?.bytes },
        expectedIdentities: { current: selectedSlots.current?.identity, next: selectedSlots.next?.identity,
          backup: selectedSlots.backup?.identity },
      });
      await authority.assertExternalSelection();
    }
  } catch (error) {
    failures.push(firstFailure === undefined ? error : firstFailure.cause);
    for (const cause of writerCloseFailures) if (!failures.includes(cause)) failures.push(cause);
  }
  finally {
    if (pendingWriters.size === 0) {
      let leaseClosed = held === undefined;
      try { await held?.release(); leaseClosed = true; } catch (error) { failures.push(error); }
      if (leaseClosed) {
        try { await reservation.assertMainOwned(); await reservation.close(); } catch (error) { failures.push(error); }
      }
    } else if (failures.length === 0) {
      failures.push(new Error('E2E_RECOVERY_DELETION_WRITER_CLOSE_UNVERIFIED'));
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'E2E_RECOVERY_DELETION_PREPARATION_FAILED', { cause: failures[0] });
}

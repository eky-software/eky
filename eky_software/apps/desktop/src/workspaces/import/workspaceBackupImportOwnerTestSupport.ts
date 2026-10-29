import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import { publishImportedWorkspaceEntry } from './workspaceBackupImportRegistry.js';
import type { WorkspaceBackupImportOwner } from './workspaceBackupImportOwner.js';
import type { MemoryWorkspaceBackupImportJournal, MemoryWorkspaceBackupImportRegistry,
  MemoryWorkspaceBackupImportRootStore, RecordingImportActiveWorkspaceLifecycle,
  RecordingImportMaintenanceLease, RecordingImportRuntimeAbsence } from './workspaceBackupImportTestSupport.js';

// Model for coordinator unit tests. Real file/receipt contracts have separate tests.
export function createRecordingImportOwner(f: {
  events: string[]; lease: RecordingImportMaintenanceLease; journal: MemoryWorkspaceBackupImportJournal;
  registry: MemoryWorkspaceBackupImportRegistry; root: MemoryWorkspaceBackupImportRootStore;
  lifecycle: RecordingImportActiveWorkspaceLifecycle; runtimeAbsence: RecordingImportRuntimeAbsence;
}) {
  let uncertain = false;
  return (lease: WorkspaceMaintenanceLeaseHandle): WorkspaceBackupImportOwner => {
    const assertLease = f.lease.captureCurrentOwner(lease);
    const generation = () => { if (uncertain) throw new Error('SYNTHETIC_IMPORT_OWNER_UNCERTAIN'); };
    const current = () => { generation(); assertLease(); };
    const physical = () => {
      generation();
      if (f.lifecycle.runningRuntimeOwners !== 0 || f.lifecycle.openDatabaseHandleOwners !== 0) throw new Error('SYNTHETIC_MAIN_NOT_OWNED');
    };
    current(); f.events.push('owner.capture');
    return {
      assertCurrent: current,
      assertMainCurrent() { current(); physical(); },
      async assertMainOwned() { current(); physical(); },
      onUncertain() { uncertain = true; f.events.push('owner.uncertain'); },
      onTerminalAfterRelease() {
        generation();
        if (f.lease.held) throw new Error('SYNTHETIC_IMPORT_NOT_RELEASED');
        f.events.push('owner.terminal'); f.lifecycle.completeReturn();
      },
      createBinding(input) {
        current(); physical();
        let selection = input.registrySelection.current!;
        let published = false; let retired = false; let failed = false;
        const check = async () => {
          current(); physical();
          await f.runtimeAbsence.assertNoActiveWorkspaceRuntime(); current();
          const slots = await f.registry.inspectSlots(current);
          if (!slots.current || !Buffer.from(slots.current.bytes).equals(Buffer.from(selection.bytes)) ||
            !sameCrashSafeFileSlotIdentity(slots.current.identity, selection.identity!)) throw new Error('SYNTHETIC_REGISTRY_CHANGED');
        };
        const run = async (work: () => Promise<void>) => {
          try {
            if (failed) throw new Error('SYNTHETIC_IMPORT_BINDING_UNCERTAIN');
            await work();
          } catch (error) {
            if (!failed) { failed = true; input.onUncertain(); }
            throw error;
          }
        };
        const bound = async () => {
          if (!published || retired) throw new Error('SYNTHETIC_IMPORT_BINDING_NOT_PUBLISHED');
          await check();
        };
        return {
          publish: () => run(async () => {
            await check(); await input.assertJournalSelection(); await check();
            if (published) throw new Error('SYNTHETIC_IMPORT_ALREADY_PUBLISHED');
            published = true; f.events.push('binding.publish');
          }),
          assertPublished: () => run(bound),
          assertMutationCurrent() {
            current(); physical();
            if (failed || !published || retired) throw new Error('SYNTHETIC_IMPORT_BINDING_NOT_PUBLISHED');
          },
          publishRegistry: (entry, checkJournal) => run(async () => {
            await bound(); await checkJournal();
            const expected = publishImportedWorkspaceEntry(selection.value, entry);
            await f.registry.write(expected);
            selection = (await f.registry.inspectSlots(current)).current!;
            await checkJournal(); await check();
          }),
          clearAfterPayloadsAbsent: (absent, checkJournal) => run(async () => {
            await bound(); await checkJournal(); await absent(); await check();
            published = false; retired = true; f.events.push('binding.clear');
          }),
          assertRetired: absent => run(async () => {
            if (!retired) throw new Error('SYNTHETIC_IMPORT_BINDING_NOT_RETIRED');
            await check(); await absent(); await check();
          }),
        };
      },
    };
  };
}

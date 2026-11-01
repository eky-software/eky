import type { CrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryHeader } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceInspectionRemnantAbsence, type WorkspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingInvalidCode as invalidCode,
  workspaceRemnantBindingKey, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { WorkspaceRemnantBindingStore, type WorkspaceRemnantBindingCleanup } from './workspaceRemnantBindingStore.js';

export type WorkspaceInspectionBindingCleanupAuthority = WorkspaceInspectionRemnantAuthority;

// Pre-inventory owner cleanup only; deletionPurged retains its separate committed-inventory contract.
export async function clearAbsentWorkspaceInspectionBinding(
  userDataRoot: string, targetValue: unknown, bindingValue: unknown, authority: WorkspaceInspectionBindingCleanupAuthority,
  dependencies: { readonly fileSystem?: CrashSafeFileSlotFileSystem; readonly reads?: WorkspaceInspectionRemnantReads;
    readonly expectedOwnerSlots?: WorkspaceRemnantBindingCleanup['expectedOwnerSlots'] } = {},
): Promise<void> {
  const target = captureDeletionInventoryHeader(targetValue);
  const binding = captureWorkspaceRemnantBinding(bindingValue);
  if (binding.owner !== 'profileInspection' || binding.workspaceId !== target.workspaceId ||
      binding.lineageIdentity.profileId !== target.lineageIdentity.profileId) return invalidDeletionData(invalidCode);
  const checkAuthority = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = authority.assertExternalSelection.bind(authority);
  const writersAbsent = authority.assertWritersAbsent.bind(authority);
  let failed = false;
  let firstFailure: unknown;
  const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return error; };
  const assertAuthority = () => {
    if (failed) throw firstFailure;
    try { checkAuthority(); } catch (error) { throw retain(error); }
  };
  const capturedAuthority = { assertAuthority, async assertExternalSelection() {
    try {
      assertAuthority(); await external(); assertAuthority();
      await writersAbsent(); assertAuthority();
      await external(); assertAuthority();
    } catch (error) { throw retain(error); }
  } };
  const store = new WorkspaceRemnantBindingStore(userDataRoot, workspaceRemnantBindingKey(binding), dependencies.fileSystem);
  const observed = await store.inspect(capturedAuthority);
  assertAuthority();
  const bindingSha256 = workspaceRemnantBindingSha256(binding);
  if (observed.mode !== 'published' || observed.bindingSha256 !== bindingSha256) return invalidDeletionData(invalidCode);
  const absence = await captureWorkspaceInspectionRemnantAbsence(userDataRoot, binding, capturedAuthority, dependencies.reads);
  assertAuthority();
  try {
    await store.clearAfterPayloadsAbsent(binding, { ...capturedAuthority, mode: 'owner', bindingSha256,
      expectedOwnerSlots: dependencies.expectedOwnerSlots ?? observed.slots, async assertPayloadsAbsent() {
        try { await absence.assertAbsent(); } catch (error) { throw retain(error); }
      } });
  } catch (error) {
    // The low-level file owner may generalize a guard error; keep our first cause before that boundary.
    if (failed) throw firstFailure;
    throw error;
  }
  assertAuthority();
  await absence.assertAbsent();
  assertAuthority();
  if ((await store.inspect(capturedAuthority)).mode !== 'absent') return invalidDeletionData(invalidCode);
  assertAuthority();
}

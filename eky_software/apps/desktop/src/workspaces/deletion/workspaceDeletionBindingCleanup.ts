import type { CrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { captureWorkspaceCandidateRemnantSelection } from './workspaceCandidateRemnantSelection.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryHeader } from './workspaceDeletionInventoryCodec.js';
import { workspaceDeletionRemnantReads } from './workspaceDeletionRemnantCensus.js';
import { clearAbsentWorkspaceInspectionBinding } from './workspaceInspectionBindingCleanup.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { captureWorkspaceLegacyRemnantSelection } from './workspaceLegacyRemnantSelection.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingInvalidCode as invalidCode,
  workspaceRemnantBindingKey, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { WorkspaceRemnantBindingStore, type WorkspaceRemnantBindingCleanup } from './workspaceRemnantBindingStore.js';
import { captureWorkspaceReplacementRemnantSelection } from './workspaceReplacementRemnantSelection.js';

// Before the final inventory baseline only. Never removes a payload or grants deletion authority.
export async function clearAbsentWorkspaceDeletionBinding(
  userDataRoot: string, targetValue: unknown, bindingValue: unknown, authority: WorkspaceInspectionRemnantAuthority,
  dependencies: { readonly fileSystem?: CrashSafeFileSlotFileSystem; readonly reads?: typeof workspaceDeletionRemnantReads;
    readonly expectedOwnerSlots?: WorkspaceRemnantBindingCleanup['expectedOwnerSlots'] } = {},
): Promise<void> {
  const target = captureDeletionInventoryHeader(targetValue), binding = captureWorkspaceRemnantBinding(bindingValue);
  if (binding.workspaceId !== target.workspaceId || binding.lineageIdentity.profileId !== target.lineageIdentity.profileId) {
    return invalidDeletionData(invalidCode);
  }
  if (binding.owner === 'profileInspection') {
    return clearAbsentWorkspaceInspectionBinding(userDataRoot, target, binding, authority, dependencies);
  }
  const checkAuthority = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  let failed = false;
  let firstFailure: unknown;
  const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return error; };
  const assertAuthority = () => {
    if (failed) throw firstFailure;
    try { checkAuthority(); } catch (error) { throw retain(error); }
  };
  const guarded = { assertAuthority, async assertExternalSelection() {
    try {
      assertAuthority(); await authority.assertExternalSelection(); assertAuthority();
      await authority.assertWritersAbsent(); assertAuthority();
      await authority.assertExternalSelection(); assertAuthority();
    } catch (error) { throw retain(error); }
  }, async assertWritersAbsent() {
    try {
      assertAuthority(); await authority.assertWritersAbsent(); assertAuthority();
    } catch (error) { throw retain(error); }
  } };
  // Selection owners already bracket the writer with original selection checks.
  const sourceAuthority = { ...guarded, async assertExternalSelection() {
    try {
      assertAuthority(); await authority.assertExternalSelection(); assertAuthority();
    } catch (error) { throw retain(error); }
  } };
  const reads = dependencies.reads ?? workspaceDeletionRemnantReads;
  const selected = binding.owner === 'workspaceReplacement' || binding.owner === 'workspaceActivationMigration'
    ? await captureWorkspaceReplacementRemnantSelection(userDataRoot, binding.operationId, sourceAuthority, reads)
    : await captureWorkspaceCandidateRemnantSelection(userDataRoot, binding.operationId, binding.workspaceId, sourceAuthority, reads);
  const bindingSha256 = workspaceRemnantBindingSha256(binding);
  if (selected.bindingSha256 !== bindingSha256) return invalidDeletionData(invalidCode);
  const legacy = binding.owner === 'workspaceLegacyAdoption'
    ? await captureWorkspaceLegacyRemnantSelection(userDataRoot, sourceAuthority, reads) : undefined;
  if (legacy?.entries.some(entry => entry.value !== null)) return invalidDeletionData(invalidCode);
  const assertPayloadsAbsent = async () => {
    try {
      await selected.assertPayloadsAbsent();
      if (legacy !== undefined) {
        await legacy.assertSelected();
        await selected.assertPayloadsAbsent();
      }
      assertAuthority();
    } catch (error) { throw retain(error); }
  };
  const store = new WorkspaceRemnantBindingStore(userDataRoot, workspaceRemnantBindingKey(binding), dependencies.fileSystem);
  try {
    await store.clearAfterPayloadsAbsent(binding, { ...guarded, mode: 'owner', bindingSha256,
      expectedOwnerSlots: dependencies.expectedOwnerSlots ?? selected.ownerSlots, assertPayloadsAbsent });
    assertAuthority();
    await assertPayloadsAbsent();
    if ((await store.inspect(guarded)).mode !== 'absent') return invalidDeletionData(invalidCode);
    await assertPayloadsAbsent();
    assertAuthority();
  } catch (error) {
    // Preserve the first owner failure if the lower file owner reports a generic guard error.
    if (failed) throw firstFailure;
    throw error;
  }
}

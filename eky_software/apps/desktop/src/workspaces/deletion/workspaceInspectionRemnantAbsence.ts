import { lstat } from 'node:fs/promises';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { readDeletionInventoryDirectoryIdentity } from './workspaceDeletionInventoryFile.js';
import { assertSameWorkspaceInspectionRemnants, observeWorkspaceInspectionRemnants,
  type WorkspaceInspectionRemnantObservation, type WorkspaceInspectionRemnantReads } from './workspaceInspectionRemnantObservation.js';
import { workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';
import type { WorkspaceRemnantBindingAuthority } from './workspaceRemnantBindingStore.js';

export type { WorkspaceInspectionRemnantReads } from './workspaceInspectionRemnantObservation.js';

export const workspaceInspectionRemnantReads: WorkspaceInspectionRemnantReads = Object.freeze({
  directoryIdentity: readDeletionInventoryDirectoryIdentity,
  async assertAbsent(path: string, assertCurrent: () => void) {
    assertCurrent();
    try { await lstat(path); }
    catch (error) {
      // A rejected read must not be replaced by later authority loss.
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      assertCurrent();
      return;
    }
    assertCurrent();
    return invalidDeletionData(invalidCode);
  },
});

// Readonly selection for metadata-only cleanup. It never removes a payload or acquires authority.
export async function captureWorkspaceInspectionRemnantAbsence(
  userDataRoot: string, binding: unknown, authority: WorkspaceRemnantBindingAuthority,
  reads: WorkspaceInspectionRemnantReads = workspaceInspectionRemnantReads,
) {
  const assertCurrent = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = authority.assertExternalSelection.bind(authority);
  let failed = false;
  const guard = () => { if (failed) return invalidDeletionData(invalidCode); assertCurrent(); };
  const selection = async () => { guard(); await external(); guard(); };
  const observe = () => observeWorkspaceInspectionRemnants(userDataRoot, binding, guard, reads, true);
  let baseline: WorkspaceInspectionRemnantObservation;
  try {
    await selection();
    baseline = await observe();
    await selection();
    assertSameWorkspaceInspectionRemnants(baseline, await observe());
    guard();
  } catch (error) { failed = true; throw error; }
  return Object.freeze({ async assertAbsent(): Promise<void> {
    try {
      await selection();
      assertSameWorkspaceInspectionRemnants(baseline, await observe());
      await selection();
      assertSameWorkspaceInspectionRemnants(baseline, await observe());
      guard();
    } catch (error) { failed = true; throw error; }
  } });
}

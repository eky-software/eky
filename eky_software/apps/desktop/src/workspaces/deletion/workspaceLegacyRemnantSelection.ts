import { join } from 'node:path';
import { deriveWorkspaceLegacyRuntimePaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { workspaceOwnedEntryNames } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { workspaceDeletionDirectoryReads } from './workspaceDeletionDirectoryEntries.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { readWorkspaceLegacyEntryIdentity, readWorkspaceLegacyRuntimeIdentity } from './workspaceLegacyRemnantReads.js';
import { workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';
import { observeWorkspaceRemnantBindings } from './workspaceRemnantBindingEnumeration.js';
import { createWorkspaceRemnantBindingOwnerDirectoryPaths } from './workspaceRemnantBindingPaths.js';
import { assertSameWorkspaceRemnantBindingSelection, type WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantParents } from './workspaceRemnantParentSelection.js';

export const workspaceLegacyRemnantReads = Object.freeze({ ...workspaceDeletionDirectoryReads,
  runtimeIdentity: readWorkspaceLegacyRuntimeIdentity, entryIdentity: readWorkspaceLegacyEntryIdentity });
type Published = Extract<Awaited<ReturnType<WorkspaceRemnantBindingStore['inspect']>>, { mode: 'published' }>;

// No target filtering, database open, metadata cleanup or payload mutation. The candidate has its own census.
export async function captureWorkspaceLegacyRemnantSelection(
  userDataRoot: string, authority: WorkspaceInspectionRemnantAuthority, reads = workspaceLegacyRemnantReads,
) {
  const paths = deriveWorkspaceLegacyRuntimePaths(userDataRoot);
  const check = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  let failed = false;
  const guard = () => { if (failed) return invalidDeletionData(invalidCode); check(); };
  const external = async () => {
    guard(); await authority.assertExternalSelection(); guard();
    await authority.assertWritersAbsent(); guard();
    await authority.assertExternalSelection(); guard();
  };
  const guarded = { assertAuthority: guard, assertExternalSelection: authority.assertExternalSelection.bind(authority),
    assertWritersAbsent: authority.assertWritersAbsent.bind(authority) };
  const parents = await captureWorkspaceRemnantParents([paths.userDataRoot], guarded, reads);
  const metadataPaths = createWorkspaceRemnantBindingOwnerDirectoryPaths(paths.userDataRoot, 'workspaceLegacyAdoption');
  const metadata = await captureWorkspaceRemnantParents(metadataPaths.ancestors, guarded, reads, parents.identities);
  const runtimeIdentity = reads.runtimeIdentity.bind(reads), entryIdentity = reads.entryIdentity.bind(reads);
  const readRoots = async () => {
    await external();
    const parentIdentity = await runtimeIdentity(paths.legacyRuntimeRoot, guard);
    guard();
    const entries = [];
    for (const member of workspaceOwnedEntryNames) {
      guard();
      const rootPath = join(paths.legacyRuntimeRoot, member);
      const value = await entryIdentity(rootPath, guard);
      guard();
      if (parentIdentity === null && value !== null) return invalidDeletionData(invalidCode);
      entries.push(Object.freeze({ member, rootPath, value }));
    }
    if (parentIdentity !== await runtimeIdentity(paths.legacyRuntimeRoot, guard)) return invalidDeletionData(invalidCode);
    await parents.assertSelected();
    guard();
    return Object.freeze({ parentIdentity, entries: Object.freeze(entries) });
  };
  const readOwner = async (): Promise<Published> => {
    await metadata.assertSelected();
    let selected: Published | undefined;
    // Every published adoption binding claims this one legacy source; never choose the first company.
    for await (const row of observeWorkspaceRemnantBindings(paths.userDataRoot, 'workspaceLegacyAdoption',
      { assertAuthority: guard, assertExternalSelection: external }, reads)) {
      if (selected !== undefined) return invalidDeletionData(invalidCode);
      selected = row.binding;
    }
    await metadata.assertSelected();
    if (selected === undefined) return invalidDeletionData(invalidCode);
    return selected;
  };
  const sameRoots = (left: Awaited<ReturnType<typeof readRoots>>, right: Awaited<ReturnType<typeof readRoots>>) => {
    if (left.parentIdentity !== right.parentIdentity || left.entries.some((entry, index) =>
      entry.value?.kind !== right.entries[index]!.value?.kind || entry.value?.identity !== right.entries[index]!.value?.identity)) {
      return invalidDeletionData(invalidCode);
    }
  };
  const observe = async () => {
    const roots = await readRoots();
    const hasPayload = roots.entries.some(entry => entry.value !== null);
    const binding = hasPayload ? await readOwner() : undefined;
    sameRoots(roots, await readRoots());
    if (binding !== undefined) assertSameWorkspaceRemnantBindingSelection(binding, await readOwner());
    // The last metadata scan is an await boundary too; recheck the fixed payload roots, not the whole census.
    sameRoots(roots, await readRoots());
    guard();
    return Object.freeze({ roots, binding });
  };
  let baseline: Awaited<ReturnType<typeof observe>>;
  try { baseline = await observe(); } catch (error) { failed = true; throw error; }
  return Object.freeze({
    rootPath: paths.legacyRuntimeRoot, ancestorIdentities: parents.identities, ...baseline.roots,
    binding: baseline.binding?.value, bindingSha256: baseline.binding?.bindingSha256,
    async assertSelected() {
      try {
        const fresh = await observe();
        sameRoots(baseline.roots, fresh.roots);
        if ((baseline.binding === undefined) !== (fresh.binding === undefined)) return invalidDeletionData(invalidCode);
        if (baseline.binding !== undefined && fresh.binding !== undefined) {
          assertSameWorkspaceRemnantBindingSelection(baseline.binding, fresh.binding);
        }
        guard();
      } catch (error) { failed = true; throw error; }
    },
  });
}

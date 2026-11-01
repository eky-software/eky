import { join } from 'node:path';
import { parseProfileInspectionCopyDirectoryName } from '../../runtime/profileInspectionMessages.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { observeWorkspaceDeletionDirectoryEntries, workspaceDeletionDirectoryReads,
  type WorkspaceDeletionDirectoryReads } from './workspaceDeletionDirectoryEntries.js';
import { workspaceInspectionRemnantReads, type WorkspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { captureWorkspaceInspectionRemnantSource } from './workspaceInspectionRemnantSelection.js';
import { workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';
import { observeWorkspaceRemnantBindings } from './workspaceRemnantBindingEnumeration.js';
import { assertSameWorkspaceRemnantBindingSelection, type WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantParents } from './workspaceRemnantParentSelection.js';
import { deriveWorkspaceReplacementRemnantParents } from './workspaceReplacementRemnantPaths.js';
import { captureWorkspaceReplacementRemnantSelection } from './workspaceReplacementRemnantSelection.js';

const nativeReads = Object.freeze({ ...workspaceDeletionDirectoryReads, ...workspaceInspectionRemnantReads });
type Reads = WorkspaceDeletionDirectoryReads & WorkspaceInspectionRemnantReads;
type Parent = ReturnType<typeof deriveWorkspaceReplacementRemnantParents>[number];
type Replacement = Awaited<ReturnType<typeof captureWorkspaceReplacementRemnantSelection>>;
type Inspection = Awaited<ReturnType<typeof captureWorkspaceInspectionRemnantSource>>;
type Observation =
  | Readonly<{ kind: 'parent'; role: Parent['role']; rootPath: string; ancestorIdentities: readonly (string | null)[] }>
  | Readonly<{ kind: 'replacement'; selection: Replacement }>
  | Readonly<{ kind: 'inspection'; selection: Inspection }>;

// Enumerates actual roots, including foreign ownership. Full metadata/payload EOF comparison is still required.
export async function* observeWorkspaceReplacementRemnants(
  userDataRoot: string, authority: WorkspaceInspectionRemnantAuthority, reads: Reads = nativeReads,
): AsyncGenerator<Observation, void> {
  const parents = [];
  for (const path of deriveWorkspaceReplacementRemnantParents(userDataRoot)) {
    parents.push({ path, selected: await captureWorkspaceRemnantParents(path.ancestors, authority, reads) });
  }
  for (const { path, selected } of parents) {
    await selected.assertSelected();
    yield Object.freeze({ kind: 'parent', role: path.role, rootPath: path.parentPath, ancestorIdentities: selected.identities });
    await selected.assertSelected();
  }
  const groups = groupedNames(parents, authority, reads);
  let failed = false;
  let failure: unknown;
  try {
    while (true) {
      const next = await groups.next();
      if (next.done) break;
      const group = next.value;
      const { name, locations } = group;
      const generationId = parseProfileInspectionCopyDirectoryName(name);
      if (generationId !== undefined) {
        if (locations.length !== 1) return invalidDeletionData(invalidCode);
        const { path, selected } = locations[0]!;
        const guarded = { assertAuthority: selected.assertCurrent, assertExternalSelection: selected.assertSelected,
          assertWritersAbsent: authority.assertWritersAbsent.bind(authority) };
        if (path.role !== 'activationStaging' && path.role !== 'activationFailed') return invalidDeletionData(invalidCode);
        const binding = await findUniqueWorkspaceInspectionBinding(userDataRoot, generationId, guarded, reads);
        const source = await captureWorkspaceInspectionRemnantSource(userDataRoot, binding.value, authority, { reads });
        if (source.location.rootPath !== join(path.parentPath, name) || source.location.scope !== 'replacement') {
          return invalidDeletionData(invalidCode);
        }
        assertAncestors(selected.identities, source.root.ancestors);
        assertSameWorkspaceRemnantBindingSelection(binding, await findUniqueWorkspaceInspectionBinding(userDataRoot, generationId, guarded, reads));
        await source.assertSelected();
        await selected.assertSelected();
        yield Object.freeze({ kind: 'inspection', selection: source });
        assertSameWorkspaceRemnantBindingSelection(binding, await findUniqueWorkspaceInspectionBinding(userDataRoot, generationId, guarded, reads));
        await source.assertSelected();
      } else {
        const operationId = validateWorkspaceBackupReplacementOperationId(name);
        const source = await captureWorkspaceReplacementRemnantSelection(userDataRoot, operationId, authority, reads);
        for (const { path, selected } of parents) {
          const root = source.roots.find(value => value.role === path.role);
          const listed = locations.some(location => location.path.role === path.role);
          if (root === undefined || (root.rootIdentity !== null) !== listed || root.rootPath !== join(path.parentPath, name)) {
            return invalidDeletionData(invalidCode);
          }
          assertAncestors(selected.identities, root.ancestors);
        }
        for (const { selected } of parents) await selected.assertSelected();
        yield Object.freeze({ kind: 'replacement', selection: source });
        await source.assertSelected();
      }
      for (const { selected } of parents) await selected.assertSelected();
    }
  } catch (error) { failed = true; failure = error; }
  finally {
    try { await groups.return(); }
    catch (error) {
      if (failed) throw new AggregateError([failure, error], invalidCode);
      throw error;
    }
    if (failed) throw failure;
  }
  // Pin all four original parent observations across the whole pass, including absences.
  for (const { selected } of parents) await selected.assertSelected();
}

// Four fixed sorted readers, not an operation-id set growing with history.
async function* groupedNames(
  parents: readonly Readonly<{ path: Parent; selected: Awaited<ReturnType<typeof captureWorkspaceRemnantParents>> }>[],
  authority: WorkspaceInspectionRemnantAuthority, reads: Reads,
) {
  const sources = parents.filter(({ selected }) => selected.identities.at(-1) !== null).map(location => ({
    ...location,
    source: observeWorkspaceDeletionDirectoryEntries(location.path.parentPath,
      { assertAuthority: location.selected.assertCurrent, assertExternalSelection: location.selected.assertSelected }, reads),
    next: undefined as IteratorResult<string, void> | undefined,
  }));
  let failed = false;
  let failure: unknown;
  try {
    for (const entry of sources) entry.next = await entry.source.next();
    while (true) {
      authority.assertAuthority();
      let name: string | undefined;
      for (const entry of sources) if (entry.next !== undefined && !entry.next.done &&
          (name === undefined || entry.next.value < name)) name = entry.next.value;
      if (name === undefined) break;
      const locations = sources.filter(entry => !entry.next!.done && entry.next!.value === name);
      yield { name, locations };
      for (const entry of locations) entry.next = await entry.source.next();
    }
  } catch (error) { failed = true; failure = error; }
  finally {
    const errors: unknown[] = [];
    if (failed) errors.push(failure);
    for (const entry of sources) {
      try { await entry.source.return(); } catch (error) { errors.push(error); }
    }
    if (errors.length > 1) throw new AggregateError(errors, invalidCode);
    if (errors.length === 1) throw errors[0];
  }
}

export async function findUniqueWorkspaceInspectionBinding(
  root: string, generationId: string, authority: WorkspaceInspectionRemnantAuthority, reads: Reads,
) {
  let selected: Extract<Awaited<ReturnType<WorkspaceRemnantBindingStore['inspect']>>,
    { mode: 'published' }> | undefined;
  // Filenames bind operation as well as generation. A generation alone is not a lookup key or permission to pick the first match.
  for await (const row of observeWorkspaceRemnantBindings(root, 'profileInspection', authority, reads)) {
    if (row.binding.value.owner !== 'profileInspection') return invalidDeletionData(invalidCode);
    if (row.binding.value.generationId !== generationId) continue;
    if (selected !== undefined) return invalidDeletionData(invalidCode);
    selected = row.binding;
  }
  if (selected === undefined) return invalidDeletionData(invalidCode);
  return selected;
}

function assertAncestors(before: readonly (string | null)[], after: readonly (string | null)[]) {
  if (before.length !== after.length || before.some((value, index) => value !== after[index])) return invalidDeletionData(invalidCode);
}

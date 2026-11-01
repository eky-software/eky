import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { workspaceInspectionRemnantReads, type WorkspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { workspaceRemnantBindingInvalidCode as invalidCode, type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { inspectWorkspaceRemnantBindingOwnerDirectory } from './workspaceRemnantBindingDirectory.js';
import { assertSameWorkspaceRemnantBindingSelection, WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { deriveWorkspaceReplacementRemnantParents, deriveWorkspaceReplacementRemnantRoot } from './workspaceReplacementRemnantPaths.js';

const owners = ['workspaceReplacement', 'workspaceActivationMigration'] as const;

// One operation only. Full parent enumeration and fresh inventory comparison still belong to the publisher.
export async function captureWorkspaceReplacementRemnantSelection(
  userDataRoot: string, operationIdValue: unknown, authority: WorkspaceInspectionRemnantAuthority,
  reads: WorkspaceInspectionRemnantReads = workspaceInspectionRemnantReads,
) {
  const operationId = validateWorkspaceBackupReplacementOperationId(operationIdValue);
  const checkAuthority = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  let failed = false;
  const guard = () => { if (failed) return invalidDeletionData(invalidCode); checkAuthority(); };
  const selection = async () => {
    guard(); await authority.assertExternalSelection(); guard();
    await authority.assertWritersAbsent(); guard();
    await authority.assertExternalSelection(); guard();
  };
  const guarded = { assertAuthority: guard, assertExternalSelection: selection };
  const identity = reads.directoryIdentity.bind(reads), absent = reads.assertAbsent.bind(reads);
  const stores = owners.map(owner => new WorkspaceRemnantBindingStore(userDataRoot, { owner, operationId }));
  const readBinding = async (index: number) => {
    const directory = await inspectWorkspaceRemnantBindingOwnerDirectory(userDataRoot, owners[index]!, guard, identity);
    const binding = await stores[index]!.inspect(guarded);
    const after = await inspectWorkspaceRemnantBindingOwnerDirectory(userDataRoot, owners[index]!, guard, identity);
    guard();
    if (directory.identities.some((value, position) => value !== after.identities[position])) return invalidDeletionData(invalidCode);
    return Object.freeze({ directory, binding });
  };
  const readBindings = async () => {
    await selection();
    const result = [];
    for (let index = 0; index < owners.length; index++) result.push(await readBinding(index));
    await selection();
    return Object.freeze(result);
  };
  const assertBindings = (expected: Awaited<ReturnType<typeof readBindings>>, actual: Awaited<ReturnType<typeof readBindings>>) => {
    if (expected.length !== actual.length) return invalidDeletionData(invalidCode);
    expected.forEach((before, index) => {
      const after = actual[index]!;
      if (before.directory.identities.some((value, position) => value !== after.directory.identities[position])) return invalidDeletionData(invalidCode);
      assertSameWorkspaceRemnantBindingSelection(before.binding, after.binding);
    });
  };
  const readAncestors = async (paths: readonly string[]) => {
    const result: (string | null)[] = [];
    let missing = false;
    for (const path of paths) {
      guard();
      let current: string;
      try { current = await identity(path, guard); }
      catch (error) {
        guard();
        if (path === userDataRoot || (error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
        missing = true; result.push(null); continue;
      }
      guard();
      if (missing) return invalidDeletionData(invalidCode);
      result.push(current);
    }
    return Object.freeze(result);
  };
  const readRoots = async (binding: WorkspaceRemnantBindingV1) => {
    const roots = [];
    for (const parent of deriveWorkspaceReplacementRemnantParents(userDataRoot, binding.workspaceId)) {
      const paths = deriveWorkspaceReplacementRemnantRoot(userDataRoot, binding.workspaceId, operationId, parent.role);
      const ancestors = await readAncestors(parent.ancestors);
      guard();
      let rootIdentity: string | null = null;
      try { rootIdentity = await identity(paths.rootPath, guard); }
      catch (error) { guard(); if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error; }
      guard();
      if (rootIdentity === null) await absent(paths.rootPath, guard);
      guard();
      const after = await readAncestors(parent.ancestors);
      if (ancestors.some((value, index) => value !== after[index]) ||
          (rootIdentity !== null && after.some(value => value === null))) return invalidDeletionData(invalidCode);
      if (rootIdentity === null) await absent(paths.rootPath, guard);
      else if (await identity(paths.rootPath, guard) !== rootIdentity) return invalidDeletionData(invalidCode);
      guard();
      // Migration never owns the separate backup-import payload, even with a matching operation id.
      if (parent.role === 'replacementImport' && rootIdentity !== null && binding.owner !== 'workspaceReplacement') {
        return invalidDeletionData(invalidCode);
      }
      roots.push(Object.freeze({ role: parent.role, rootPath: paths.rootPath, rootIdentity,
        parentIdentity: after.at(-1)!, ancestors: after }));
    }
    return Object.freeze(roots);
  };
  const assertRoots = (expected: Awaited<ReturnType<typeof readRoots>>, actual: Awaited<ReturnType<typeof readRoots>>) => {
    if (expected.length !== actual.length || expected.some((before, index) => {
      const after = actual[index]!;
      return before.role !== after.role || before.rootPath !== after.rootPath ||
        before.rootIdentity !== after.rootIdentity || before.parentIdentity !== after.parentIdentity ||
        before.ancestors.some((value, position) => value !== after.ancestors[position]);
    })) return invalidDeletionData(invalidCode);
  };
  const observe = async () => {
    const bindings = await readBindings();
    const published = bindings.flatMap(value => value.binding.mode === 'published' ? [value.binding] : []);
    if (published.length !== 1) return invalidDeletionData(invalidCode);
    const binding = published[0]!;
    const roots = await readRoots(binding.value);
    assertBindings(bindings, await readBindings());
    // Metadata awaits cannot leave the earlier payload observation unchecked.
    assertRoots(roots, await readRoots(binding.value));
    // A payload read cannot accept a newly conflicting metadata owner either.
    assertBindings(bindings, await readBindings());
    guard();
    return Object.freeze({ bindings, binding: binding.value, bindingSha256: binding.bindingSha256, roots });
  };
  let baseline: Awaited<ReturnType<typeof observe>>;
  try { baseline = await observe(); } catch (error) { failed = true; throw error; }
  const ownerIndex = owners.findIndex(owner => owner === baseline.binding.owner);
  const assertCleanupBindings = async () => {
    for (let index = 0; index < owners.length; index++) {
      const before = baseline.bindings[index]!;
      const directory = await inspectWorkspaceRemnantBindingOwnerDirectory(userDataRoot, owners[index]!, guard, identity);
      if (before.directory.identities.some((value, position) => value !== directory.identities[position])) return invalidDeletionData(invalidCode);
      if (index !== ownerIndex) assertBindings([before], [await readBinding(index)]);
    }
  };
  return Object.freeze({ binding: baseline.binding, bindingSha256: baseline.bindingSha256, roots: baseline.roots,
    ownerSlots: baseline.bindings[ownerIndex]!.binding.slots,
    // Own slots are checked by the byte-store's removal guard, not this payload-only proof.
    async assertPayloadsAbsent() {
      try {
        if (baseline.roots.some(root => root.rootIdentity !== null)) return invalidDeletionData(invalidCode);
        await selection();
        await assertCleanupBindings();
        assertRoots(baseline.roots, await readRoots(baseline.binding));
        await selection();
        await assertCleanupBindings();
        assertRoots(baseline.roots, await readRoots(baseline.binding));
        await assertCleanupBindings();
        guard();
      } catch (error) { failed = true; throw error; }
    },
    async assertSelected() {
      try {
        const fresh = await observe();
        assertBindings(baseline.bindings, fresh.bindings);
        assertRoots(baseline.roots, fresh.roots);
        guard();
      } catch (error) { failed = true; throw error; }
    } });
}

import { deriveWorkspaceLegacyAdoptionPaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';
import { workspaceInspectionRemnantReads, type WorkspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { captureWorkspaceRemnantBindingKey, workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';
import { inspectWorkspaceRemnantBindingOwnerDirectory } from './workspaceRemnantBindingDirectory.js';
import { assertSameWorkspaceRemnantBindingSelection, WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

// Readonly selection of one candidate, never its shared operation parent or a cleanup authority.
export async function captureWorkspaceCandidateRemnantSelection(
  userDataRoot: string, operationIdValue: unknown, workspaceIdValue: unknown,
  authority: WorkspaceInspectionRemnantAuthority,
  reads: WorkspaceInspectionRemnantReads = workspaceInspectionRemnantReads,
) {
  createWorkspaceDeletionJournalPaths(userDataRoot);
  const operationId = validateWorkspaceBackupImportOperationId(operationIdValue);
  const workspaceId = validateWorkspaceId(workspaceIdValue);
  const paths = deriveWorkspaceBackupImportPaths(userDataRoot, operationId, workspaceId);
  const adoptionPaths = deriveWorkspaceLegacyAdoptionPaths(userDataRoot, operationId, workspaceId);
  if (paths.candidateRoot !== adoptionPaths.candidateRoot || paths.operationRoot !== adoptionPaths.operationRoot ||
      paths.operationsRoot !== adoptionPaths.operationsRoot) return invalidDeletionData(invalidCode);
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
  const keys = [
    captureWorkspaceRemnantBindingKey({ owner: 'workspaceImport', operationId }),
    captureWorkspaceRemnantBindingKey({ owner: 'workspaceLegacyAdoption', workspaceId }),
  ];
  const stores = keys.map(key => new WorkspaceRemnantBindingStore(userDataRoot, key));
  const readBinding = async (index: number) => {
    const directory = await inspectWorkspaceRemnantBindingOwnerDirectory(userDataRoot, keys[index]!.owner, guard, identity);
    const binding = await stores[index]!.inspect(guarded);
    const after = await inspectWorkspaceRemnantBindingOwnerDirectory(userDataRoot, keys[index]!.owner, guard, identity);
    guard();
    if (directory.identities.some((value, position) => value !== after.identities[position])) return invalidDeletionData(invalidCode);
    return Object.freeze({ directory, binding });
  };
  const readBindings = async () => {
    await selection();
    const result = [];
    for (let index = 0; index < keys.length; index++) result.push(await readBinding(index));
    await selection();
    return Object.freeze(result);
  };
  const assertBindings = (before: Awaited<ReturnType<typeof readBindings>>, after: Awaited<ReturnType<typeof readBindings>>) => {
    if (before.length !== after.length) return invalidDeletionData(invalidCode);
    before.forEach((value, index) => {
      if (value.directory.identities.some((entry, position) => entry !== after[index]!.directory.identities[position])) {
        return invalidDeletionData(invalidCode);
      }
      assertSameWorkspaceRemnantBindingSelection(value.binding, after[index]!.binding);
    });
  };
  const ancestorPaths = [paths.userDataRoot, paths.operationsRoot, paths.operationRoot];
  const readAncestors = async () => {
    const result: (string | null)[] = [];
    let missing = false;
    for (const path of ancestorPaths) {
      guard();
      let current: string;
      try { current = await identity(path, guard); }
      catch (error) {
        guard();
        if (path === paths.userDataRoot || (error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
        missing = true; result.push(null); continue;
      }
      guard();
      if (missing) return invalidDeletionData(invalidCode);
      result.push(current);
    }
    return Object.freeze(result);
  };
  const readRoot = async () => {
    const before = await readAncestors();
    let rootIdentity: string | null = null;
    guard();
    try { rootIdentity = await identity(paths.candidateRoot, guard); }
    catch (error) { guard(); if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error; }
    guard();
    if (rootIdentity === null) await absent(paths.candidateRoot, guard);
    guard();
    const ancestors = await readAncestors();
    if (before.some((value, index) => value !== ancestors[index]) ||
        (rootIdentity !== null && ancestors.some(value => value === null))) return invalidDeletionData(invalidCode);
    if (rootIdentity === null) await absent(paths.candidateRoot, guard);
    else if (rootIdentity !== await identity(paths.candidateRoot, guard)) return invalidDeletionData(invalidCode);
    guard();
    return Object.freeze({ rootIdentity, ancestors, parentIdentity: ancestors.at(-1)! });
  };
  const assertRoot = (before: Awaited<ReturnType<typeof readRoot>>, after: Awaited<ReturnType<typeof readRoot>>) => {
    if (before.rootIdentity !== after.rootIdentity || before.parentIdentity !== after.parentIdentity ||
        before.ancestors.some((value, index) => value !== after.ancestors[index])) return invalidDeletionData(invalidCode);
  };
  const observe = async () => {
    const bindings = await readBindings();
    const imported = bindings[0]!.binding;
    if (imported.mode === 'published' && imported.value.workspaceId !== workspaceId) return invalidDeletionData(invalidCode);
    // The workspace-keyed legacy binding may describe another operation; it cannot own this candidate.
    const matching = bindings.flatMap(({ binding }) => binding.mode === 'published' &&
      binding.value.operationId === operationId && binding.value.workspaceId === workspaceId ? [binding] : []);
    if (matching.length !== 1) return invalidDeletionData(invalidCode);
    const binding = matching[0]!;
    const root = await readRoot();
    assertBindings(bindings, await readBindings());
    assertRoot(root, await readRoot());
    assertBindings(bindings, await readBindings());
    guard();
    return Object.freeze({ bindings, binding: binding.value, bindingSha256: binding.bindingSha256, root });
  };
  let baseline: Awaited<ReturnType<typeof observe>>;
  try { baseline = await observe(); } catch (error) { failed = true; throw error; }
  const ownerIndex = keys.findIndex(key => key.owner === baseline.binding.owner);
  const assertCleanupBindings = async () => {
    for (let index = 0; index < keys.length; index++) {
      const before = baseline.bindings[index]!;
      const directory = await inspectWorkspaceRemnantBindingOwnerDirectory(userDataRoot, keys[index]!.owner, guard, identity);
      if (before.directory.identities.some((value, position) => value !== directory.identities[position])) return invalidDeletionData(invalidCode);
      if (index !== ownerIndex) assertBindings([before], [await readBinding(index)]);
    }
  };
  return Object.freeze({
    binding: baseline.binding, bindingSha256: baseline.bindingSha256,
    ownerSlots: baseline.bindings[ownerIndex]!.binding.slots,
    role: baseline.binding.owner === 'workspaceImport' ? 'importCandidate' as const : 'adoptionCandidate' as const,
    rootPath: paths.candidateRoot, parentPath: paths.operationRoot, ...baseline.root,
    // Adoption's legacy roots remain a separate required proof at the cleanup caller.
    async assertPayloadsAbsent() {
      try {
        if (baseline.root.rootIdentity !== null) return invalidDeletionData(invalidCode);
        await selection();
        await assertCleanupBindings();
        assertRoot(baseline.root, await readRoot());
        await selection();
        await assertCleanupBindings();
        assertRoot(baseline.root, await readRoot());
        await assertCleanupBindings();
        guard();
      } catch (error) { failed = true; throw error; }
    },
    async assertSelected() {
      try {
        const fresh = await observe();
        assertBindings(baseline.bindings, fresh.bindings);
        assertRoot(baseline.root, fresh.root);
        guard();
      } catch (error) { failed = true; throw error; }
    },
  });
}

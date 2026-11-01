import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { workspaceInspectionRemnantReads, type WorkspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import { assertSameWorkspaceInspectionRemnants, observeWorkspaceInspectionRemnants,
  type WorkspaceInspectionRemnantObservation, type WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingInvalidCode as invalidCode,
  workspaceRemnantBindingKey, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

// Selection only: neither the evidence row nor this receipt authorizes a physical deletion.
export async function captureWorkspaceInspectionRemnantSelection(
  userDataRoot: string, targetValue: unknown, bindingValue: unknown,
  authority: WorkspaceInspectionRemnantAuthority,
  dependencies: { readonly coveringWorkspace?: unknown; readonly fileSystem?: CrashSafeFileSlotFileSystem;
    readonly reads?: WorkspaceInspectionRemnantReads } = {},
) {
  const target = captureDeletionInventoryHeader(targetValue);
  const binding = captureWorkspaceRemnantBinding(bindingValue);
  if (binding.owner !== 'profileInspection' || binding.workspaceId !== target.workspaceId ||
      binding.lineageIdentity.profileId !== target.lineageIdentity.profileId) return invalidDeletionData(invalidCode);
  const workspace = dependencies.coveringWorkspace === undefined ? undefined
    : captureDeletionInventoryRecord(dependencies.coveringWorkspace);
  if (workspace !== undefined && workspace.role !== 'workspace') return invalidDeletionData(invalidCode);
  const source = await captureWorkspaceInspectionRemnantSource(userDataRoot, binding, authority, dependencies);
  return Object.freeze({ record: projectWorkspaceInspectionRemnantInventoryRecord(userDataRoot, target, source,
    workspace), assertSelected: source.assertSelected });
}

// Pure projection of the existing owner's observation, not a replacement for its filesystem checks.
export function projectWorkspaceInspectionRemnantInventoryRecord(
  userDataRoot: string, targetValue: unknown,
  source: Pick<Awaited<ReturnType<typeof captureWorkspaceInspectionRemnantSource>>, 'binding' | 'bindingSha256' | 'location' | 'root'>,
  coveringWorkspace?: unknown,
) {
  const target = captureDeletionInventoryHeader(targetValue);
  const binding = captureWorkspaceRemnantBinding(source.binding);
  if (binding.owner !== 'profileInspection' || binding.workspaceId !== target.workspaceId ||
      binding.lineageIdentity.profileId !== target.lineageIdentity.profileId ||
      source.bindingSha256 !== workspaceRemnantBindingSha256(binding) ||
      source.root.rootIdentity !== binding.rootIdentity || source.root.ancestors.at(-1) !== binding.parentIdentity) {
    return invalidDeletionData(invalidCode);
  }
  const workspace = coveringWorkspace === undefined ? undefined : captureDeletionInventoryRecord(coveringWorkspace);
  if (workspace !== undefined && workspace.role !== 'workspace') return invalidDeletionData(invalidCode);
  const internal = source.location.scope === 'workspace';
  if (internal) {
    if (workspace === undefined) return invalidDeletionData(invalidCode);
    const { workspaceRoot, workspacesRoot } = deriveWorkspaceRoot(userDataRoot, target.workspaceId, 1);
    const ancestors = source.location.ancestors;
    if (source.root.ancestors[ancestors.indexOf(workspaceRoot)] !== workspace.rootIdentity ||
        source.root.ancestors[ancestors.indexOf(workspacesRoot)] !== workspace.parentIdentity) return invalidDeletionData(invalidCode);
  }
  return captureDeletionInventoryRecord({ role: internal ? 'inspectionEvidence' : 'inspection',
    ownerOperationId: binding.operationId, generationId: binding.generationId, member: null,
    rootIdentity: binding.rootIdentity, parentIdentity: binding.parentIdentity, bindingSha256: source.bindingSha256 });
}

// Unfiltered readonly ownership observation. Building a target inventory row still requires the wrapper above.
export async function captureWorkspaceInspectionRemnantSource(
  userDataRoot: string, bindingValue: unknown, authority: WorkspaceInspectionRemnantAuthority,
  dependencies: { readonly fileSystem?: CrashSafeFileSlotFileSystem; readonly reads?: WorkspaceInspectionRemnantReads } = {},
) {
  const state = await captureWorkspaceInspectionRemnantState(userDataRoot, bindingValue, authority, dependencies);
  if (state.selected === undefined) return invalidDeletionData(invalidCode);
  return Object.freeze({ binding: state.binding, bindingSha256: state.bindingSha256,
    ...state.selected, assertSelected: state.assertSelected });
}

// The metadata side also observes a payloadless owner. Absence here is not permission to clear its slots.
export async function captureWorkspaceInspectionRemnantState(
  userDataRoot: string, bindingValue: unknown, authority: WorkspaceInspectionRemnantAuthority,
  dependencies: { readonly fileSystem?: CrashSafeFileSlotFileSystem; readonly reads?: WorkspaceInspectionRemnantReads } = {},
) {
  const binding = captureWorkspaceRemnantBinding(bindingValue);
  if (binding.owner !== 'profileInspection') return invalidDeletionData(invalidCode);
  const paths = deriveWorkspaceInspectionRemnantPaths(userDataRoot, binding);
  const reads = dependencies.reads ?? workspaceInspectionRemnantReads;
  const checkAuthority = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = authority.assertExternalSelection.bind(authority);
  const writersAbsent = authority.assertWritersAbsent.bind(authority);
  let failed = false;
  const guard = () => { if (failed) return invalidDeletionData(invalidCode); checkAuthority(); };
  const selection = async () => {
    guard(); await external(); guard(); await writersAbsent(); guard(); await external(); guard();
  };
  const store = new WorkspaceRemnantBindingStore(userDataRoot, workspaceRemnantBindingKey(binding), dependencies.fileSystem);
  const bindingSha256 = workspaceRemnantBindingSha256(binding);
  const initial = await store.inspect({ assertAuthority: guard, assertExternalSelection: selection });
  if (initial.mode !== 'published' || initial.bindingSha256 !== bindingSha256) return invalidDeletionData(invalidCode);
  const assertBinding = async () => {
    const fresh = await store.inspect({ assertAuthority: guard, assertExternalSelection: selection });
    guard();
    if (fresh.mode !== 'published' || fresh.bindingSha256 !== bindingSha256) return invalidDeletionData(invalidCode);
    for (const slot of ['current', 'next', 'backup'] as const) {
      const before = initial.slots[slot], after = fresh.slots[slot];
      if (before === undefined ? after !== undefined : after === undefined || before.identity === undefined ||
          after.identity === undefined || !sameCrashSafeFileSlotIdentity(before.identity, after.identity) ||
          !Buffer.from(before.bytes).equals(Buffer.from(after.bytes))) return invalidDeletionData(invalidCode);
    }
  };
  const rootFor = (observed: WorkspaceInspectionRemnantObservation) => {
    const present = observed.flatMap((value, index) => value.rootIdentity === null ? [] : [index]);
    if (present.length === 0) return undefined;
    if (present.length !== 1) return invalidDeletionData(invalidCode);
    const index = present[0]!;
    const root = observed[index]!;
    if (root.rootIdentity !== binding.rootIdentity || root.ancestors.at(-1) !== binding.parentIdentity) {
      return invalidDeletionData(invalidCode);
    }
    return { location: paths[index]!, root };
  };
  const observe = async () => {
    await selection(); await assertBinding();
    const observed = await observeWorkspaceInspectionRemnants(userDataRoot, binding, guard, reads, false);
    const selected = rootFor(observed);
    await selection(); await assertBinding();
    assertSameWorkspaceInspectionRemnants(observed,
      await observeWorkspaceInspectionRemnants(userDataRoot, binding, guard, reads, false));
    await selection(); await assertBinding();
    guard();
    return { observed, selected };
  };
  let baseline: Awaited<ReturnType<typeof observe>>;
  const assertSelected = async () => {
    try {
      const fresh = await observe();
      assertSameWorkspaceInspectionRemnants(baseline.observed, fresh.observed);
      guard();
    } catch (error) { failed = true; throw error; }
  };
  try { baseline = await observe(); await assertSelected(); }
  catch (error) { failed = true; throw error; }
  return Object.freeze({ binding, bindingSha256, observed: baseline.observed, selected: baseline.selected, assertSelected });
}

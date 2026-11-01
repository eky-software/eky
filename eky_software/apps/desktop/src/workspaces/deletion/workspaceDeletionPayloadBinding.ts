import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryRecord,
  type WorkspaceDeletionInventoryHeader, type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { captureWorkspaceRemnantBindingKey, workspaceRemnantBindingInvalidCode as invalidCode,
  type WorkspaceRemnantBindingKey, type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { inspectWorkspaceRemnantBindingOwnerDirectory } from './workspaceRemnantBindingDirectory.js';
import { assertSameWorkspaceRemnantBindingSelection, WorkspaceRemnantBindingStore,
  type WorkspaceRemnantBindingSelection } from './workspaceRemnantBindingStore.js';

type DirectorySelection = Awaited<ReturnType<typeof inspectWorkspaceRemnantBindingOwnerDirectory>>;
type Observation = Readonly<{ directory: DirectorySelection; binding: WorkspaceRemnantBindingSelection }>;

// Metadata only: payload identity, inventory membership and deletion permission belong to the executor.
export async function captureWorkspaceDeletionPayloadBinding(
  root: string, targetValue: unknown, recordValue: unknown, authority: WorkspaceInspectionRemnantAuthority,
): Promise<Readonly<{ binding: WorkspaceRemnantBindingV1 | undefined; assertSelected(): Promise<void> }>> {
  createWorkspaceDeletionJournalPaths(root);
  const target = captureDeletionInventoryHeader(targetValue), record = captureDeletionInventoryRecord(recordValue);
  const keys = workspaceDeletionPayloadBindingKeys(target, record);
  const check = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = authority.assertExternalSelection.bind(authority), writers = authority.assertWritersAbsent.bind(authority);
  let failed = false;
  let firstFailure: unknown;
  const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return firstFailure; };
  const guard = () => {
    if (failed) throw firstFailure;
    try { check(); } catch (error) { throw retain(error); }
  };
  const assertExternalSelection = async () => {
    try {
      guard(); await external(); guard(); await writers(); guard(); await external(); guard();
    } catch (error) { throw retain(error); }
  };
  const guarded = { assertAuthority: guard, assertExternalSelection };
  const stores = keys.map(key => new WorkspaceRemnantBindingStore(root, key));
  const observe = async (): Promise<readonly Observation[]> => {
    await assertExternalSelection();
    const observations: Observation[] = [];
    for (const [index, key] of keys.entries()) {
      guard();
      const directory = await inspectWorkspaceRemnantBindingOwnerDirectory(root, key.owner, guard);
      const binding = await stores[index]!.inspect(guarded);
      const after = await inspectWorkspaceRemnantBindingOwnerDirectory(root, key.owner, guard);
      guard();
      assertSameDirectory(directory, after);
      observations.push(Object.freeze({ directory, binding }));
    }
    await assertExternalSelection();
    return Object.freeze(observations);
  };
  try {
    const baseline = await observe();
    const binding = selectBinding(target, record, baseline);
    const assertSelected = async () => {
      try {
        const fresh = await observe();
        for (const [index, before] of baseline.entries()) {
          const after = fresh[index]!;
          assertSameDirectory(before.directory, after.directory);
          assertSameWorkspaceRemnantBindingSelection(before.binding, after.binding);
        }
        guard();
      } catch (error) { throw retain(error); }
    };
    await assertSelected();
    return Object.freeze({ binding, assertSelected });
  } catch (error) { throw retain(error); }
}

export function workspaceDeletionPayloadBindingKeys(target: WorkspaceDeletionInventoryHeader, record: WorkspaceDeletionInventoryRecord): readonly WorkspaceRemnantBindingKey[] {
  switch (record.role) {
    case 'workspace': return [];
    case 'legacyEntry': return [captureWorkspaceRemnantBindingKey({ owner: 'workspaceLegacyAdoption', workspaceId: target.workspaceId })];
    case 'importCandidate':
    case 'adoptionCandidate': return [
      captureWorkspaceRemnantBindingKey({ owner: 'workspaceImport', operationId: record.ownerOperationId }),
      captureWorkspaceRemnantBindingKey({ owner: 'workspaceLegacyAdoption', workspaceId: target.workspaceId }),
    ];
    case 'inspection':
    case 'inspectionEvidence': return [captureWorkspaceRemnantBindingKey({ owner: 'profileInspection',
      operationId: record.ownerOperationId, generationId: record.generationId })];
    case 'replacementImport':
    case 'activationStaging':
    case 'activationRollback':
    case 'activationFailed': return [
      captureWorkspaceRemnantBindingKey({ owner: 'workspaceReplacement', operationId: record.ownerOperationId }),
      captureWorkspaceRemnantBindingKey({ owner: 'workspaceActivationMigration', operationId: record.ownerOperationId }),
    ];
  }
}

function selectBinding(target: WorkspaceDeletionInventoryHeader, record: WorkspaceDeletionInventoryRecord, observations: readonly Observation[]) {
  if (record.role === 'workspace') return undefined;
  const published = observations.flatMap(({ binding }) => binding.mode === 'published' ? [binding] : []);
  const candidate = record.role === 'importCandidate' || record.role === 'adoptionCandidate';
  if (candidate && published.some(({ value }) => value.owner === 'workspaceImport' && value.workspaceId !== target.workspaceId)) {
    return invalidDeletionData(invalidCode);
  }
  // A workspace-keyed legacy binding from another operation cannot own this candidate.
  const matching = candidate ? published.filter(({ value }) =>
    value.operationId === record.ownerOperationId && value.workspaceId === target.workspaceId) : published;
  if (matching.length !== 1) return invalidDeletionData(invalidCode);
  const selected = matching[0]!, binding = selected.value;
  if (binding.workspaceId !== target.workspaceId || binding.lineageIdentity.profileId !== target.lineageIdentity.profileId ||
      selected.bindingSha256 !== record.bindingSha256 ||
      (record.role === 'importCandidate' && binding.owner !== 'workspaceImport') ||
      (record.role === 'adoptionCandidate' && binding.owner !== 'workspaceLegacyAdoption') ||
      (record.role === 'replacementImport' && binding.owner !== 'workspaceReplacement')) return invalidDeletionData(invalidCode);
  if (binding.owner === 'profileInspection' &&
      (binding.rootIdentity !== record.rootIdentity || binding.parentIdentity !== record.parentIdentity)) return invalidDeletionData(invalidCode);
  return binding;
}

function assertSameDirectory(before: DirectorySelection, after: DirectorySelection): void {
  if (before.present !== after.present || before.ancestorPath !== after.ancestorPath || before.ancestorIdentity !== after.ancestorIdentity ||
      before.identities.length !== after.identities.length || before.identities.some((value, index) => value !== after.identities[index])) {
    invalidDeletionData(invalidCode);
  }
}

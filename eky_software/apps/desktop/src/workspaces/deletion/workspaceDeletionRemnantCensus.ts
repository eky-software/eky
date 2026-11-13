import { observeWorkspaceCandidateOperations } from './workspaceCandidateRemnantEnumeration.js';
import { captureWorkspaceCandidateRemnantObservation } from './workspaceCandidateRemnantSelection.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { workspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import { observeWorkspaceInternalInspectionRemnants } from './workspaceInspectionRemnantEnumeration.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { captureWorkspaceInspectionRemnantState } from './workspaceInspectionRemnantSelection.js';
import { captureWorkspaceLegacyRemnantSelection, workspaceLegacyRemnantReads } from './workspaceLegacyRemnantSelection.js';
import { workspaceRemnantBindingInvalidCode as invalidCode, workspaceRemnantBindingOwners } from './workspaceRemnantBindingCodec.js';
import { observeWorkspaceRemnantBindingDirectory } from './workspaceRemnantBindingEnumeration.js';
import { createWorkspaceRemnantBindingOwnerDirectoryPaths } from './workspaceRemnantBindingPaths.js';
import { assertSameWorkspaceRemnantBindingSelection } from './workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantParents } from './workspaceRemnantParentSelection.js';
import { findUniqueWorkspaceInspectionBinding, observeWorkspaceReplacementRemnants } from './workspaceReplacementRemnantEnumeration.js';
import { captureWorkspaceReplacementRemnantSelection } from './workspaceReplacementRemnantSelection.js';

export const workspaceDeletionRemnantReads = Object.freeze({ ...workspaceLegacyRemnantReads, ...workspaceInspectionRemnantReads });

// Readonly paired sources, including foreign and payloadless owners. No metadata cleanup or deletion grant.
// The publisher must compare a fresh complete pass AND the actual inventory through EOF before authorization.
export async function* observeWorkspaceDeletionRemnants(
  userDataRoot: string, authority: WorkspaceInspectionRemnantAuthority & { assertRecoverySourceReadCurrent?(): void },
  reads = workspaceDeletionRemnantReads,
  targetWorkspaceId?: string,
) {
  const check = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const selection = authority.assertExternalSelection.bind(authority);
  const writers = authority.assertWritersAbsent.bind(authority);
  const readCurrent = authority.assertRecoverySourceReadCurrent === undefined ? undefined :
    checkedDeletionAuthority(authority.assertRecoverySourceReadCurrent.bind(authority), invalidCode);
  let active = true;
  const guard = () => { if (!active) return invalidDeletionData(invalidCode); check(); };
  const boundary = async () => {
    guard(); await selection(); guard();
    await writers(); guard();
    await selection(); guard();
  };
  const readonlyAuthority = {
    assertAuthority: guard,
    async assertExternalSelection() { guard(); },
    async assertWritersAbsent() {
      guard();
      if (readCurrent === undefined) await writers();
      else readCurrent();
      guard();
    },
  };
  try {
    await boundary();
    const source = readWorkspaceDeletionRemnants(userDataRoot, readonlyAuthority, reads, targetWorkspaceId);
    let failed = false, completed = false, failure: unknown;
    try {
      while (true) {
        guard();
        const next = await source.next();
        guard();
        if (next.done) { completed = true; break; }
        yield next.value;
        guard();
      }
    } catch (error) { failed = true; failure = error; throw error; }
    finally {
      if (!completed) active = false;
      try { await source.return(undefined); }
      catch (error) {
        if (failed) throw new AggregateError([failure, error], invalidCode);
        throw error;
      }
    }
    // Accept EOF only after the source and its handles settle, under the original selection.
    await boundary();
  } finally { active = false; }
}

async function* readWorkspaceDeletionRemnants(
  userDataRoot: string, authority: WorkspaceInspectionRemnantAuthority, reads = workspaceDeletionRemnantReads,
  targetWorkspaceId?: string,
) {
  const check = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = async () => {
    check(); await authority.assertExternalSelection(); check();
    await authority.assertWritersAbsent(); check();
    await authority.assertExternalSelection(); check();
  };
  const directoryAuthority = { assertAuthority: check, assertExternalSelection: external };
  const lookupAuthority = { ...directoryAuthority, assertWritersAbsent: authority.assertWritersAbsent.bind(authority) };
  // Five fixed contexts, never a growing collection of operation roots or bindings.
  const directories = [];
  for (const owner of workspaceRemnantBindingOwners) {
    const paths = createWorkspaceRemnantBindingOwnerDirectoryPaths(userDataRoot, owner);
    directories.push({ owner, selected: await captureWorkspaceRemnantParents(paths.ancestors, authority, reads) });
  }
  const legacy = await captureWorkspaceLegacyRemnantSelection(userDataRoot, authority, reads);
  for (const { owner, selected } of directories) {
    for await (const row of observeWorkspaceRemnantBindingDirectory(userDataRoot, owner, directoryAuthority, reads)) {
      if (row.kind === 'directory') {
        if (row.selection.identities.length !== selected.identities.length ||
            row.selection.identities.some((value, index) => value !== selected.identities[index])) return invalidDeletionData(invalidCode);
        yield Object.freeze({ kind: 'metadataDirectory' as const, observation: row });
        continue;
      }
      const binding = row.binding.value;
      if (binding.owner === 'workspaceReplacement' || binding.owner === 'workspaceActivationMigration') {
        const source = await captureWorkspaceReplacementRemnantSelection(userDataRoot, binding.operationId, authority, reads);
        if (source.bindingSha256 !== row.binding.bindingSha256) return invalidDeletionData(invalidCode);
        yield Object.freeze({ kind: 'metadataReplacement' as const, observation: row, selection: source,
          hasPayload: source.roots.some(root => root.rootIdentity !== null) });
        await source.assertSelected();
      } else if (binding.owner === 'workspaceImport' || binding.owner === 'workspaceLegacyAdoption') {
        const source = await captureWorkspaceCandidateRemnantObservation(userDataRoot, binding.operationId, binding.workspaceId, authority, reads);
        if (source.bindingSha256 !== row.binding.bindingSha256) return invalidDeletionData(invalidCode);
        yield Object.freeze({ kind: 'metadataCandidate' as const, observation: row, selection: source,
          hasPayload: source.rootIdentity !== null || legacy.bindingSha256 === row.binding.bindingSha256 });
        await source.assertSelected();
      } else if (binding.owner === 'profileInspection') {
        const unique = await findUniqueWorkspaceInspectionBinding(userDataRoot, binding.generationId, lookupAuthority, reads);
        assertSameWorkspaceRemnantBindingSelection(row.binding, unique);
        const source = await captureWorkspaceInspectionRemnantState(userDataRoot, binding, authority, { reads });
        yield Object.freeze({ kind: 'metadataInspection' as const, observation: row, selection: source,
          hasPayload: source.selected !== undefined });
        assertSameWorkspaceRemnantBindingSelection(row.binding,
          await findUniqueWorkspaceInspectionBinding(userDataRoot, binding.generationId, lookupAuthority, reads));
        await source.assertSelected();
      } else return invalidDeletionData(invalidCode);
      check();
    }
    await selected.assertSelected();
  }
  for await (const observation of observeWorkspaceReplacementRemnants(userDataRoot, authority, reads)) {
    yield Object.freeze({ kind: 'replacementSource' as const, observation });
  }
  for await (const observation of observeWorkspaceCandidateOperations(userDataRoot, authority, reads)) {
    yield Object.freeze({ kind: 'candidateSource' as const, observation });
  }
  if (targetWorkspaceId !== undefined) {
    for await (const observation of observeWorkspaceInternalInspectionRemnants(userDataRoot, targetWorkspaceId, authority, reads)) {
      yield Object.freeze({ kind: 'workspaceInspectionSource' as const, observation });
    }
  }
  await legacy.assertSelected();
  yield Object.freeze({ kind: 'legacySource' as const, selection: legacy });
  await legacy.assertSelected();
  for (const { selected } of directories) await selected.assertSelected();
  await external();
}

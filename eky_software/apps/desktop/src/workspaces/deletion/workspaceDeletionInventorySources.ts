import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { checkedDeletionAuthority, deletionDigest, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { workspaceDeletionDirectoryEntryPageSize } from './workspaceDeletionDirectoryEntries.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryRecord, deletionInventoryRecordKey,
  type WorkspaceDeletionInventoryHeader, type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { observeWorkspaceDeletionRemnants, workspaceDeletionRemnantReads } from './workspaceDeletionRemnantCensus.js';
import { captureWorkspaceDeletionRemnantCensus } from './workspaceDeletionRemnantCensusSelection.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { projectWorkspaceInspectionRemnantInventoryRecord } from './workspaceInspectionRemnantSelection.js';
import { workspaceRemnantBindingInvalidCode as invalidCode, type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { captureWorkspaceRemnantParents } from './workspaceRemnantParentSelection.js';

type Observation = ReturnType<typeof observeWorkspaceDeletionRemnants> extends AsyncGenerator<infer Row> ? Row : never;

// Captured after owner-specific payloadless cleanup. Records remain observations until publication's EOF checks.
export async function captureWorkspaceDeletionInventorySources(
  userDataRoot: string, targetValue: unknown, expectedWorkspaceRootIdentity: string,
  authority: WorkspaceInspectionRemnantAuthority, reads = workspaceDeletionRemnantReads,
) {
  const target = captureDeletionInventoryHeader(targetValue);
  const expectedRoot = deletionDigest(expectedWorkspaceRootIdentity, invalidCode);
  const paths = deriveWorkspaceRoot(userDataRoot, target.workspaceId, 1);
  const check = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  let failed = false;
  const guard = () => { if (failed) return invalidDeletionData(invalidCode); check(); };
  const selectedAuthority = { assertAuthority: guard, assertExternalSelection: authority.assertExternalSelection.bind(authority),
    assertWritersAbsent: authority.assertWritersAbsent.bind(authority) };
  const parents = await captureWorkspaceRemnantParents(
    [userDataRoot, paths.workspacesRoot, paths.workspaceRoot], selectedAuthority, reads);
  if (parents.identities[2] !== expectedRoot || parents.identities[1] === null) return invalidDeletionData(invalidCode);
  const workspace = captureDeletionInventoryRecord({ role: 'workspace', ownerOperationId: null, generationId: null,
    member: null, bindingSha256: null, rootIdentity: expectedRoot, parentIdentity: parents.identities[1] });
  let firstPage: ReturnType<typeof createPage> | undefined = createPage(workspace);
  const census = await captureWorkspaceDeletionRemnantCensus(userDataRoot, selectedAuthority, reads, observation => {
    for (const record of project(userDataRoot, target, workspace, observation)) firstPage!.consider(record);
  }, target.workspaceId);
  await parents.assertSelected();
  const assertUnchanged = async () => {
    try {
      guard(); await parents.assertSelected();
      await census.assertUnchanged();
      await parents.assertSelected(); guard();
    } catch (error) { failed = true; throw error; }
  };
  async function* records(): AsyncGenerator<WorkspaceDeletionInventoryRecord, void> {
    let complete = false;
    try {
      guard();
      let cursor: string | undefined;
      while (true) {
        await parents.assertSelected();
        // Transfer the captured bounded page once; every later pass rereads the actual sources.
        const captured = firstPage?.page;
        firstPage = undefined;
        const page = captured ?? await readPage(userDataRoot, target, workspace, selectedAuthority, reads, cursor);
        await parents.assertSelected();
        if (page.length === 0) break;
        for (const record of page) {
          guard(); yield record; guard();
          cursor = deletionInventoryRecordKey(record);
        }
        // A partial page consumed the entire source. The fresh census below still detects late additions.
        if (page.length < workspaceDeletionDirectoryEntryPageSize) break;
      }
      await assertUnchanged();
      complete = true;
    } finally {
      // An incomplete observation cannot be retried under the same captured receipt.
      if (!complete) failed = true;
    }
  }
  return Object.freeze({ target, workspace, records, assertUnchanged });
}

function createPage(workspace: WorkspaceDeletionInventoryRecord, cursor?: string) {
  const page: WorkspaceDeletionInventoryRecord[] = [];
  const consider = (value: WorkspaceDeletionInventoryRecord) => {
    const row = captureDeletionInventoryRecord(value), key = deletionInventoryRecordKey(row);
    if (cursor !== undefined && key <= cursor) return;
    let index = 0;
    while (index < page.length && deletionInventoryRecordKey(page[index]!) < key) index++;
    if (page[index] !== undefined && deletionInventoryRecordKey(page[index]!) === key) return invalidDeletionData(invalidCode);
    if (index >= workspaceDeletionDirectoryEntryPageSize) return;
    if (page.length === workspaceDeletionDirectoryEntryPageSize) page.pop();
    page.splice(index, 0, row);
  };
  consider(workspace);
  return { page, consider };
}

async function readPage(
  root: string, target: WorkspaceDeletionInventoryHeader, workspace: WorkspaceDeletionInventoryRecord,
  authority: WorkspaceInspectionRemnantAuthority, reads: typeof workspaceDeletionRemnantReads, cursor?: string,
) {
  const { page, consider } = createPage(workspace, cursor);
  const source = observeWorkspaceDeletionRemnants(root, authority, reads, target.workspaceId);
  let failed = false;
  let failure: unknown;
  try {
    while (true) {
      authority.assertAuthority();
      const next = await source.next();
      authority.assertAuthority();
      if (next.done) break;
      for (const record of project(root, target, workspace, next.value)) consider(record);
    }
  } catch (error) { failed = true; failure = error; }
  try { await source.return(undefined); }
  catch (error) {
    if (failed) throw new AggregateError([failure, error], invalidCode);
    throw error;
  }
  if (failed) throw failure;
  authority.assertAuthority();
  return page;
}

function* project(root: string, target: WorkspaceDeletionInventoryHeader,
  workspace: WorkspaceDeletionInventoryRecord, row: Observation): Generator<WorkspaceDeletionInventoryRecord> {
  const belongs = (binding: WorkspaceRemnantBindingV1) => {
    if (binding.workspaceId !== target.workspaceId) return false;
    if (binding.lineageIdentity.profileId !== target.lineageIdentity.profileId) return invalidDeletionData(invalidCode);
    return true;
  };
  if (row.kind === 'metadataReplacement' || row.kind === 'metadataCandidate' || row.kind === 'metadataInspection') {
    const selected = row.selection;
    if (!belongs(selected.binding)) return;
    if (!row.hasPayload) return invalidDeletionData(invalidCode);
    if (row.kind === 'metadataReplacement') {
      for (const entry of row.selection.roots) if (entry.rootIdentity !== null) {
        yield captureDeletionInventoryRecord({ role: entry.role, ownerOperationId: selected.binding.operationId,
          generationId: null, member: null, rootIdentity: entry.rootIdentity,
          parentIdentity: entry.parentIdentity, bindingSha256: selected.bindingSha256 });
      }
    } else if (row.kind === 'metadataCandidate') {
      if (row.selection.rootIdentity !== null) yield captureDeletionInventoryRecord({ role: row.selection.role,
        ownerOperationId: selected.binding.operationId, generationId: null, member: null,
        rootIdentity: row.selection.rootIdentity, parentIdentity: row.selection.parentIdentity, bindingSha256: selected.bindingSha256 });
    } else {
      if (row.selection.selected === undefined) return invalidDeletionData(invalidCode);
      yield projectWorkspaceInspectionRemnantInventoryRecord(root, target,
        { binding: row.selection.binding, bindingSha256: row.selection.bindingSha256, ...row.selection.selected }, workspace);
    }
  } else if (row.kind === 'legacySource') {
    const selected = row.selection;
    if (selected.binding === undefined || !belongs(selected.binding)) return;
    for (const entry of selected.entries) if (entry.value !== null) {
      yield captureDeletionInventoryRecord({ role: 'legacyEntry', ownerOperationId: null, generationId: null,
        member: entry.member, rootIdentity: entry.value.identity, parentIdentity: selected.parentIdentity,
        bindingSha256: selected.bindingSha256 });
    }
  }
  // Actual-parent rows are still consumed through EOF: unknown or unowned payload must reject the whole source.
}

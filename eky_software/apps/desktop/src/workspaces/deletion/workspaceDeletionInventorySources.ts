import { resolve } from 'node:path';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { checkedDeletionAuthority, deletionDigest, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { workspaceDeletionDirectoryEntryPageSize } from './workspaceDeletionDirectoryEntries.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryRecord, deletionInventoryRecordKey,
  type WorkspaceDeletionInventoryHeader, type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { observeWorkspaceDeletionRemnants, workspaceDeletionRemnantReads } from './workspaceDeletionRemnantCensus.js';
import { captureWorkspaceDeletionRemnantCensus, prepareWorkspaceDeletionRemnantBindings, type WorkspaceDeletionSourceReadAuthority } from './workspaceDeletionRemnantCensusSelection.js';
import type { WorkspaceDeletionOriginalJournalProof } from './workspaceDeletionJournalCodec.js';
import type { WorkspaceDeletionOriginalJournalSelection } from './workspaceDeletionOriginalJournalSelection.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { projectWorkspaceInspectionRemnantInventoryRecord } from './workspaceInspectionRemnantSelection.js';
import { workspaceRemnantBindingInvalidCode as invalidCode, type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { captureWorkspaceRemnantParents } from './workspaceRemnantParentSelection.js';

type Observation = ReturnType<typeof observeWorkspaceDeletionRemnants> extends AsyncGenerator<infer Row> ? Row : never;

// Captured after owner-specific payloadless cleanup. Records remain observations until publication's EOF checks.
export async function captureWorkspaceDeletionInventorySources(
  userDataRoot: string, targetValue: unknown, expectedWorkspaceRootIdentity: string,
  authority: WorkspaceInspectionRemnantAuthority, reads = workspaceDeletionRemnantReads,
  originals?: WorkspaceDeletionOriginalJournalSelection,
  prepared?: Awaited<ReturnType<typeof prepareWorkspaceDeletionRemnantBindings>>,
) {
  const target = captureDeletionInventoryHeader(targetValue);
  if (originals !== undefined && (originals.userDataRoot !== resolve(userDataRoot) ||
      JSON.stringify(originals.target) !== JSON.stringify(target))) return invalidDeletionData(invalidCode);
  const originalProofs = originals?.proofs ?? [];
  const expectedRoot = deletionDigest(expectedWorkspaceRootIdentity, invalidCode);
  const paths = deriveWorkspaceRoot(userDataRoot, target.workspaceId, 1);
  const check = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  let failed = false;
  const guard = () => { if (failed) return invalidDeletionData(invalidCode); check(); };
  const selectedAuthority = { assertAuthority: guard, assertExternalSelection: authority.assertExternalSelection.bind(authority),
    assertWritersAbsent: authority.assertWritersAbsent.bind(authority) };
  const assertOriginalSelected = async () => {
    guard(); await originals?.assertSelected(); guard();
  };
  if (originals !== undefined) await assertOriginalSelected();
  const parents = await captureWorkspaceRemnantParents(
    [userDataRoot, paths.workspacesRoot, paths.workspaceRoot], selectedAuthority, reads);
  if (parents.identities[2] !== expectedRoot || parents.identities[1] === null) return invalidDeletionData(invalidCode);
  const workspace = captureDeletionInventoryRecord({ role: 'workspace', ownerOperationId: null, generationId: null,
    member: null, bindingSha256: null, rootIdentity: expectedRoot, parentIdentity: parents.identities[1] });
  let firstPage: ReturnType<typeof createPage> | undefined = createPage(workspace);
  const observe = (observation: Observation) => {
    for (const record of project(userDataRoot, target, workspace, observation, originalProofs)) firstPage!.consider(record);
  };
  const census = prepared === undefined
    ? await captureWorkspaceDeletionRemnantCensus(userDataRoot, selectedAuthority, reads, observe, target.workspaceId)
    : await prepared.captureInventoryCensus({ userDataRoot: resolve(userDataRoot), target, baseAuthority: authority, reads, originals },
      selectedAuthority, observe);
  await parents.assertSelected();
  if (originals !== undefined) await assertOriginalSelected();
  const expectedPage = firstPage!.page.length < workspaceDeletionDirectoryEntryPageSize
    ? Object.freeze([...firstPage!.page]) : undefined;
  const assertUnchanged = async () => {
    try {
      if (originals !== undefined) await assertOriginalSelected();
      guard(); await parents.assertSelected();
      await census.assertUnchanged();
      await parents.assertSelected(); guard();
      if (originals !== undefined) await assertOriginalSelected();
    } catch (error) { failed = true; throw error; }
  };
  async function* legacyRecords(): AsyncGenerator<WorkspaceDeletionInventoryRecord, void> {
    let complete = false;
    try {
      guard();
      let cursor: string | undefined;
      while (true) {
        await parents.assertSelected();
        // Complete small pages are expected data only; each consumption still requires fresh EOF proof.
        const captured = cursor === undefined ? expectedPage ?? firstPage?.page : firstPage?.page;
        firstPage = undefined;
        const page = captured ?? await readPage(userDataRoot, target, workspace, selectedAuthority, reads, cursor, originalProofs);
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
  let consumers = 0, scopedConsumer = false, retained = false;
  let firstFailure: unknown;
  const retain = (error: unknown) => {
    if (!retained) { retained = true; firstFailure = error; }
    failed = true;
    return firstFailure;
  };
  const assertUnchangedInternal = async (readAuthority?: WorkspaceDeletionSourceReadAuthority,
    censusReadAuthority = readAuthority) => {
    if (readAuthority === undefined) return assertUnchanged();
    const checkParents = async () => {
      await captureWorkspaceRemnantParents([userDataRoot, paths.workspacesRoot, paths.workspaceRoot],
        readAuthority, reads, parents.identities);
    };
    try {
      readAuthority.assertAuthority();
      if (originals !== undefined) await assertOriginalSelected();
      await checkParents();
      await census.assertUnchanged(censusReadAuthority);
      await checkParents();
      if (originals !== undefined) await assertOriginalSelected();
      readAuthority.assertAuthority();
    } catch (error) { retain(error); throw error; }
  };
  async function* records(port?: WorkspaceDeletionSourceReadAuthority): AsyncGenerator<WorkspaceDeletionInventoryRecord, void> {
    if (retained) throw firstFailure;
    if (consumers !== 0 && (port !== undefined || scopedConsumer)) return invalidDeletionData(invalidCode);
    consumers++;
    const scoped = port !== undefined;
    if (scoped) scopedConsumer = true;
    let reading = true, complete = false;
    const fail = (error: unknown) => {
      const reason = retain(error);
      reading = false;
      try { port?.onFailure(reason); } catch { /* Keep the original read failure. */ }
      return reason;
    };
    let local!: WorkspaceDeletionSourceReadAuthority;
    try {
      if (port === undefined) {
        yield* legacyRecords();
        complete = true;
        return;
      }
      if (typeof port.onFailure !== 'function' ||
          (port.assertRecoverySourceReadCurrent !== undefined &&
            typeof port.assertRecoverySourceReadCurrent !== 'function')) return invalidDeletionData(invalidCode);
      const checkRead = checkedDeletionAuthority(port.assertAuthority.bind(port), invalidCode);
      const checkRecoveryReadCurrent = port.assertRecoverySourceReadCurrent === undefined ? undefined :
        checkedDeletionAuthority(port.assertRecoverySourceReadCurrent.bind(port), invalidCode);
      const localGuard = () => {
        if (retained) throw firstFailure;
        if (!reading) return invalidDeletionData(invalidCode);
        try { guard(); checkRead(); } catch (error) { throw fail(error); }
      };
      const awaited = async (work: () => Promise<void>) => {
        try {
          localGuard(); const result: unknown = await work(); localGuard();
          if (result !== undefined) return invalidDeletionData(invalidCode);
        } catch (error) { fail(error); throw error; }
      };
      local = { assertAuthority: localGuard, onFailure: fail,
        assertExternalSelection: () => awaited(port.assertExternalSelection.bind(port)),
        assertWritersAbsent: () => awaited(selectedAuthority.assertWritersAbsent) };
      const censusReadAuthority = checkRecoveryReadCurrent === undefined ? local : {
        ...local, assertRecoverySourceReadCurrent: () => {
          try {
            localGuard(); checkRecoveryReadCurrent(); localGuard();
          } catch (error) { throw fail(error); }
        } };
      localGuard();
      await selectedAuthority.assertExternalSelection(); localGuard();
      let cursor: string | undefined;
      while (true) {
        await captureWorkspaceRemnantParents([userDataRoot, paths.workspacesRoot, paths.workspaceRoot],
          local, reads, parents.identities);
        const captured = cursor === undefined ? expectedPage ?? firstPage?.page : firstPage?.page;
        firstPage = undefined;
        const page = captured ?? await readPage(userDataRoot, target, workspace, local, reads, cursor, originalProofs);
        await captureWorkspaceRemnantParents([userDataRoot, paths.workspacesRoot, paths.workspaceRoot],
          local, reads, parents.identities);
        if (page.length === 0) break;
        for (const record of page) {
          localGuard(); yield record; localGuard(); cursor = deletionInventoryRecordKey(record);
        }
        if (page.length < workspaceDeletionDirectoryEntryPageSize) break;
      }
      await assertUnchangedInternal(local, censusReadAuthority);
      await selectedAuthority.assertExternalSelection(); localGuard();
      complete = true;
    } catch (error) { if (scoped) fail(error); throw error; }
    finally {
      if (!complete && scoped && !retained) {
        try { invalidDeletionData(invalidCode); } catch (error) { fail(error); }
      }
      reading = false;
      consumers--;
      if (scoped) scopedConsumer = false;
    }
  }
  const assertPublicUnchanged = async () => {
    if (scopedConsumer) return invalidDeletionData(invalidCode);
    if (retained) throw firstFailure;
    consumers++;
    try { await assertUnchanged(); }
    finally { consumers--; }
  };
  return Object.freeze({ target, workspace, records, assertUnchanged: assertPublicUnchanged });
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
  originalProofs: readonly WorkspaceDeletionOriginalJournalProof[] = [],
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
      for (const record of project(root, target, workspace, next.value, originalProofs)) consider(record);
    }
  } catch (error) {
    failed = true; failure = error;
    if ('onFailure' in authority && typeof authority.onFailure === 'function') {
      try { authority.onFailure(error); } catch { /* Preserve read cause before iterator close. */ }
    }
  }
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
  workspace: WorkspaceDeletionInventoryRecord, row: Observation,
  originalProofs: readonly WorkspaceDeletionOriginalJournalProof[]): Generator<WorkspaceDeletionInventoryRecord> {
  const belongs = (binding: WorkspaceRemnantBindingV1) => {
    if (binding.workspaceId !== target.workspaceId) return false;
    if (binding.lineageIdentity.profileId !== target.lineageIdentity.profileId) return invalidDeletionData(invalidCode);
    return true;
  };
  if (row.kind === 'metadataReplacement' || row.kind === 'metadataCandidate' || row.kind === 'metadataInspection') {
    const selected = row.selection;
    if (!belongs(selected.binding)) return;
    if (!row.hasPayload) {
      if (originalProofs.some(proof => proof.owner === selected.binding.owner &&
          proof.operationId === selected.binding.operationId && proof.bindingSha256 === selected.bindingSha256)) return;
      return invalidDeletionData(invalidCode);
    }
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

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { clearAbsentWorkspaceDeletionBinding } from './workspaceDeletionBindingCleanup.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { workspaceDeletionDirectoryEntryPageSize } from './workspaceDeletionDirectoryEntries.js';
import { captureDeletionInventoryHeader } from './workspaceDeletionInventoryCodec.js';
import type { WorkspaceDeletionOriginalJournalSelection } from './workspaceDeletionOriginalJournalSelection.js';
import { observeWorkspaceDeletionRemnants, workspaceDeletionRemnantReads } from './workspaceDeletionRemnantCensus.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';

type Observation = ReturnType<typeof observeWorkspaceDeletionRemnants> extends AsyncGenerator<infer Row> ? Row : never;
type Metadata = Extract<Observation, { observation: { kind: 'binding' } }>['observation'];
type Candidate = Extract<Observation, { kind: 'metadataCandidate' }>['selection'];
type RemnantCensusReceipt = Readonly<{ assertUnchanged(): Promise<void> }>;

// A private, bounded source comparison at the publication boundary, NEVER a per-I/O mutation guard.
// It supplements, and cannot replace, the publisher's target/registry and inventory-row EOF comparisons.
export async function captureWorkspaceDeletionRemnantCensus(
  userDataRoot: string, authority: WorkspaceInspectionRemnantAuthority, reads = workspaceDeletionRemnantReads,
  onInitialObservation?: (observation: Observation) => void,
  targetWorkspaceId?: string,
) {
  return (await captureRemnantCensus(userDataRoot, authority, reads, onInitialObservation, targetWorkspaceId)).receipt;
}

async function captureRemnantCensus(
  userDataRoot: string, authority: WorkspaceInspectionRemnantAuthority, reads: typeof workspaceDeletionRemnantReads,
  onInitialObservation?: (observation: Observation) => void, targetWorkspaceId?: string, expected?: string,
): Promise<{ receipt: RemnantCensusReceipt; captureCompared(authority: WorkspaceInspectionRemnantAuthority,
  observe: (row: Observation) => void): Promise<RemnantCensusReceipt> }> {
  const check = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  let failed = false;
  const guard = () => { if (failed) return invalidDeletionData(invalidCode); check(); };
  const selectedAuthority = { assertAuthority: guard, assertExternalSelection: authority.assertExternalSelection.bind(authority),
    assertWritersAbsent: authority.assertWritersAbsent.bind(authority) };
  const read = async (observe?: (observation: Observation) => void) => {
    const hash = sourceHash();
    const source = observeWorkspaceDeletionRemnants(userDataRoot, selectedAuthority, reads, targetWorkspaceId);
    let readFailed = false;
    let failure: unknown;
    try {
      while (true) {
        guard();
        const next = await source.next();
        guard();
        if (next.done) break;
        // Hash every source before the synchronous projection can inspect it.
        hash.update(JSON.stringify(sourceValue(next.value))).update('\n');
        observe?.(next.value);
        guard();
      }
    } catch (error) { readFailed = true; failure = error; }
    try { await source.return(undefined); }
    catch (error) {
      if (readFailed) throw new AggregateError([failure, error], invalidCode);
      throw error;
    }
    if (readFailed) throw failure;
    guard();
    return hash.digest('hex');
  };
  let baseline: string;
  try {
    baseline = await read(onInitialObservation);
    if (expected !== undefined && baseline !== expected) return invalidDeletionData(invalidCode);
  } catch (error) { failed = true; throw error; }
  const receipt = Object.freeze({ async assertUnchanged() {
    try {
      guard();
      if (await read() !== baseline) return invalidDeletionData(invalidCode);
      guard();
    } catch (error) { failed = true; throw error; }
  } });
  return { receipt, async captureCompared(selectedAuthority: WorkspaceInspectionRemnantAuthority,
    observe: (observation: Observation) => void) {
    guard();
    const next = await captureRemnantCensus(userDataRoot, selectedAuthority, reads, observe, targetWorkspaceId, baseline);
    guard();
    return next.receipt;
  } };
}

// A bounded acknowledged transition, not a new source selection after an unexplained change.
// The existing owner removes metadata only; every other source must match the expected remainder.
export async function prepareWorkspaceDeletionRemnantBindings(
  userDataRoot: string, targetValue: unknown, authority: WorkspaceInspectionRemnantAuthority,
  reads = workspaceDeletionRemnantReads,
  originals?: WorkspaceDeletionOriginalJournalSelection,
) {
  const target = captureDeletionInventoryHeader(targetValue);
  if (originals !== undefined && (originals.userDataRoot !== resolve(userDataRoot) ||
      JSON.stringify(originals.target) !== JSON.stringify(target))) return invalidDeletionData(invalidCode);
  const check = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const assertOriginal = originals?.assertSelected.bind(originals);
  let failed = false;
  let firstFailure: unknown;
  const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return firstFailure; };
  const guard = () => { if (failed) throw firstFailure; try { check(); } catch (error) { throw retain(error); } };
  const assertOriginalSelected = async () => {
    try { guard(); await assertOriginal?.(); guard(); } catch (error) { throw retain(error); }
  };
  const cleanupAuthority = originals === undefined ? authority : {
    ...authority, assertAuthority: guard,
    async assertExternalSelection() {
      try { guard(); await authority.assertExternalSelection(); guard(); }
      catch (error) { throw retain(error); }
    },
    async assertWritersAbsent() {
      try { guard(); await authority.assertWritersAbsent(); guard(); } catch (error) { throw retain(error); }
    },
  };
  let expected: string | undefined;
  try {
    while (true) {
      if (originals !== undefined) await assertOriginalSelected();
      const full = sourceHash(), remaining = sourceHash();
      const pending: Metadata['binding'][] = [];
      const captured = await captureRemnantCensus(userDataRoot, authority, reads, row => {
        const encoded = `${JSON.stringify(sourceValue(row))}\n`;
        full.update(encoded);
        if (row.kind === 'metadataReplacement' || row.kind === 'metadataCandidate' || row.kind === 'metadataInspection') {
          const binding = row.observation.binding;
          if (binding.value.workspaceId === target.workspaceId) {
            if (binding.value.lineageIdentity.profileId !== target.lineageIdentity.profileId) return invalidDeletionData(invalidCode);
            const retained = originals?.proofs.some(proof => proof.owner === binding.value.owner &&
              proof.operationId === binding.value.operationId && proof.bindingSha256 === binding.bindingSha256) ?? false;
            if (!row.hasPayload && !retained && pending.length < workspaceDeletionDirectoryEntryPageSize) {
              pending.push(binding);
              return;
            }
          }
        }
        remaining.update(encoded);
      }, target.workspaceId);
      const census = captured.receipt;
      if (expected !== undefined && full.digest('hex') !== expected) return invalidDeletionData(invalidCode);
      // Consume and close the readonly census before any owner changes its selected slots.
      if (originals !== undefined) await assertOriginalSelected();
      await census.assertUnchanged();
      if (originals !== undefined) await assertOriginalSelected();
      if (pending.length === 0) {
        let admitted = false;
        return Object.freeze({ async assertUnchanged() {
          try {
            guard();
            if (originals !== undefined) await assertOriginalSelected();
            await census.assertUnchanged();
            if (originals !== undefined) await assertOriginalSelected();
          } catch (error) { throw retain(error); }
        }, async captureInventoryCensus(context: {
          userDataRoot: string; target: ReturnType<typeof captureDeletionInventoryHeader>;
          baseAuthority: WorkspaceInspectionRemnantAuthority; reads: typeof workspaceDeletionRemnantReads;
          originals: WorkspaceDeletionOriginalJournalSelection | undefined;
        }, selectedAuthority: WorkspaceInspectionRemnantAuthority, observe: (row: Observation) => void) {
          try {
            guard();
            if (admitted) return invalidDeletionData(invalidCode);
            admitted = true;
            if (context.userDataRoot !== resolve(userDataRoot) ||
                JSON.stringify(captureDeletionInventoryHeader(context.target)) !== JSON.stringify(target) ||
                context.baseAuthority !== authority || context.reads !== reads || context.originals !== originals) {
              return invalidDeletionData(invalidCode);
            }
            if (originals !== undefined) await assertOriginalSelected();
            guard(); selectedAuthority.assertAuthority();
            const result = await captured.captureCompared(selectedAuthority, observe);
            guard(); selectedAuthority.assertAuthority();
            if (originals !== undefined) await assertOriginalSelected();
            guard(); selectedAuthority.assertAuthority();
            return result;
          } catch (error) { throw retain(error); }
        } });
      }
      for (const selected of pending) {
        authority.assertAuthority();
        if (originals !== undefined) await assertOriginalSelected();
        await clearAbsentWorkspaceDeletionBinding(userDataRoot, target, selected.value, cleanupAuthority,
          { reads, expectedOwnerSlots: selected.slots,
            ...(originals === undefined ? {} : { assertOriginalJournalsSelected: assertOriginalSelected }) });
        authority.assertAuthority();
        if (originals !== undefined) await assertOriginalSelected();
      }
      // A missing acknowledgement throws above. Absence on the next pass cannot substitute for it.
      expected = remaining.digest('hex');
    }
  } catch (error) { throw retain(error); }
}

function sourceHash() { return createHash('sha256').update('eky-workspace-deletion-remnant-source-v1\n'); }

function metadata(row: Metadata) {
  return [row.key, row.binding.value, row.binding.bindingSha256, ...(['current', 'next', 'backup'] as const).map(slot => {
    const value = row.binding.slots[slot];
    return value === undefined ? null : [slot, value.identity, Buffer.from(value.bytes).toString('hex')];
  })];
}

function candidate(value: Candidate) {
  return [value.binding, value.bindingSha256, value.role, value.rootPath, value.parentPath,
    value.rootIdentity, value.parentIdentity, value.ancestors];
}

function sourceValue(row: Observation): unknown {
  switch (row.kind) {
    case 'metadataDirectory': return [row.kind, row.observation.owner, row.observation.directoryPath, row.observation.selection];
    case 'metadataReplacement': return [row.kind, metadata(row.observation), row.selection.roots, row.hasPayload];
    case 'metadataCandidate': return [row.kind, metadata(row.observation), candidate(row.selection), row.hasPayload];
    case 'metadataInspection': return [row.kind, metadata(row.observation), row.selection.observed,
      row.selection.selected?.location ?? null, row.hasPayload];
    case 'replacementSource': {
      const value = row.observation;
      if (value.kind === 'parent') return [row.kind, value];
      const selected = value.selection;
      return value.kind === 'replacement'
        ? [row.kind, value.kind, value.selection.binding, value.selection.bindingSha256, value.selection.roots]
        : [row.kind, value.kind, selected.binding, selected.bindingSha256, value.selection.location, value.selection.root];
    }
    case 'candidateSource': return [row.kind, row.observation.kind === 'candidate'
      ? ['candidate', candidate(row.observation.selection)] : row.observation];
    case 'workspaceInspectionSource': {
      const value = row.observation;
      if (value.kind === 'parent') return [row.kind, value];
      return [row.kind, value.kind, value.selection.binding, value.selection.bindingSha256,
        value.selection.location, value.selection.root];
    }
    case 'legacySource': {
      const value = row.selection;
      return [row.kind, value.rootPath, value.ancestorIdentities, value.parentIdentity, value.entries,
        value.binding ?? null, value.bindingSha256 ?? null];
    }
  }
}

import { createHash } from 'node:crypto';
import { clearAbsentWorkspaceDeletionBinding } from './workspaceDeletionBindingCleanup.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { workspaceDeletionDirectoryEntryPageSize } from './workspaceDeletionDirectoryEntries.js';
import { captureDeletionInventoryHeader } from './workspaceDeletionInventoryCodec.js';
import { observeWorkspaceDeletionRemnants, workspaceDeletionRemnantReads } from './workspaceDeletionRemnantCensus.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';

type Observation = ReturnType<typeof observeWorkspaceDeletionRemnants> extends AsyncGenerator<infer Row> ? Row : never;
type Metadata = Extract<Observation, { observation: { kind: 'binding' } }>['observation'];
type Candidate = Extract<Observation, { kind: 'metadataCandidate' }>['selection'];

// A private, bounded source comparison at the publication boundary, NEVER a per-I/O mutation guard.
// It supplements, and cannot replace, the publisher's target/registry and inventory-row EOF comparisons.
export async function captureWorkspaceDeletionRemnantCensus(
  userDataRoot: string, authority: WorkspaceInspectionRemnantAuthority, reads = workspaceDeletionRemnantReads,
  onInitialObservation?: (observation: Observation) => void,
  targetWorkspaceId?: string,
) {
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
  try { baseline = await read(onInitialObservation); } catch (error) { failed = true; throw error; }
  return Object.freeze({ async assertUnchanged() {
    try {
      guard();
      if (await read() !== baseline) return invalidDeletionData(invalidCode);
      guard();
    } catch (error) { failed = true; throw error; }
  } });
}

// A bounded acknowledged transition, not a new source selection after an unexplained change.
// The existing owner removes metadata only; every other source must match the expected remainder.
export async function prepareWorkspaceDeletionRemnantBindings(
  userDataRoot: string, targetValue: unknown, authority: WorkspaceInspectionRemnantAuthority,
  reads = workspaceDeletionRemnantReads,
) {
  const target = captureDeletionInventoryHeader(targetValue);
  let expected: string | undefined;
  while (true) {
    const full = sourceHash(), remaining = sourceHash();
    const pending: Metadata['binding'][] = [];
    const census = await captureWorkspaceDeletionRemnantCensus(userDataRoot, authority, reads, row => {
      const encoded = `${JSON.stringify(sourceValue(row))}\n`;
      full.update(encoded);
      if (row.kind === 'metadataReplacement' || row.kind === 'metadataCandidate' || row.kind === 'metadataInspection') {
        const binding = row.observation.binding;
        if (binding.value.workspaceId === target.workspaceId) {
          if (binding.value.lineageIdentity.profileId !== target.lineageIdentity.profileId) return invalidDeletionData(invalidCode);
          if (!row.hasPayload && pending.length < workspaceDeletionDirectoryEntryPageSize) {
            pending.push(binding);
            return;
          }
        }
      }
      remaining.update(encoded);
    }, target.workspaceId);
    if (expected !== undefined && full.digest('hex') !== expected) return invalidDeletionData(invalidCode);
    // Consume and close the readonly census before any owner changes its selected slots.
    await census.assertUnchanged();
    if (pending.length === 0) return census;
    for (const selected of pending) {
      authority.assertAuthority();
      await clearAbsentWorkspaceDeletionBinding(userDataRoot, target, selected.value, authority,
        { reads, expectedOwnerSlots: selected.slots });
      authority.assertAuthority();
    }
    // A missing acknowledgement throws above. Absence on the next pass cannot substitute for it.
    expected = remaining.digest('hex');
  }
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

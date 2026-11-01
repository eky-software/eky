import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import type { WorkspaceDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import type { WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { deriveWorkspaceDeletionPayloadPaths } from './workspaceDeletionPayloadPaths.js';
import type { WorkspaceLegacyEntryIdentity } from './workspaceLegacyRemnantReads.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

export interface WorkspaceDeletionPayloadAuthority {
  assertAuthority(): void;
  // The executor proves published journal selection, inventory membership, registry and writer absence.
  // This must remain valid after a move; C's unchanged-source census is not this authority.
  assertSelected(journal: WorkspaceDeletionJournalV1, record: WorkspaceDeletionInventoryPayloadRecord): Promise<void>;
}

export interface WorkspaceDeletionPayloadReads {
  ancestor(path: string, legacyRuntime: boolean, assertCurrent: () => void): Promise<string | null>;
  entry(path: string, legacyEntry: boolean, assertCurrent: () => void): Promise<WorkspaceLegacyEntryIdentity | null>;
}

export type WorkspaceDeletionPayloadState = 'source' | 'quarantine' | 'absent';

// Read-only selection. The caller must separately enforce the published phase and every mutation grant.
export async function selectWorkspaceDeletionPayload(
  root: string, journal: WorkspaceDeletionJournalV1, record: WorkspaceDeletionInventoryPayloadRecord,
  reads: WorkspaceDeletionPayloadReads, guard: () => void, allowAbsent: boolean,
) {
  const candidates = deriveWorkspaceDeletionPayloadPaths(root, journal.target, record);
  const observe = async () => {
    const observations = [];
    for (const paths of candidates) {
      const ancestors: (string | null)[] = [];
      let missing = false;
      for (const path of paths.ancestors) {
        guard();
        const value = await reads.ancestor(path, paths.legacyEntry && path === paths.parentPath, guard);
        guard();
        if (value === null) { if (path === root) return invalidDeletionData(invalidCode); missing = true; }
        else if (missing) return invalidDeletionData(invalidCode);
        ancestors.push(value);
      }
      guard();
      const source = await reads.entry(paths.sourcePath, paths.legacyEntry, guard);
      guard();
      const quarantine = await reads.entry(paths.quarantinePath, paths.legacyEntry, guard);
      guard();
      for (let index = paths.ancestors.length - 1; index >= 0; index--) {
        const path = paths.ancestors[index]!;
        const value = await reads.ancestor(path, paths.legacyEntry && path === paths.parentPath, guard);
        guard();
        if (value !== ancestors[index]) return invalidDeletionData(invalidCode);
      }
      if (source !== null && quarantine !== null) return invalidDeletionData(invalidCode);
      const entry = source ?? quarantine;
      if (entry !== null && (missing || entry.identity !== record.rootIdentity || ancestors.at(-1) !== record.parentIdentity)) {
        return invalidDeletionData(invalidCode);
      }
      observations.push({ paths, ancestors, source, quarantine });
    }
    const matching = observations.filter(row => row.ancestors.at(-1) === record.parentIdentity);
    if (matching.length !== 1 || (!allowAbsent && matching[0]!.source === null && matching[0]!.quarantine === null)) {
      return invalidDeletionData(invalidCode);
    }
    return observations;
  };
  const baseline = await observe();
  const selectedIndex = baseline.findIndex(row => row.ancestors.at(-1) === record.parentIdentity);
  const selected = baseline[selectedIndex]!;
  const original = selected.source ?? selected.quarantine;
  const state: WorkspaceDeletionPayloadState = selected.source !== null ? 'source' : original !== null ? 'quarantine' : 'absent';
  return Object.freeze({ paths: selected.paths, original, state,
    async assertState(expected: WorkspaceDeletionPayloadState) {
      const fresh = await observe();
      for (let index = 0; index < baseline.length; index++) {
        const before = baseline[index]!, after = fresh[index]!;
        if (before.ancestors.some((value, position) => value !== after.ancestors[position])) return invalidDeletionData(invalidCode);
        if (index === selectedIndex && expected !== 'absent') {
          const entry = expected === 'quarantine' ? after.quarantine : after.source;
          const absent = expected === 'quarantine' ? after.source : after.quarantine;
          if (original === null || absent !== null || entry?.identity !== original.identity || entry.kind !== original.kind) {
            return invalidDeletionData(invalidCode);
          }
        } else if (after.source !== null || after.quarantine !== null) return invalidDeletionData(invalidCode);
      }
    },
  });
}

import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import type { WorkspaceInspectionRemnantAuthority, WorkspaceInspectionRemnantReads } from './workspaceInspectionRemnantObservation.js';
import { workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';

// A pinned ancestor chain shared by the actual remnant directory readers.
export async function captureWorkspaceRemnantParents(
  ancestors: readonly string[], authority: WorkspaceInspectionRemnantAuthority,
  reads: Pick<WorkspaceInspectionRemnantReads, 'directoryIdentity'>,
  selectedAncestors: readonly (string | null)[] = [],
) {
  const assertCurrent = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const identity = reads.directoryIdentity.bind(reads);
  const external = async () => {
    assertCurrent(); await authority.assertExternalSelection(); assertCurrent();
    await authority.assertWritersAbsent(); assertCurrent();
    await authority.assertExternalSelection(); assertCurrent();
  };
  const readSelection = async () => {
    await external();
    const identities: (string | null)[] = [];
    let missing = false;
    for (const path of ancestors) {
      assertCurrent();
      let value: string;
      try { value = await identity(path, assertCurrent); }
      catch (error) {
        assertCurrent();
        if (path === ancestors[0] || (error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
        identities.push(null); missing = true; continue;
      }
      assertCurrent();
      if (missing) return invalidDeletionData(invalidCode);
      identities.push(value);
    }
    await external();
    return identities;
  };
  const baseline = Object.freeze(await readSelection());
  if (selectedAncestors.length > baseline.length || selectedAncestors.some((value, index) => value !== baseline[index])) {
    return invalidDeletionData(invalidCode);
  }
  let invalid = false;
  const assertSelected = async () => {
    if (invalid) return invalidDeletionData(invalidCode);
    try {
      const fresh = await readSelection();
      if (baseline.some((value, index) => value !== fresh[index])) return invalidDeletionData(invalidCode);
    } catch (error) { invalid = true; throw error; }
  };
  return Object.freeze({ identities: baseline, assertCurrent, assertSelected });
}

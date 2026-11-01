import { join } from 'node:path';
import { parseProfileInspectionCopyDirectoryName } from '../../runtime/profileInspectionMessages.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { observeWorkspaceDeletionDirectoryEntries, type WorkspaceDeletionDirectoryReads } from './workspaceDeletionDirectoryEntries.js';
import type { WorkspaceInspectionRemnantAuthority, WorkspaceInspectionRemnantReads } from './workspaceInspectionRemnantObservation.js';
import { deriveWorkspaceInspectionRemnantParents } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceInspectionRemnantSource } from './workspaceInspectionRemnantSelection.js';
import { workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';
import { assertSameWorkspaceRemnantBindingSelection } from './workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantParents } from './workspaceRemnantParentSelection.js';
import { findUniqueWorkspaceInspectionBinding } from './workspaceReplacementRemnantEnumeration.js';

// Only the target's two internal inspection parents. The workspace payload still covers their bytes once.
export async function* observeWorkspaceInternalInspectionRemnants(
  root: string, workspaceId: string, authority: WorkspaceInspectionRemnantAuthority,
  reads: WorkspaceDeletionDirectoryReads & WorkspaceInspectionRemnantReads,
) {
  const parents = [];
  for (const path of deriveWorkspaceInspectionRemnantParents(root, workspaceId).filter(value => value.scope === 'workspace')) {
    parents.push({ path, selected: await captureWorkspaceRemnantParents(path.ancestors, authority, reads) });
  }
  for (const { path, selected } of parents) {
    await selected.assertSelected();
    yield Object.freeze({ kind: 'parent' as const, rootPath: path.parentPath, ancestorIdentities: selected.identities });
    await selected.assertSelected();
    if (selected.identities.at(-1) === null) continue;
    const guarded = { assertAuthority: selected.assertCurrent, assertExternalSelection: selected.assertSelected,
      assertWritersAbsent: authority.assertWritersAbsent.bind(authority) };
    for await (const name of observeWorkspaceDeletionDirectoryEntries(path.parentPath, guarded, reads)) {
      const generationId = parseProfileInspectionCopyDirectoryName(name);
      // Other workspace-owned content is not a standalone inspection root or a new deletion role.
      if (generationId === undefined) {
        if (process.platform === 'win32' && parseProfileInspectionCopyDirectoryName(name.toLowerCase()) !== undefined) {
          return invalidDeletionData(invalidCode);
        }
        continue;
      }
      const binding = await findUniqueWorkspaceInspectionBinding(root, generationId, guarded, reads);
      if (binding.value.workspaceId !== workspaceId) return invalidDeletionData(invalidCode);
      const source = await captureWorkspaceInspectionRemnantSource(root, binding.value, authority, { reads });
      if (source.location.scope !== 'workspace' || source.location.rootPath !== join(path.parentPath, name) ||
          source.root.ancestors.length !== selected.identities.length ||
          source.root.ancestors.some((value, index) => value !== selected.identities[index])) return invalidDeletionData(invalidCode);
      await source.assertSelected();
      await selected.assertSelected();
      yield Object.freeze({ kind: 'inspection' as const, selection: source });
      assertSameWorkspaceRemnantBindingSelection(binding,
        await findUniqueWorkspaceInspectionBinding(root, generationId, guarded, reads));
      await source.assertSelected();
      await selected.assertSelected();
    }
  }
  for (const { selected } of parents) await selected.assertSelected();
}

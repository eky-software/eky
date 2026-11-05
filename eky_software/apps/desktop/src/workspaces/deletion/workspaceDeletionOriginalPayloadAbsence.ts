import { deriveWorkspaceLegacyAdoptionPaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { workspaceInspectionRemnantReads as reads } from './workspaceInspectionRemnantAbsence.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { captureWorkspaceLegacyRemnantSelection } from './workspaceLegacyRemnantSelection.js';
import { captureWorkspaceRemnantBinding } from './workspaceRemnantBindingCodec.js';
import { captureWorkspaceRemnantParents } from './workspaceRemnantParentSelection.js';
import { deriveWorkspaceReplacementRemnantParents, deriveWorkspaceReplacementRemnantRoot } from './workspaceReplacementRemnantPaths.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

// Read-only absence of the fixed roots bound by an original-journal proof, even after binding retirement.
export async function captureWorkspaceDeletionOriginalPayloadAbsence(
  root: string, bindingValue: unknown,
  authority: WorkspaceInspectionRemnantAuthority & { assertReadSelection?(): Promise<void> },
) {
  const binding = captureWorkspaceRemnantBinding(bindingValue);
  if (binding.owner === 'profileInspection') return invalidDeletionData(invalidCode);
  const check = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  let failed = false;
  let firstFailure: unknown;
  const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return firstFailure; };
  const guard = () => { if (failed) throw firstFailure; try { check(); } catch (error) { throw retain(error); } };
  const guarded = { assertAuthority: guard, assertExternalSelection: authority.assertExternalSelection.bind(authority),
    assertWritersAbsent: authority.assertWritersAbsent.bind(authority) };
  const readSelectionValue = authority.assertReadSelection;
  if (readSelectionValue !== undefined && typeof readSelectionValue !== 'function') return invalidDeletionData(invalidCode);
  const readSelection = readSelectionValue?.bind(authority);
  const paths: { rootPath: string; ancestors: readonly string[] }[] = [];
  if (binding.owner === 'workspaceReplacement' || binding.owner === 'workspaceActivationMigration') {
    for (const parent of deriveWorkspaceReplacementRemnantParents(root, binding.workspaceId)) {
      paths.push({ rootPath: deriveWorkspaceReplacementRemnantRoot(root, binding.workspaceId, binding.operationId, parent.role).rootPath,
        ancestors: parent.ancestors });
    }
  } else {
    const imported = deriveWorkspaceBackupImportPaths(root, validateWorkspaceBackupImportOperationId(binding.operationId), binding.workspaceId);
    const adopted = deriveWorkspaceLegacyAdoptionPaths(root, binding.operationId, binding.workspaceId);
    if (imported.candidateRoot !== adopted.candidateRoot || imported.operationRoot !== adopted.operationRoot ||
        imported.operationsRoot !== adopted.operationsRoot) return invalidDeletionData(invalidCode);
    paths.push({ rootPath: imported.candidateRoot, ancestors: [imported.userDataRoot, imported.operationsRoot, imported.operationRoot] });
  }
  try {
    const selected: { rootPath: string; ancestors: readonly string[];
      parents: Awaited<ReturnType<typeof captureWorkspaceRemnantParents>> }[] = [];
    for (const path of paths) {
      const parents = await captureWorkspaceRemnantParents([...path.ancestors, path.rootPath], guarded, reads);
      if (parents.identities.at(-1) !== null) return invalidDeletionData(invalidCode);
      selected.push({ ...path, parents });
    }
    const legacy = binding.owner === 'workspaceLegacyAdoption' ? await captureWorkspaceLegacyRemnantSelection(root, guarded) : undefined;
    if (legacy?.entries.some(entry => entry.value !== null)) return invalidDeletionData(invalidCode);
    let reading = false;
    const assertScopedAbsent = async () => {
      if (reading) return invalidDeletionData(invalidCode);
      reading = true;
      let active = true;
      const readCurrent = () => { guard(); if (!active) return invalidDeletionData(invalidCode); };
      const scope = { assertAuthority: readCurrent, assertWritersAbsent: guarded.assertWritersAbsent,
        async assertExternalSelection() {
          readCurrent(); const result: unknown = await readSelection!(); readCurrent();
          if (result !== undefined) return invalidDeletionData(invalidCode);
        },
      };
      try {
        readCurrent(); await guarded.assertExternalSelection(); readCurrent();
        for (const path of selected) {
          const fresh = await captureWorkspaceRemnantParents([...path.ancestors, path.rootPath], scope, reads, path.parents.identities);
          readCurrent(); await reads.assertAbsent(path.rootPath, readCurrent); readCurrent();
          await fresh.assertSelected(); readCurrent();
        }
        await legacy?.assertSelected(); readCurrent();
        await guarded.assertExternalSelection(); readCurrent();
      } catch (error) { throw retain(error); }
      finally { active = false; reading = false; }
    };
    const assertAbsent = async () => {
      if (readSelection !== undefined) return assertScopedAbsent();
      try {
        guard();
        for (const path of selected) {
          await path.parents.assertSelected(); guard();
          await reads.assertAbsent(path.rootPath, guard); guard();
          await path.parents.assertSelected(); guard();
        }
        await legacy?.assertSelected(); guard();
      } catch (error) { throw retain(error); }
    };
    await assertAbsent();
    return Object.freeze({ assertAbsent });
  } catch (error) { throw retain(error); }
}

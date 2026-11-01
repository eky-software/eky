import { join } from 'node:path';
import { deriveWorkspaceBackupImportOperationPaths, deriveWorkspaceBackupImportOperationsPaths } from '../import/workspaceBackupImportPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { workspaceBackupPlaintextQuarantineDirectoryName } from '../import/workspaceBackupPlaintextQuarantine.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { captureWorkspaceCandidateRemnantSelection } from './workspaceCandidateRemnantSelection.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { observeWorkspaceDeletionDirectoryEntries, workspaceDeletionDirectoryReads,
  type WorkspaceDeletionDirectoryReads } from './workspaceDeletionDirectoryEntries.js';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';
import { workspaceInspectionRemnantReads, type WorkspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';
import { captureWorkspaceRemnantParents as captureParents } from './workspaceRemnantParentSelection.js';

const nativeReads = Object.freeze({ ...workspaceDeletionDirectoryReads, ...workspaceInspectionRemnantReads });
type CandidateReads = WorkspaceDeletionDirectoryReads & WorkspaceInspectionRemnantReads;

type CandidateSelection = Awaited<ReturnType<typeof captureWorkspaceCandidateRemnantSelection>>;
type CandidateOperationObservation =
  | Readonly<{ kind: 'operationsParent'; rootPath: string; ancestorIdentities: readonly (string | null)[] }>
  | Readonly<{ kind: 'operation'; operationId: string; rootPath: string; rootIdentity: string }>
  | Readonly<{ kind: 'installationQuarantine'; rootPath: string; rootIdentity: string }>
  | Readonly<{ kind: 'candidate'; selection: CandidateSelection }>;

// Includes empty/shared/foreign source context, not just eventual target payload records.
// Consumers must compare a fresh full census before publication; these observations grant no mutation.
export async function* observeWorkspaceCandidateOperations(
  userDataRoot: string, authority: WorkspaceInspectionRemnantAuthority,
  reads: CandidateReads = nativeReads,
): AsyncGenerator<CandidateOperationObservation, void> {
  createWorkspaceDeletionJournalPaths(userDataRoot);
  const paths = deriveWorkspaceBackupImportOperationsPaths(userDataRoot);
  const selected = await captureParents([paths.userDataRoot, paths.operationsRoot], authority, reads);
  const guarded = { assertAuthority: selected.assertCurrent, assertExternalSelection: selected.assertSelected };
  await selected.assertSelected();
  yield Object.freeze({ kind: 'operationsParent', rootPath: paths.operationsRoot, ancestorIdentities: selected.identities });
  await selected.assertSelected();
  if (selected.identities.at(-1) === null) return;
  for await (const name of observeWorkspaceDeletionDirectoryEntries(paths.operationsRoot, guarded, reads)) {
    const quarantine = name === workspaceBackupPlaintextQuarantineDirectoryName;
    const operationId = quarantine ? null : validateWorkspaceBackupImportOperationId(name);
    const rootPath = quarantine ? join(paths.operationsRoot, workspaceBackupPlaintextQuarantineDirectoryName)
      : deriveWorkspaceBackupImportOperationPaths(paths.userDataRoot, operationId).operationRoot;
    const child = await captureParents([paths.userDataRoot, paths.operationsRoot, rootPath], authority, reads, selected.identities);
    const rootIdentity = child.identities.at(-1);
    if (rootIdentity === null || rootIdentity === undefined) return invalidDeletionData(invalidCode);
    const childAuthority = { assertAuthority: child.assertCurrent, assertExternalSelection: child.assertSelected,
      assertWritersAbsent: authority.assertWritersAbsent.bind(authority) };
    if (quarantine) {
      // Stale plaintext belongs to the existing import admission owner, never to company deletion.
      for await (const _entry of observeWorkspaceDeletionDirectoryEntries(rootPath, childAuthority, reads)) {
        return invalidDeletionData(invalidCode);
      }
      await child.assertSelected();
      yield Object.freeze({ kind: 'installationQuarantine', rootPath, rootIdentity });
    } else {
      await child.assertSelected();
      yield Object.freeze({ kind: 'operation', operationId: operationId!, rootPath, rootIdentity });
      await child.assertSelected();
      for await (const candidate of observeCandidateEntries(paths.userDataRoot, rootPath, operationId, child, authority, reads)) {
        yield Object.freeze({ kind: 'candidate', selection: candidate });
      }
    }
    await child.assertSelected();
    await selected.assertSelected();
  }
  await selected.assertSelected();
}

// Payload side of one operation. The full census must also enumerate metadata and every named operation parent.
export async function* observeWorkspaceCandidateRemnants(
  userDataRoot: string, operationIdValue: unknown, authority: WorkspaceInspectionRemnantAuthority,
  reads: CandidateReads = nativeReads,
) {
  createWorkspaceDeletionJournalPaths(userDataRoot);
  const operationId = validateWorkspaceBackupImportOperationId(operationIdValue);
  const paths = deriveWorkspaceBackupImportOperationPaths(userDataRoot, operationId);
  const selected = await captureParents([paths.userDataRoot, paths.operationsRoot, paths.operationRoot], authority, reads);
  await selected.assertSelected();
  if (selected.identities.at(-1) === null) return;
  yield* observeCandidateEntries(paths.userDataRoot, paths.operationRoot, operationId, selected, authority, reads);
}

async function* observeCandidateEntries(
  userDataRoot: string, operationRoot: string, operationId: unknown,
  selected: Awaited<ReturnType<typeof captureParents>>, authority: WorkspaceInspectionRemnantAuthority, reads: CandidateReads,
) {
  const guarded = { assertAuthority: selected.assertCurrent, assertExternalSelection: selected.assertSelected };
  const candidateAuthority = { ...guarded, assertWritersAbsent: authority.assertWritersAbsent.bind(authority) };
  for await (const name of observeWorkspaceDeletionDirectoryEntries(operationRoot, guarded, reads)) {
    const workspaceId = validateWorkspaceId(name);
    const candidate = await captureWorkspaceCandidateRemnantSelection(userDataRoot, operationId, workspaceId, candidateAuthority, reads);
    // A name returned from the actual parent is not a payload absence observation.
    if (candidate.rootIdentity === null) return invalidDeletionData(invalidCode);
    await selected.assertSelected();
    yield candidate;
    await candidate.assertSelected();
    await selected.assertSelected();
  }
  await selected.assertSelected();
}

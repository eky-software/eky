import { findWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { LocalWorkspaceRegistryV1 } from '../registry/workspaceRegistryTypes.js';
import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';
import type {
  WorkspaceLegacyAdoptionJournalPort,
  WorkspaceLegacyAdoptionJournalV1,
} from './workspaceLegacyAdoptionJournal.js';
import { deriveWorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';
import type { WorkspaceLegacyAdoptionRootPort } from './workspaceLegacyAdoptionRootStore.js';

export type WorkspaceLegacyAdoptionRecoveryOutcome =
  | 'nothingToRecover'
  | 'relaunchRequired';

export interface RecoverWorkspaceLegacyAdoptionOptions {
  readonly journal: WorkspaceLegacyAdoptionJournalPort;
  readonly registry: WorkspaceRegistryPort;
  readonly rootStore: WorkspaceLegacyAdoptionRootPort;
  readonly userDataRoot: string;
}

export async function recoverWorkspaceLegacyAdoption(
  options: Readonly<RecoverWorkspaceLegacyAdoptionOptions>,
): Promise<WorkspaceLegacyAdoptionRecoveryOutcome> {
  try {
    const journal = await options.journal.read();
    if (journal?.state !== 'recoveryRequired') return 'nothingToRecover';
    if (journal.sourceKind !== 'legacy') return recoveryRequired();

    const registry = await options.registry.read();
    assertWorkspaceUnpublished(registry, journal);
    const paths = deriveWorkspaceLegacyAdoptionPaths(
      options.userDataRoot,
      journal.operationId,
      journal.workspaceId,
    );
    const registeredWorkspaceIds =
      registry?.workspaces.map((workspace) => workspace.workspaceId) ?? [];

    await options.rootStore.assertRecoveryLayout(
      paths,
      registeredWorkspaceIds,
    );
    if ((await options.rootStore.detectSourceKind(paths)) !== 'legacy') {
      return recoveryRequired();
    }

    const presence = await options.rootStore.readPresence(paths);
    if (presence.candidateExists && presence.finalExists) {
      return recoveryRequired();
    }
    if (presence.candidateExists) {
      await options.rootStore.discardRecoveryCandidateMatchingLegacy(paths);
    } else if (presence.finalExists) {
      await options.rootStore
        .discardUnregisteredPublishedRootMatchingLegacy(paths);
      await options.rootStore.discardEmptyRecoveryOperation(paths);
    } else {
      await options.rootStore.discardEmptyRecoveryOperation(paths);
    }

    await options.rootStore.assertRecoveryLayout(
      paths,
      registeredWorkspaceIds,
    );
    const recoveredPresence = await options.rootStore.readPresence(paths);
    if (recoveredPresence.candidateExists || recoveredPresence.finalExists) {
      return recoveryRequired();
    }
    if ((await options.rootStore.detectSourceKind(paths)) !== 'legacy') {
      return recoveryRequired();
    }

    const [currentJournal, currentRegistry] = await Promise.all([
      options.journal.read(),
      options.registry.read(),
    ]);
    assertJournalUnchanged(currentJournal, journal);
    assertWorkspaceUnpublished(currentRegistry, journal);
    await options.journal.clear(journal.operationId);
    return 'relaunchRequired';
  } catch (error) {
    throw mapRecoveryError(error);
  }
}

function assertWorkspaceUnpublished(
  registry: Readonly<LocalWorkspaceRegistryV1> | undefined,
  journal: Readonly<WorkspaceLegacyAdoptionJournalV1>,
): void {
  if (
    registry?.activeWorkspaceId === journal.workspaceId ||
    (registry !== undefined &&
      findWorkspaceEntry(registry, journal.workspaceId) !== undefined)
  ) {
    recoveryRequired();
  }
}

function assertJournalUnchanged(
  current: Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined,
  expected: Readonly<WorkspaceLegacyAdoptionJournalV1>,
): void {
  if (
    current?.formatVersion !== expected.formatVersion ||
    current.operationId !== expected.operationId ||
    current.workspaceId !== expected.workspaceId ||
    current.sourceKind !== expected.sourceKind ||
    current.state !== expected.state ||
    current.createdAt !== expected.createdAt
  ) {
    recoveryRequired();
  }
}

function recoveryRequired(): never {
  throw new WorkspaceLegacyAdoptionError(
    'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
  );
}

function mapRecoveryError(error: unknown): WorkspaceLegacyAdoptionError {
  return error instanceof WorkspaceLegacyAdoptionError
    ? error
    : new WorkspaceLegacyAdoptionError(
        'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
      );
}

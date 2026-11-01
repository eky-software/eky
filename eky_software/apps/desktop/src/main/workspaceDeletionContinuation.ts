import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import { deletionDataRecord } from '../workspaces/deletion/workspaceDeletionDataValidation.js';
import { captureWorkspaceDeletionJournal, sameWorkspaceDeletionJournalBinding,
  type WorkspaceDeletionJournalV1 } from '../workspaces/deletion/workspaceDeletionJournalCodec.js';
import type { WorkspaceDeletionPreparationOptions } from '../workspaces/management/workspaceDeletionPreparation.js';
import type { WorkspaceManagementServiceOptions } from '../workspaces/management/workspaceManagementService.js';
import type { WorkspaceId } from '../workspaces/registry/workspaceRegistryTypes.js';

/** Main-only ports. The publisher owns the complete inventory and its root proof. */
export interface WorkspaceDeletionMainCommand {
  publish(...args: Parameters<WorkspaceDeletionPreparationOptions['publish']>): Promise<Readonly<{
    journal: WorkspaceDeletionJournalV1;
    workspaceRootIdentity: string;
  }>>;
  resume: NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume'];
}

export function bindWorkspaceDeletionContinuation(input: {
  command: WorkspaceDeletionMainCommand;
  activeWorkspaceId: WorkspaceId | null;
  assertCurrent(): void;
  assertOwned(): Promise<void>;
  sealActiveMarker(): Promise<void>;
  recordActiveRemoved(): void;
}) {
  // Capture collaborators before the first await; they are never renderer inputs.
  const publish = input.command.publish.bind(input.command);
  const resume = input.command.resume.bind(input.command);
  const assertMain = input.assertCurrent.bind(input);
  const assertOwned = input.assertOwned.bind(input);
  const seal = input.sealActiveMarker.bind(input);
  const recordActiveRemoved = input.recordActiveRemoved.bind(input);
  const activeWorkspaceId = input.activeWorkspaceId;
  let selected: WorkspaceDeletionJournalV1 | undefined;
  let publicationStarted = false;
  let captured = false;
  let removed = false;
  let recording = false;
  const fail = (): never => { throw new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN'); };
  const assertCurrent = () => assertUpdateJournalAuthority(assertMain);
  const preparationPublish: WorkspaceDeletionPreparationOptions['publish'] = async (
    assertAuthority, assertPublicationCurrent, target, context, assertPreparationCurrent,
  ) => {
    assertCurrent();
    if (publicationStarted || context.target !== target || target.previousActiveWorkspaceId !== activeWorkspaceId) fail();
    publicationStarted = true;
    if (target.workspaceId === activeWorkspaceId) await seal();
    assertCurrent();
    assertUpdateJournalAuthority(assertAuthority);
    await assertPublicationCurrent();
    assertCurrent();
    assertUpdateJournalAuthority(assertAuthority);
    const published = await publish(assertAuthority, assertPublicationCurrent, target, context, assertPreparationCurrent);
    assertCurrent();
    assertUpdateJournalAuthority(assertAuthority);
    const journal = captureWorkspaceDeletionJournal(published.journal);
    if (journal.phase !== 'authorized' || journal.target.operationId !== context.operationId ||
        journal.target.workspaceId !== target.workspaceId || journal.target.lineageIdentity.profileId !== target.profileId ||
        journal.target.registryEntrySha256 !== target.registryEntrySha256 || journal.registryBeforeSha256 !== target.registrySha256 ||
        journal.previousActiveWorkspaceId !== target.previousActiveWorkspaceId || journal.backupDisposition !== context.backupDisposition ||
        published.workspaceRootIdentity !== target.rootIdentity) fail();
    selected = journal;
  };
  const continuation: NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']> = {
    captureAuthority(operationId, assertLease) {
      assertCurrent();
      assertUpdateJournalAuthority(assertLease);
      if (captured || selected === undefined || selected.target.operationId !== operationId) fail();
      captured = true;
      const binding = selected ?? fail();
      const assertOwner = () => {
        assertCurrent();
        assertUpdateJournalAuthority(assertLease);
        assertCurrent();
      };
      return Object.freeze({
        assertCurrent: assertOwner,
        async assertOwned() { assertOwner(); await assertOwned(); assertOwner(); },
        recordRemoved(value: unknown) {
          if (recording || removed) fail();
          recording = true;
          try {
            deletionDataRecord(value, ['status', 'journal'], 'WORKSPACE_DELETE_JOURNAL_CONFLICT');
            const terminal = captureWorkspaceDeletionJournal(value.journal);
            if (value.status !== 'removed' || terminal.phase !== 'registryPublished' ||
                !sameWorkspaceDeletionJournalBinding(binding, terminal)) fail();
            // No await or external callback may separate the final guard from storage.
            assertOwner();
            removed = true;
            if (binding.target.workspaceId === activeWorkspaceId) recordActiveRemoved();
            return Object.freeze({ formatVersion: 1 as const, status: 'completed' as const,
              navigation: binding.previousActiveWorkspaceId === null || binding.previousActiveWorkspaceId === binding.target.workspaceId
                ? 'selector' as const : 'reopenPrevious' as const });
          } finally { recording = false; }
        },
      });
    },
    resume,
  };
  return Object.freeze({ publish: preparationPublish, continuation });
}

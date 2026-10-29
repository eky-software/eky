import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import type { LocalWorkspaceRegistry, WorkspaceId, WorkspaceLineageIdentityV1 } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceBackupImportBinding } from './workspaceBackupImportBinding.js';
import type { WorkspaceBackupImportOperationId } from './workspaceBackupImportTypes.js';

export type WorkspaceBackupImportBindingPort = Pick<WorkspaceBackupImportBinding,
  'publish' | 'assertPublished' | 'assertMutationCurrent' | 'publishRegistry' | 'clearAfterPayloadsAbsent' | 'assertRetired'>;

export interface WorkspaceBackupImportOwner {
  // Captured generation and exact lease; physical main ownership is not required yet.
  assertCurrent(): void;
  assertMainCurrent(): void;
  assertMainOwned(): Promise<void>;
  onUncertain(): void;
  // Called only after terminal cleanup and successful release; must not borrow that lease.
  onTerminalAfterRelease(): void;
  createBinding(input: Readonly<{
    operationId: WorkspaceBackupImportOperationId;
    workspaceId: WorkspaceId;
    lineageIdentity: Readonly<WorkspaceLineageIdentityV1>;
    registrySelection: ReadOnlyJournalSlots<LocalWorkspaceRegistry>;
    assertJournalSelection(): Promise<void>;
    onUncertain(): void;
  }>): WorkspaceBackupImportBindingPort;
}

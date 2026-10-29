import type { WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceBackupImportJournal } from './workspaceBackupImportTypes.js';
import type { WorkspaceBackupImportJournalStore } from './workspaceBackupImportJournalStore.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';

export type ColdImportJournalPort = Pick<WorkspaceBackupImportJournalStore,
  'inspectRecoverySelection' | 'recoverObservedSelection' | 'inspectSlots' | 'writeSelected' | 'removeSelected' | 'discardBeforePublicationSelected'>;
export type ColdImportRegistryPort = Pick<WorkspaceRegistryStore,
  'inspectRecoverySelection' | 'recoverObservedSelection' | 'inspectSlots' | 'writeSelected'>;

// Captured synchronously immediately after acquiring this exact import lease.
// Main generation remains meaningful while the candidate owns the reservation.
export interface WorkspaceBackupImportColdOwner {
  assertCurrent(): void;
  assertMainOwned(): Promise<void>;
  assertRecoveryConflicts(input: Readonly<{
    journal: Readonly<WorkspaceBackupImportJournal>;
    registry: Readonly<LocalWorkspaceRegistry>;
  }>): Promise<void>;
  onUncertain(error: unknown): void;
}

export type CaptureWorkspaceBackupImportColdOwner =
  (lease: WorkspaceMaintenanceLeaseHandle) => WorkspaceBackupImportColdOwner;

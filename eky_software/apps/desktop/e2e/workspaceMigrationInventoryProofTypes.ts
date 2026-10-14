import type { WorkspaceMigrationInventoryStatus } from '../src/workspaces/update/workspaceMigrationInventoryTypes.js';

export interface WorkspaceMigrationInventoryProofInput {
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly resourcesPath: string;
  readonly userDataRoot: string;
}

export interface WorkspaceMigrationInventoryProofResult {
  readonly activeRuntimeCount: number;
  readonly activeWorkspacePreserved: boolean;
  readonly artifactRootsPreserved: boolean;
  readonly backendStoppedBeforeInventory: boolean;
  readonly candidateProcessesReleased: boolean;
  readonly databaseSnapshotsPreserved: boolean;
  readonly inspectedWorkspaceCount: number;
  readonly inventoryStatuses: readonly WorkspaceMigrationInventoryStatus[];
  readonly maximumActiveRuntimeCount: number;
  readonly migrationSidecarsAbsent: boolean;
  readonly observerSucceeded: boolean;
  readonly ownedHotJournalRecovered: boolean;
  readonly recoveredInventoryReadOnly: boolean;
  readonly registryPreserved: boolean;
  readonly untrustedInventoryInputsPreserved: boolean;
  readonly untrustedInventoryProcessesReleased: boolean;
  readonly untrustedInventoryRegistrySlotsPreserved: boolean;
  readonly untrustedInventoryRejected: boolean;
  readonly untrustedInventoryStoppedBeforeLaterWorkspaces: boolean;
}

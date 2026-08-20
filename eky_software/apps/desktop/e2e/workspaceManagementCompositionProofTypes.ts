export type WorkspaceManagementCompositionProofStage =
  | 'sourceComposition'
  | 'sourceCreate'
  | 'sourceBackup'
  | 'primaryComposition'
  | 'primaryCreate'
  | 'secondaryCreate'
  | 'import'
  | 'rename'
  | 'noOpSwitch'
  | 'maintenanceLease'
  | 'operationGuard'
  | 'replacementBackup'
  | 'replacementFaults'
  | 'replacement'
  | 'replacementRecovery'
  | 'switch'
  | 'result';

export interface WorkspaceManagementCompositionProofInput {
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly resourcesPath: string;
  readonly userDataRoot: string;
}

export interface WorkspaceManagementCompositionProofResult {
  readonly activeWorkspacePreservedDuringCreate: boolean;
  readonly activeWorkspacePreservedDuringImport: boolean;
  readonly candidateAppVersion: string;
  readonly candidateProcessesReleased: boolean;
  readonly createdWorkspaceCount: number;
  readonly importedWorkspaceValidated: boolean;
  readonly importedWorkspaceCount: number;
  readonly modeledMaximumBackendOwners: number;
  readonly modeledMaximumSqliteOwners: number;
  readonly noOpSwitchPreservedRuntime: boolean;
  readonly renamePersisted: boolean;
  readonly renamePreservedRuntime: boolean;
  readonly replacementAcceptedAfterRestart: boolean;
  readonly replacementFaultsRolledBack: boolean;
  readonly replacementLifecycleOrdered: boolean;
  readonly replacementPreservedUnrelatedWorkspaces: boolean;
  readonly sharedLeaseBlockedConcurrentOperation: boolean;
  readonly sourceBackupPreserved: boolean;
  readonly switchJournalPersisted: boolean;
  readonly switchRequestedRelaunch: boolean;
  readonly unresolvedOperationBlockedMutation: boolean;
}

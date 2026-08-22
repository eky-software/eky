import type { ElectronApplication } from '@playwright/test';

export interface ElectronNativeAdapterSnapshot {
  errorBoxCount: number;
  messageBoxCount: number;
  openDialogCount: number;
  openedPaths: readonly string[];
  saveDialogCount: number;
}

export interface ElectronProcessMetricsSnapshot {
  backendIsRunning: boolean;
  backendStartCount: number;
  processCount: number;
  totalWorkingSetSizeKilobytes: number;
  windowCount: number;
}

export interface WorkspaceManagementCompositionProofSnapshot {
  activeWorkspacePreservedDuringCreate: boolean;
  activeWorkspacePreservedDuringImport: boolean;
  candidateAppVersion: string;
  candidateProcessesReleased: boolean;
  createdWorkspaceCount: number;
  importedWorkspaceValidated: boolean;
  importedWorkspaceCount: number;
  modeledMaximumBackendOwners: number;
  modeledMaximumSqliteOwners: number;
  noOpSwitchPreservedRuntime: boolean;
  renamePersisted: boolean;
  renamePreservedRuntime: boolean;
  replacementAcceptedAfterRestart: boolean;
  replacementFaultsRolledBack: boolean;
  replacementLifecycleOrdered: boolean;
  replacementPreservedUnrelatedWorkspaces: boolean;
  sharedLeaseBlockedConcurrentOperation: boolean;
  sourceBackupPreserved: boolean;
  switchJournalPersisted: boolean;
  switchRequestedRelaunch: boolean;
  unresolvedOperationBlockedMutation: boolean;
}

export interface WorkspaceStartupRecoveryProofSnapshot {
  admissionRejectedBeforeWorkspaceResolution: boolean;
  admissionSideEffectsAbsent: boolean;
  historicalCopyDiscarded: boolean;
  historicalJournalCleared: boolean;
  legacyArtifactsPreserved: boolean;
  readoptionArtifactsMatch: boolean;
  registryPublishedOnlyAfterAcceptance: boolean;
  relaunchCount: number;
}

export interface WorkspaceMigrationInventoryProofSnapshot {
  activeRuntimeCount: number;
  activeWorkspacePreserved: boolean;
  artifactRootsPreserved: boolean;
  backendStoppedBeforeInventory: boolean;
  candidateProcessesReleased: boolean;
  databaseSnapshotsPreserved: boolean;
  inspectedWorkspaceCount: number;
  inventoryStatuses: readonly string[];
  maximumActiveRuntimeCount: number;
  migrationSidecarsAbsent: boolean;
  observerSucceeded: boolean;
  registryPreserved: boolean;
}

export interface WorkspaceFirstStartMigrationProofSnapshot {
  activePointerPreserved: boolean;
  allCurrentCompletedWithoutJournal: boolean;
  allCurrentRegistryPreserved: boolean;
  artifactRootsPreserved: boolean;
  backendStartCount: number;
  backendStoppedAfterProof: boolean;
  candidateProcessesReleased: boolean;
  directSetupRecoveryCleared: boolean;
  exactAcceptedRestartSkippedInventory: boolean;
  invalidPassiveWorkspaceQuarantined: boolean;
  migrationJournalCleared: boolean;
  mixedActiveWorkspaceMigrated: boolean;
  passiveCompatibleWorkspacePreserved: boolean;
  preparedBeforeBackend: boolean;
  relaunchCount: number;
  targetAcceptedAfterRegistryTransition: boolean;
}

export interface WorkspaceActivationMigrationProofSnapshot {
  activationJournalsCleared: boolean;
  artifactRootsPreserved: boolean;
  backendStartCount: number;
  backendStoppedAfterProof: boolean;
  businessDataPreserved: boolean;
  candidateProcessesReleased: boolean;
  compatibleTargetMigratedOnlyOnActivation: boolean;
  currentTargetPreserved: boolean;
  faultTargetPreserved: boolean;
  invalidTargetQuarantined: boolean;
  invalidTargetRejectedBeforeBackend: boolean;
  migrationRecoveryPointCreated: boolean;
  registryRecoveredAfterFault: boolean;
  relaunchCount: number;
  secondTargetStartupIdempotent: boolean;
  switchJournalsCleared: boolean;
  targetAcceptedAfterValidation: boolean;
  targetLifecycleWithheldUntilReady: boolean;
}

export function closeElectronPdfPreviews(
  electronApp: ElectronApplication,
): Promise<void> {
  return electronApp.evaluate(() => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: ElectronE2eController;
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    controller.closePdfPreviewWindows();
  });
}

export function killElectronBackendUnexpectedly(
  electronApp: ElectronApplication,
): Promise<void> {
  return electronApp.evaluate(() => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: ElectronE2eController;
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    controller.killBackendUnexpectedly();
  });
}

export function readElectronNativeAdapterSnapshot(
  electronApp: ElectronApplication,
): Promise<ElectronNativeAdapterSnapshot> {
  return electronApp.evaluate(() => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: ElectronE2eController;
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    return controller.nativeAdapterSnapshot();
  });
}

export function readElectronPdfPreviewUrls(
  electronApp: ElectronApplication,
): Promise<readonly string[]> {
  return electronApp.evaluate(() => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: ElectronE2eController;
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    return controller.pdfPreviewUrls();
  });
}

export function readElectronProcessMetrics(
  electronApp: ElectronApplication,
): Promise<ElectronProcessMetricsSnapshot> {
  return electronApp.evaluate(() => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: ElectronE2eController;
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    return controller.processMetrics();
  });
}

export function runElectronWorkspaceManagementCompositionProof(
  electronApp: ElectronApplication,
): Promise<WorkspaceManagementCompositionProofSnapshot> {
  return electronApp.evaluate(async () => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: ElectronE2eController;
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    return controller.runWorkspaceManagementCompositionProof();
  });
}

export function runElectronWorkspaceMigrationInventoryProof(
  electronApp: ElectronApplication,
): Promise<WorkspaceMigrationInventoryProofSnapshot> {
  return electronApp.evaluate(async () => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: ElectronE2eController;
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    return controller.runWorkspaceMigrationInventoryProof();
  });
}

export function runElectronWorkspaceFirstStartMigrationProof(
  electronApp: ElectronApplication,
): Promise<WorkspaceFirstStartMigrationProofSnapshot> {
  return electronApp.evaluate(async () => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: ElectronE2eController;
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    return controller.runWorkspaceFirstStartMigrationProof();
  });
}

export function runElectronWorkspaceActivationMigrationProof(
  electronApp: ElectronApplication,
): Promise<WorkspaceActivationMigrationProofSnapshot> {
  return electronApp.evaluate(async () => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: ElectronE2eController;
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    return controller.runWorkspaceActivationMigrationProof();
  });
}

export function runElectronWorkspaceStartupRecoveryProof(
  electronApp: ElectronApplication,
): Promise<WorkspaceStartupRecoveryProofSnapshot> {
  return electronApp.evaluate(async () => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: ElectronE2eController;
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    return controller.runWorkspaceStartupRecoveryProof();
  });
}

interface ElectronE2eController {
  closePdfPreviewWindows(): void;
  killBackendUnexpectedly(): void;
  nativeAdapterSnapshot(): ElectronNativeAdapterSnapshot;
  pdfPreviewUrls(): readonly string[];
  processMetrics(): ElectronProcessMetricsSnapshot;
  runWorkspaceActivationMigrationProof(): Promise<WorkspaceActivationMigrationProofSnapshot>;
  runWorkspaceManagementCompositionProof(): Promise<WorkspaceManagementCompositionProofSnapshot>;
  runWorkspaceFirstStartMigrationProof(): Promise<WorkspaceFirstStartMigrationProofSnapshot>;
  runWorkspaceMigrationInventoryProof(): Promise<WorkspaceMigrationInventoryProofSnapshot>;
  runWorkspaceStartupRecoveryProof(): Promise<WorkspaceStartupRecoveryProofSnapshot>;
}

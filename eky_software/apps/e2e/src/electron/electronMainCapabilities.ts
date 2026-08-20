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
  candidateProcessesReleased: boolean;
  createdWorkspaceCount: number;
  importedWorkspaceValidated: boolean;
  importedWorkspaceCount: number;
  maximumBackendOwners: number;
  maximumSqliteOwners: number;
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

interface ElectronE2eController {
  closePdfPreviewWindows(): void;
  killBackendUnexpectedly(): void;
  nativeAdapterSnapshot(): ElectronNativeAdapterSnapshot;
  pdfPreviewUrls(): readonly string[];
  processMetrics(): ElectronProcessMetricsSnapshot;
  runWorkspaceManagementCompositionProof(): Promise<WorkspaceManagementCompositionProofSnapshot>;
}

import type { ElectronApplication, TestInfo } from '@playwright/test';
import type { FirstStartLoadSnapshot } from '../../../desktop/e2e/workspaceFirstStartLoadObservation.js';
import type { WorkspaceAdoptionAcceptanceProofReply, WorkspaceAdoptionAcceptanceProofResult } from '../../../desktop/e2e/workspaceAdoptionAcceptanceProof.js';
import { createRunnerFailureSink } from '../../../../test-reporters/runnerFailureEvidence.mjs';

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
  publishedCreationRecovered: boolean;
  publishedImportRecovered: boolean;
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
  selectorOpeningVerified?: true;
  deferredBusinessVerified?: true;
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
  opening: 'selected' | 'selector' | 'selectorDeferred' = 'selected',
): Promise<WorkspaceActivationMigrationProofSnapshot> {
  return electronApp.evaluate(async (_electron, selectedOpening) => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: ElectronE2eController;
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    return controller.runWorkspaceActivationMigrationProof(selectedOpening);
  }, opening);
}

export function runElectronWorkspaceFirstStartLoadOrderDiagnostic(
  electronApp: ElectronApplication,
): Promise<{ proof: WorkspaceFirstStartMigrationProofSnapshot; loads: readonly FirstStartLoadSnapshot[] }> {
  return electronApp.evaluate(() => {
    const controller = (globalThis as typeof globalThis & {
      __EKY_ELECTRON_E2E__?: ElectronE2eController;
    }).__EKY_ELECTRON_E2E__;
    if (controller === undefined) throw new Error('Electron E2E controller is unavailable.');
    return controller.runWorkspaceFirstStartLoadOrderDiagnostic();
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

export async function runElectronWorkspaceAdoptionAcceptanceProof(
  electronApp: Pick<ElectronApplication, 'evaluate'>,
  testInfo: Pick<TestInfo, 'title' | 'testId' | 'file' | 'line' | 'column' | 'retry' | 'repeatEachIndex' | 'annotations'>,
  sink = createRunnerFailureSink(),
): Promise<Readonly<WorkspaceAdoptionAcceptanceProofResult>> {
  const reply = await electronApp.evaluate(async () => {
    const controller = (globalThis as typeof globalThis & {
      __EKY_ELECTRON_E2E__?: ElectronE2eController;
    }).__EKY_ELECTRON_E2E__;
    if (controller === undefined) throw new Error('Electron E2E controller is unavailable.');
    return controller.runWorkspaceAdoptionAcceptanceProof();
  });
  if (reply.status === 'completed') return reply.result;
  // The existing private sink preserves the main-side cause before transport
  // discards Error.cause. No raw detail becomes the public test exception.
  let delivery = 'captureFailed';
  try {
    sink.record({ runner: 'playwright', phase: 'workspaceAdoptionAcceptance', error: undefined,
      projectedException: reply.exception, testName: testInfo.title, testId: `${testInfo.testId}:${reply.runtimeInstanceId}`,
      file: testInfo.file, line: testInfo.line, column: testInfo.column,
      attempt: testInfo.retry, repeatCount: testInfo.repeatEachIndex });
    delivery = (await sink.flush() as { status: string }).status;
    if (delivery === 'recorded' && (reply.exception.incomplete || reply.exception.chain.some(part => part.truncated))) delivery = 'partial';
  } catch { /* Optional reporting must preserve the original test failure. */ }
  try { testInfo.annotations.push({ type: 'workspace-adoption-evidence', description: delivery }); }
  catch { /* Optional reporting. */ }
  throw new Error('WORKSPACE_ADOPTION_ACCEPTANCE_PROOF_FAILED');
}

interface ElectronE2eController {
  closePdfPreviewWindows(): void;
  killBackendUnexpectedly(): void;
  nativeAdapterSnapshot(): ElectronNativeAdapterSnapshot;
  pdfPreviewUrls(): readonly string[];
  processMetrics(): ElectronProcessMetricsSnapshot;
  runWorkspaceActivationMigrationProof(opening: 'selected' | 'selector' | 'selectorDeferred'): Promise<WorkspaceActivationMigrationProofSnapshot>;
  runWorkspaceManagementCompositionProof(): Promise<WorkspaceManagementCompositionProofSnapshot>;
  runWorkspaceFirstStartMigrationProof(): Promise<WorkspaceFirstStartMigrationProofSnapshot>;
  runWorkspaceFirstStartLoadOrderDiagnostic(): Promise<{
    proof: WorkspaceFirstStartMigrationProofSnapshot;
    loads: readonly FirstStartLoadSnapshot[];
  }>;
  runWorkspaceMigrationInventoryProof(): Promise<WorkspaceMigrationInventoryProofSnapshot>;
  runWorkspaceStartupRecoveryProof(): Promise<WorkspaceStartupRecoveryProofSnapshot>;
  runWorkspaceAdoptionAcceptanceProof(): Promise<WorkspaceAdoptionAcceptanceProofReply>;
}

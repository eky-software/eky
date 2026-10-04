import { writeFile } from 'node:fs/promises';
import type { TestInfo } from '@playwright/test';

import { recordElectronEvidenceFailure } from '../../scripts/electronLifecycleProjection.mjs';
import type { FirstStartProofCapture } from '../../../desktop/e2e/workspaceFirstStartProofObservation.js';
import type { ElectronBridgeCleanupEvidence } from '../environment/startOwnedWindowsElectronBridge.js';
import type { E2eBackendStartupFailureEvidence } from '../environment/startE2eBackendProcess.js';
import type { ElectronBackendStartupLogsCapture } from './captureElectronBackendStartupLogs.js';
import type { ElectronFirstLaunchFailure } from './captureElectronLaunchFailure.js';
import type { ElectronNativeStartupFailureCapture } from './captureElectronNativeStartupFailure.js';
import type { ElectronLaunchObservation, ElectronStartupCapture } from './launchElectronRuntime.js';
import type { ElectronPublicCloseFailureReason } from './closeOwnedWindowsElectronRuntime.js';

export interface ElectronPublicCloseFailureEvidence {
  readonly startupGeneration: number;
  readonly reason: ElectronPublicCloseFailureReason;
}

export interface ElectronCleanupResult {
  api: 'completed' | 'failed' | 'notStarted';
  runtime: 'completed' | 'unverified' | 'notStarted';
  port: 'released' | 'unverified' | 'notStarted';
  runRoot: 'removed' | 'retained' | 'removalFailed';
}

export interface ElectronPreparationFailureEvidence {
  readonly stage: 'workspaceBackup';
  readonly backend: E2eBackendStartupFailureEvidence | null;
}

export async function reportElectronLifecycleEvidence(
  testInfo: TestInfo,
  evidence: {
    launch: readonly ElectronLaunchObservation[];
    observationsTruncated: boolean;
    cleanup: Readonly<ElectronCleanupResult>;
    startupCapture?: ElectronStartupCapture;
    backendStartupLogs?: ElectronBackendStartupLogsCapture;
    nativeStartupFailure?: ElectronNativeStartupFailureCapture;
    launchExitCode?: number | null;
    firstLaunchFailure?: Readonly<ElectronFirstLaunchFailure> | null;
    firstStartProof?: FirstStartProofCapture;
    preparation?: ElectronPreparationFailureEvidence;
    ownership?: Readonly<ElectronBridgeCleanupEvidence>;
    publicCloseFailure?: ElectronPublicCloseFailureEvidence;
  },
): Promise<void> {
  const body = JSON.stringify({
      schemaVersion: 1,
      attempt: testInfo.retry,
      launch: evidence.launch,
      observationsTruncated: evidence.observationsTruncated,
      cleanup: evidence.cleanup,
      startupCapture: evidence.startupCapture ?? { status: 'notRequested' },
      ...(evidence.backendStartupLogs === undefined ? {} : { backendStartupLogs: evidence.backendStartupLogs }),
      ...(evidence.nativeStartupFailure === undefined ? {} : { nativeStartupFailure: evidence.nativeStartupFailure }),
      ...(evidence.launchExitCode === undefined ? {} : { launchExitCode: evidence.launchExitCode }),
      ...(evidence.firstLaunchFailure === undefined ? {} : { firstLaunchFailure: evidence.firstLaunchFailure }),
      ...(evidence.firstStartProof === undefined ? {} : { firstStartProof: evidence.firstStartProof }),
      ...(evidence.preparation === undefined ? {} : { preparation: evidence.preparation }),
      ...(evidence.ownership === undefined ? {} : { ownership: evidence.ownership }),
      ...(evidence.publicCloseFailure === undefined ? {} : { publicCloseFailure: evidence.publicCloseFailure }),
    });
  let failed = false;
  try {
    await writeFile(testInfo.outputPath('electron-lifecycle.json'), body,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch {
    failed = true;
    recordElectronEvidenceFailure(testInfo, 'fileWriteFailed');
  }
  try {
    await testInfo.attach('electron-lifecycle', { contentType: 'application/json', body });
  } catch {
    failed = true;
    recordElectronEvidenceFailure(testInfo, 'attachmentFailed');
  }
  if (failed) throw new Error('E2E_ELECTRON_EVIDENCE_FAILED');
}

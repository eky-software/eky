import { watch } from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const STAGES = Object.freeze([
  'startup',
  'backend',
  'emptyArtifactSnapshot',
  'diagnostics',
  'logFolder',
  'supportBundle',
  'secretStorage',
  'invoicePdfArchive',
  'pdfPreview',
  'profileBackup',
  'profileSnapshotMaintenance',
  'profileSnapshotCreated',
  'profileSnapshotCaptured',
  'profileBackupVerified',
  'profileMutationCreated',
  'profileRestore',
  'profileRestoreStaged',
  'restoreRestart',
  'restoredStartup',
  'restoreActivationJournalLoaded',
  'restoredBackend',
  'restoredSessionValidated',
  'profileComparison',
  'secondBackup',
  'shutdown',
]);

// Project only exact startup codes from the frozen 0.2.6 writer, never raw codes.
const APPLICATION_FAILURE_CLASSES = new Map([
  ['BACKEND_EXITED_BEFORE_READY', 'backendExitedBeforeReady'],
  ['BACKEND_READINESS_TIMEOUT', 'backendReadinessTimeout'],
  ['DESKTOP_START_FAILED', 'desktopStartFailed'],
  ['PACKAGED_BUILD_INFO_INVALID', 'packagedBuildInfoInvalid'],
  ['PACKAGED_SMOKE_FAILED', 'packagedSmokeFailed'],
  ['PROFILE_MAINTENANCE_BUSY', 'profileMaintenanceBusy'],
  ['PROFILE_MAINTENANCE_OPERATION_MISMATCH', 'profileMaintenanceOperationMismatch'],
  ['PROFILE_MAINTENANCE_TIMEOUT', 'profileMaintenanceTimeout'],
  ['PROFILE_RESTORE_RECOVERY_REQUIRED', 'profileRestoreRecoveryRequired'],
  ['PROFILE_SNAPSHOT_ARTIFACTS_FAILED', 'profileSnapshotArtifactsFailed'],
  ['PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED', 'profileSnapshotBrokerOperationFailed'],
  ['PROFILE_SNAPSHOT_BROKER_REQUEST_INVALID', 'profileSnapshotBrokerRequestInvalid'],
  ['PROFILE_SNAPSHOT_STAGING_FAILED', 'profileSnapshotStagingFailed'],
  ['PROFILE_SNAPSHOT_BROKER_UNAVAILABLE', 'profileSnapshotBrokerUnavailable'],
  ['PROFILE_SNAPSHOT_DATABASE_FAILED', 'profileSnapshotDatabaseFailed'],
  ['PROFILE_SNAPSHOT_VALIDATION_FAILED', 'profileSnapshotValidationFailed'],
]);

class HistoricalSmokeFailure extends Error {
  constructor(message, reason, result, cause) {
    super(message, { cause });
    this.evidence = Object.freeze({
      smokeReason: reason,
      smokeStage: result?.stage ?? 'unknown',
      smokeStatus: result?.status ?? 'unknown',
      smokeFailureClass: reason === 'applicationReportedFailure' && result?.status === 'failed'
        ? APPLICATION_FAILURE_CLASSES.get(result.code) ?? 'unclassified'
        : 'notReported',
    });
  }
}

export function describeHistoricalPackagedSmokeFailure(error) {
  return error instanceof HistoricalSmokeFailure ? error.evidence : {};
}

export function validateHistoricalPackagedSmokeResult(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !STAGES.includes(value.stage)
  ) {
    throw new Error('sourcePackagedSmokeResultInvalid');
  }
  const keys = Object.keys(value).sort();
  if (
    value.status === 'started' &&
    keys.length === 2 &&
    keys[0] === 'stage' &&
    keys[1] === 'status'
  ) {
    return Object.freeze({ stage: value.stage, status: 'started' });
  }
  if (
    value.status === 'failed' &&
    keys.length === 3 &&
    keys[0] === 'code' &&
    keys[1] === 'stage' &&
    keys[2] === 'status' &&
    typeof value.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,99}$/.test(value.code)
  ) {
    return Object.freeze({
      code: value.code,
      stage: value.stage,
      status: 'failed',
    });
  }
  if (
    value.status === 'ok' &&
    value.stage === 'shutdown' &&
    keys.length === 3 &&
    keys[0] === 'electronVersion' &&
    keys[1] === 'stage' &&
    keys[2] === 'status' &&
    typeof value.electronVersion === 'string' &&
    /^\d+\.\d+\.\d+$/.test(value.electronVersion)
  ) {
    return Object.freeze({ ...value });
  }
  throw new Error('sourcePackagedSmokeResultInvalid');
}

export async function initializeHistoricalPackagedSmokeResult(resultPath) {
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(
    resultPath,
    `${JSON.stringify({ stage: 'startup', status: 'started' })}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
}

export async function readHistoricalPackagedSmokeResult(resultPath) {
  try {
    const metadata = await lstat(resultPath, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      metadata.size > 4_096n
    ) {
      throw new Error('sourcePackagedSmokeResultInvalid');
    }
    const source = await readFile(resultPath, 'utf8');
    if (Buffer.byteLength(source, 'utf8') > 4_096) {
      throw new Error('sourcePackagedSmokeResultInvalid');
    }
    // The frozen historical writer truncates in place before writing JSON + LF.
    if (!source.endsWith('\n')) return null;
    return validateHistoricalPackagedSmokeResult(JSON.parse(source));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('sourcePackagedSmokeResultInvalid');
    }
    throw error;
  }
}

export async function waitForHistoricalPackagedSmokeResult({
  childCompletion,
  expectedStage,
  expectedStatus,
  resultPath,
}) {
  // Observe rejection before yielding to filesystem validation.
  const childFailed = childCompletion.then(() => false, () => true);
  let watchDirectory;
  try {
    const directory = dirname(resultPath);
    const before = await lstat(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new Error('sourcePackagedSmokeResultInvalid');
    }
    // libuv can abort on a Windows 8.3 alias; preserve the directory identity.
    watchDirectory = await realpath(directory);
    const after = await lstat(watchDirectory, { bigint: true });
    if (
      !after.isDirectory() || after.isSymbolicLink() ||
      before.dev !== after.dev || before.ino !== after.ino
    ) {
      throw new Error('sourcePackagedSmokeResultInvalid');
    }
  } catch {
    throw new HistoricalSmokeFailure('sourcePackagedSmokeResultInvalid', 'watchSetupFailed');
  }
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let scanning = false;
    let scanAgain = false;
    let childExited = false;
    let lastResult;
    let watcher;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      watcher?.close();
      callback(value);
    };
    const scan = async () => {
      if (settled) return;
      if (scanning) {
        scanAgain = true;
        return;
      }
      scanning = true;
      try {
        const result = await readHistoricalPackagedSmokeResult(resultPath);
        if (result !== null) lastResult = result;
        if (result?.status === 'failed') {
          settle(rejectPromise, new HistoricalSmokeFailure(
            'sourcePackagedSmokeFailed', 'applicationReportedFailure', result,
          ));
        } else if (
          result?.stage === expectedStage &&
          result.status === expectedStatus
        ) {
          settle(resolvePromise, result);
        } else if (childExited) {
          settle(rejectPromise, new HistoricalSmokeFailure(
            'sourcePackagedSmokeExitedEarly', 'processExitedEarly', lastResult,
          ));
        }
      } catch (error) {
        settle(rejectPromise, new HistoricalSmokeFailure(
          error.message,
          error.message === 'sourcePackagedSmokeResultInvalid' ? 'resultInvalid' : 'resultReadFailed',
          lastResult,
          error,
        ));
      } finally {
        scanning = false;
        if (scanAgain && !settled) {
          scanAgain = false;
          void scan();
        }
      }
    };
    try {
      watcher = watch(watchDirectory, { persistent: false }, () =>
        void scan(),
      );
      watcher.once('error', () =>
        settle(rejectPromise, new HistoricalSmokeFailure(
          'sourcePackagedSmokeResultInvalid', 'watchFailed', lastResult,
        )),
      );
    } catch {
      settle(rejectPromise, new HistoricalSmokeFailure('sourcePackagedSmokeResultInvalid', 'watchSetupFailed'));
      return;
    }
    void scan();
    childFailed.then((failed) => {
      if (failed) {
        settle(rejectPromise, new HistoricalSmokeFailure(
          'sourcePackagedSmokeExitedEarly', 'processCompletionFailed', lastResult,
        ));
      } else {
        childExited = true;
        void scan();
      }
    });
  });
}

export async function runHistoricalPackagedSmokeProcessChain({
  resultPath,
  startGeneration,
}) {
  let generation = 'initial';
  let boundary = 'resultInitializationFailed';
  try {
    await initializeHistoricalPackagedSmokeResult(resultPath);
    boundary = 'processStartFailed';
    const initial = await startGeneration(generation);
    boundary = 'resultReadFailed';
    await waitForHistoricalPackagedSmokeResult({
      childCompletion: initial.completion,
      expectedStage: 'restoreRestart',
      expectedStatus: 'started',
      resultPath,
    });
    boundary = 'processCompletionFailed';
    const initialResult = await initial.completion;
    if (initialResult.exitCode !== 0) {
      throw new HistoricalSmokeFailure('sourcePackagedSmokeFailed', 'processExitFailed', {
        stage: 'restoreRestart', status: 'started',
      });
    }

    generation = 'restored';
    boundary = 'processStartFailed';
    const restored = await startGeneration(generation);
    boundary = 'resultReadFailed';
    await waitForHistoricalPackagedSmokeResult({
      childCompletion: restored.completion,
      expectedStage: 'shutdown',
      expectedStatus: 'ok',
      resultPath,
    });
    boundary = 'processCompletionFailed';
    const restoredResult = await restored.completion;
    if (restoredResult.exitCode !== 0) {
      throw new HistoricalSmokeFailure('sourcePackagedSmokeFailed', 'processExitFailed', {
        stage: 'shutdown', status: 'ok',
      });
    }
    return Object.freeze({
      contract: 'explicitTwoPhase',
      initialGenerationCount: 1,
      restoredGenerationCount: 1,
    });
  } catch (error) {
    const failure = error instanceof HistoricalSmokeFailure ? error
      : new HistoricalSmokeFailure(error?.message, boundary, undefined, error);
    failure.evidence = Object.freeze({ ...failure.evidence, smokeGeneration: generation });
    throw failure;
  }
}

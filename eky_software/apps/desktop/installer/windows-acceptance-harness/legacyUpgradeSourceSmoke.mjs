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
    throw new Error('sourcePackagedSmokeResultInvalid');
  }
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let scanning = false;
    let scanAgain = false;
    let childExited = false;
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
        if (result?.status === 'failed') {
          settle(rejectPromise, new Error('sourcePackagedSmokeFailed'));
        } else if (
          result?.stage === expectedStage &&
          result.status === expectedStatus
        ) {
          settle(resolvePromise, result);
        } else if (childExited) {
          settle(rejectPromise, new Error('sourcePackagedSmokeExitedEarly'));
        }
      } catch (error) {
        settle(rejectPromise, error);
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
        settle(rejectPromise, new Error('sourcePackagedSmokeResultInvalid')),
      );
    } catch {
      settle(rejectPromise, new Error('sourcePackagedSmokeResultInvalid'));
      return;
    }
    void scan();
    childFailed.then((failed) => {
      if (failed) {
        settle(rejectPromise, new Error('sourcePackagedSmokeExitedEarly'));
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
  await initializeHistoricalPackagedSmokeResult(resultPath);
  const initial = await startGeneration('initial');
  await waitForHistoricalPackagedSmokeResult({
    childCompletion: initial.completion,
    expectedStage: 'restoreRestart',
    expectedStatus: 'started',
    resultPath,
  });
  const initialResult = await initial.completion;
  if (initialResult.exitCode !== 0) {
    throw new Error('sourcePackagedSmokeFailed');
  }

  const restored = await startGeneration('restored');
  await waitForHistoricalPackagedSmokeResult({
    childCompletion: restored.completion,
    expectedStage: 'shutdown',
    expectedStatus: 'ok',
    resultPath,
  });
  const restoredResult = await restored.completion;
  if (restoredResult.exitCode !== 0) {
    throw new Error('sourcePackagedSmokeFailed');
  }
  return Object.freeze({
    contract: 'explicitTwoPhase',
    initialGenerationCount: 1,
    restoredGenerationCount: 1,
  });
}

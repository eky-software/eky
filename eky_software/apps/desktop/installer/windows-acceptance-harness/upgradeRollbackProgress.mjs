import { watch } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';

const MAX_PROGRESS_BYTES = 16 * 1024;
const MAX_PROGRESS_MILLISECONDS = 3_600_000;
const MAX_PROGRESS_RECORDS = 10;
const PROGRESS_EVENTS = new Set(['started', 'completed', 'failed']);
const PROGRESS_PHASES = Object.freeze([
  'inputValidation',
  'launcherExitWait',
  'failedPackageUninstall',
  'rollbackPackageInstall',
  'failedPackageRepair',
]);

function invalidProgress() {
  throw new Error('binaryRollbackProgressInvalid');
}

function exactKeys(value, expectedKeys) {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  );
}

function validateProgressSequence(records) {
  let phaseIndex = 0;
  let phaseStarted = false;
  let previousElapsedMs = 0;
  let terminal = false;

  for (const record of records) {
    if (
      terminal ||
      record.phase !== PROGRESS_PHASES[phaseIndex] ||
      record.elapsedMs < previousElapsedMs
    ) {
      invalidProgress();
    }
    previousElapsedMs = record.elapsedMs;
    if (!phaseStarted) {
      if (record.event !== 'started' || record.durationMs !== 0) {
        invalidProgress();
      }
      phaseStarted = true;
      continue;
    }
    if (record.event === 'started') {
      invalidProgress();
    }
    phaseStarted = false;
    if (record.event === 'failed') {
      if (record.phase === 'rollbackPackageInstall') {
        phaseIndex += 1;
      } else {
        terminal = true;
      }
      continue;
    }
    if (
      record.phase === 'rollbackPackageInstall' ||
      record.phase === 'failedPackageRepair'
    ) {
      terminal = true;
    } else {
      phaseIndex += 1;
    }
  }
}

export function parseUpgradeRollbackProgressBytes(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    invalidProgress();
  }
  if (text.includes('\0') || text.startsWith('\uFEFF')) {
    invalidProgress();
  }
  let normalized = text.replaceAll('\r\n', '\n');
  if (normalized.includes('\r')) {
    invalidProgress();
  }
  if (normalized !== '' && !normalized.endsWith('\n')) {
    const lastNewline = normalized.lastIndexOf('\n');
    normalized = lastNewline < 0 ? '' : normalized.slice(0, lastNewline + 1);
  }
  const lines = normalized.split('\n').filter((line) => line !== '');
  if (lines.length > MAX_PROGRESS_RECORDS) {
    invalidProgress();
  }

  const records = lines.map((line) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      invalidProgress();
    }
    if (
      value === null ||
      Array.isArray(value) ||
      typeof value !== 'object' ||
      !exactKeys(value, ['durationMs', 'elapsedMs', 'event', 'phase']) ||
      !PROGRESS_PHASES.includes(value.phase) ||
      !PROGRESS_EVENTS.has(value.event) ||
      !Number.isSafeInteger(value.durationMs) ||
      !Number.isSafeInteger(value.elapsedMs) ||
      value.durationMs < 0 ||
      value.elapsedMs < 0 ||
      value.durationMs > MAX_PROGRESS_MILLISECONDS ||
      value.elapsedMs > MAX_PROGRESS_MILLISECONDS ||
      value.durationMs > value.elapsedMs
    ) {
      invalidProgress();
    }
    return Object.freeze({
      durationMs: value.durationMs,
      elapsedMs: value.elapsedMs,
      event: value.event,
      phase: value.phase,
    });
  });
  validateProgressSequence(records);
  return Object.freeze(records);
}

export async function readUpgradeRollbackProgress(path) {
  let metadata;
  let bytes;
  try {
    metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      metadata.size > BigInt(MAX_PROGRESS_BYTES)
    ) {
      invalidProgress();
    }
    bytes = await readFile(path);
  } catch (error) {
    if (error?.message === 'binaryRollbackProgressInvalid') {
      throw error;
    }
    invalidProgress();
  }
  return parseUpgradeRollbackProgressBytes(bytes);
}

export function createUpgradeRollbackProgressWaiter({ event, path, phase }) {
  if (!PROGRESS_PHASES.includes(phase) || !PROGRESS_EVENTS.has(event)) {
    invalidProgress();
  }
  let closed = false;
  let settled = false;
  let scan = Promise.resolve();
  let watcher;
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolvePromise, rejectPromise) => {
    resolveCompletion = resolvePromise;
    rejectCompletion = rejectPromise;
  });

  function close() {
    if (closed) {
      return;
    }
    closed = true;
    watcher?.close();
  }

  function fail() {
    if (settled) {
      return;
    }
    settled = true;
    close();
    rejectCompletion(new Error('binaryRollbackProgressInvalid'));
  }

  function inspect() {
    if (closed || settled) {
      return;
    }
    scan = scan
      .then(async () => {
        const records = await readUpgradeRollbackProgress(path);
        if (
          records.some(
            (record) => record.phase === phase && record.event === event,
          )
        ) {
          settled = true;
          close();
          resolveCompletion();
        }
      })
      .catch(fail);
  }

  try {
    watcher = watch(path, { persistent: false }, inspect);
    watcher.once('error', fail);
    inspect();
  } catch {
    fail();
  }

  return Object.freeze({ close, completion });
}

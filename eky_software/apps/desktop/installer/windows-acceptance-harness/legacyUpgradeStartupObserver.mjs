import { watch } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BUILD_REVISION_PATTERN = /^[0-9a-f]{7,40}$/;
const LOG_FILE_PATTERN =
  /^desktop-(?:info|warning-error)-\d{4}-(?:0[1-9]|1[0-2])-00[1-4]\.jsonl$/;
const RELEVANT_EVENTS = new Set([
  'desktop.bootstrapFailed',
  'desktop.shutdownCompleted',
  'desktop.started',
]);

function canonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validateRelevantEvent(value) {
  const expected = {
    'desktop.started': ['runtime', 'info', 'success'],
    'desktop.shutdownCompleted': ['runtime', 'info', 'success'],
    'desktop.bootstrapFailed': ['runtime', 'error', 'failure'],
  }[value.eventName];
  if (
    expected === undefined ||
    value.schemaVersion !== 1 ||
    value.component !== 'desktop' ||
    value.category !== expected[0] ||
    value.level !== expected[1] ||
    value.outcome !== expected[2] ||
    typeof value.appVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value.appVersion) ||
    typeof value.buildRevision !== 'string' ||
    !BUILD_REVISION_PATTERN.test(value.buildRevision) ||
    typeof value.eventId !== 'string' ||
    !UUID_V4_PATTERN.test(value.eventId) ||
    typeof value.runtimeInstanceId !== 'string' ||
    !UUID_V4_PATTERN.test(value.runtimeInstanceId) ||
    !canonicalTimestamp(value.timestamp)
  ) {
    throw new Error('targetOperationalLogInvalid');
  }
  return Object.freeze({
    appVersion: value.appVersion,
    buildRevision: value.buildRevision,
    eventId: value.eventId,
    eventName: value.eventName,
    runtimeInstanceId: value.runtimeInstanceId,
  });
}

export async function readDesktopLifecycleEvents(logDirectory) {
  let directory;
  try {
    directory = await lstat(logDirectory);
  } catch {
    throw new Error('targetOperationalLogInvalid');
  }
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error('targetOperationalLogInvalid');
  }
  let names;
  try {
    names = (await readdir(logDirectory)).filter((name) =>
      LOG_FILE_PATTERN.test(name),
    );
  } catch {
    throw new Error('targetOperationalLogInvalid');
  }
  names.sort();
  const events = [];
  const eventIds = new Set();
  for (const name of names) {
    const path = resolve(logDirectory, name);
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      metadata.size > 5n * 1024n * 1024n
    ) {
      throw new Error('targetOperationalLogInvalid');
    }
    const source = await readFile(path, 'utf8');
    const completeSource = source.endsWith('\n')
      ? source
      : source.slice(0, Math.max(0, source.lastIndexOf('\n') + 1));
    for (const line of completeSource.split('\n')) {
      if (line === '') continue;
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error('targetOperationalLogInvalid');
      }
      if (!isRecord(value) || typeof value.eventName !== 'string') {
        throw new Error('targetOperationalLogInvalid');
      }
      if (!RELEVANT_EVENTS.has(value.eventName)) continue;
      const event = validateRelevantEvent(value);
      if (eventIds.has(event.eventId)) {
        throw new Error('targetOperationalLogInvalid');
      }
      eventIds.add(event.eventId);
      events.push(event);
    }
  }
  return Object.freeze(events);
}

export async function captureDesktopLifecycleBaseline(logDirectory) {
  return Object.freeze(
    (await readDesktopLifecycleEvents(logDirectory)).map(
      (event) => event.eventId,
    ),
  );
}

function identityMatches(event, expected) {
  return (
    event.appVersion === expected.appVersion &&
    expected.buildRevision.startsWith(event.buildRevision)
  );
}

async function canonicalWatchDirectory(logDirectory) {
  try {
    const before = await lstat(logDirectory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new Error('targetOperationalLogInvalid');
    }
    const canonical = await realpath(logDirectory);
    const after = await lstat(canonical, { bigint: true });
    if (
      !after.isDirectory() || after.isSymbolicLink() ||
      before.dev !== after.dev || before.ino !== after.ino
    ) {
      throw new Error('targetOperationalLogInvalid');
    }
    return canonical;
  } catch {
    throw new Error('targetOperationalLogInvalid');
  }
}

export async function waitForTargetDesktopStarted({
  baselineEventIds,
  childCompletion,
  expectedIdentity,
  logDirectory,
}) {
  const baseline = new Set(baselineEventIds);
  // libuv's Windows watcher can abort the process when given an 8.3 alias.
  const watchDirectory = await canonicalWatchDirectory(logDirectory);
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
        const events = (await readDesktopLifecycleEvents(logDirectory)).filter(
          (event) => !baseline.has(event.eventId),
        );
        const matching = events.filter((event) =>
          identityMatches(event, expectedIdentity),
        );
        if (matching.some((event) => event.eventName === 'desktop.bootstrapFailed')) {
          settle(rejectPromise, new Error('targetBootstrapFailed'));
          return;
        }
        const started = matching.filter(
          (event) => event.eventName === 'desktop.started',
        );
        if (started.length > 1) {
          settle(rejectPromise, new Error('targetOperationalLogInvalid'));
          return;
        }
        if (started.length === 1) {
          settle(resolvePromise, started[0]);
        } else if (childExited) {
          settle(rejectPromise, new Error('targetApplicationExitedEarly'));
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
      watcher = watch(watchDirectory, { persistent: false }, () => void scan());
      watcher.once('error', () =>
        settle(rejectPromise, new Error('targetOperationalLogInvalid')),
      );
    } catch {
      settle(rejectPromise, new Error('targetOperationalLogInvalid'));
      return;
    }
    void scan();
    childCompletion.then(
      () => {
        childExited = true;
        void scan();
      },
      () => settle(rejectPromise, new Error('targetApplicationExitedEarly')),
    );
  });
}

export async function requireTargetShutdownCompleted({
  baselineEventIds,
  expectedIdentity,
  logDirectory,
  runtimeInstanceId,
}) {
  const baseline = new Set(baselineEventIds);
  const matching = (await readDesktopLifecycleEvents(logDirectory)).filter(
    (event) =>
      !baseline.has(event.eventId) &&
      identityMatches(event, expectedIdentity) &&
      event.runtimeInstanceId === runtimeInstanceId,
  );
  if (
    matching.some((event) => event.eventName === 'desktop.bootstrapFailed') ||
    matching.filter((event) => event.eventName === 'desktop.started').length !== 1 ||
    matching.filter((event) => event.eventName === 'desktop.shutdownCompleted')
      .length !== 1
  ) {
    throw new Error('targetShutdownEvidenceInvalid');
  }
}

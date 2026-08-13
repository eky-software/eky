const maxProgressBytes = 16 * 1024;
const maxProgressRecords = 16;
const maxDurationMs = 60 * 60 * 1000;

export const packagedUpdateRollbackEvents = Object.freeze([
  'started',
  'completed',
  'failed',
]);

export const packagedUpdateRollbackPhases = Object.freeze([
  'inputValidation',
  'launcherExitWait',
  'failedPackageUninstall',
  'rollbackPackageInstall',
  'failedPackageRepair',
]);

const eventSet = new Set(packagedUpdateRollbackEvents);
const phaseSet = new Set(packagedUpdateRollbackPhases);
const expectedRecordKeys = Object.freeze([
  'durationMs',
  'elapsedMs',
  'event',
  'phase',
]);

export function parsePackagedUpdateRollbackProgress(value) {
  const buffer = toBuffer(value);
  if (buffer.byteLength > maxProgressBytes) {
    throw new Error('PACKAGED_UPDATE_ROLLBACK_PROGRESS_SIZE_INVALID');
  }

  const text = buffer.toString('utf8');
  if (text.includes('\u0000') || text.includes('\ufffd')) {
    throw new Error('PACKAGED_UPDATE_ROLLBACK_PROGRESS_ENCODING_INVALID');
  }

  const lines = text.split(/\r?\n/u);
  if (!text.endsWith('\n')) {
    lines.pop();
  }
  const completeLines = lines.filter((line) => line.length > 0);
  if (completeLines.length > maxProgressRecords) {
    throw new Error('PACKAGED_UPDATE_ROLLBACK_PROGRESS_COUNT_INVALID');
  }

  return Object.freeze(completeLines.map(parseProgressLine));
}

export function createPackagedUpdateRollbackProgressTail({
  readProgress,
  reportProgress,
}) {
  requireFunction(readProgress);
  requireFunction(reportProgress);
  let reportedCount = 0;

  return Object.freeze({ poll });

  async function poll() {
    try {
      const records = parsePackagedUpdateRollbackProgress(
        await readProgress(),
      );
      if (records.length < reportedCount) {
        return;
      }
      for (const record of records.slice(reportedCount)) {
        try {
          reportProgress(record);
        } catch {
          // Test observability must never change the rollback result.
        }
      }
      reportedCount = records.length;
    } catch {
      // Missing, partial or invalid progress must not change the scenario.
    }
  }
}

function parseProgressLine(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('PACKAGED_UPDATE_ROLLBACK_PROGRESS_JSON_INVALID');
  }
  if (!isRecord(value)) {
    throw new Error('PACKAGED_UPDATE_ROLLBACK_PROGRESS_RECORD_INVALID');
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== expectedRecordKeys.length ||
    keys.some((key, index) => key !== expectedRecordKeys[index])
  ) {
    throw new Error('PACKAGED_UPDATE_ROLLBACK_PROGRESS_FIELDS_INVALID');
  }
  if (!eventSet.has(value.event)) {
    throw new Error('PACKAGED_UPDATE_ROLLBACK_PROGRESS_EVENT_INVALID');
  }
  if (!phaseSet.has(value.phase)) {
    throw new Error('PACKAGED_UPDATE_ROLLBACK_PROGRESS_PHASE_INVALID');
  }
  requireDuration(value.durationMs);
  requireDuration(value.elapsedMs);
  return Object.freeze({
    durationMs: value.durationMs,
    elapsedMs: value.elapsedMs,
    event: value.event,
    phase: value.phase,
  });
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return Buffer.from(value, 'utf8');
  }
  throw new Error('PACKAGED_UPDATE_ROLLBACK_PROGRESS_INPUT_INVALID');
}

function requireDuration(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maxDurationMs
  ) {
    throw new Error('PACKAGED_UPDATE_ROLLBACK_PROGRESS_DURATION_INVALID');
  }
}

function requireFunction(value) {
  if (typeof value !== 'function') {
    throw new Error('PACKAGED_UPDATE_ROLLBACK_PROGRESS_CALLBACK_INVALID');
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

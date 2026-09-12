import { lstat, open } from 'node:fs/promises';

const MAX_LOG_BYTES = 32 * 1024 * 1024;
const DAY = 86_400_000;
const ACTIONS = ['InstallValidate', 'InstallFiles', 'RemoveFiles', 'InstallExecute',
  'InstallFinalize', 'RemoveExistingProducts', 'ScheduleReboot', 'ForceReboot'];
const ORDERS = ['before', 'after', 'overlap', 'unknown'];
const empty = () => ({ status: 'unavailable', fileInUseObserved: false,
  scheduledDeletionObserved: false, replacedInUseFilesObserved: false,
  rebootPendingObserved: false, rebootAction: 'unknown',
  rebootVsCloseRequest: 'unknown', rebootVsExitObservation: 'unknown',
  msiCompletionVsExitObservation: 'unknown' });

export function validateRunningUpgradeObservation(value) {
  const template = empty();
  if (value === null) return null;
  if (!value || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join(',') !== Object.keys(template).sort().join(',') ||
      !['unavailable', 'observed'].includes(value.status) ||
      ![...ACTIONS, 'unknown'].includes(value.rebootAction) ||
      !['fileInUseObserved', 'scheduledDeletionObserved', 'replacedInUseFilesObserved',
        'rebootPendingObserved'].every(key => typeof value[key] === 'boolean') ||
      !['rebootVsCloseRequest', 'rebootVsExitObservation', 'msiCompletionVsExitObservation']
        .every(key => ORDERS.includes(value[key]))) throw new Error('runningUpgradeObservationInvalid');
  return Object.freeze({ ...value });
}

function order(interval, instant) {
  if (!interval || !interval.every(Number.isFinite) || interval[0] > interval[1] ||
      !Number.isFinite(instant)) return 'unknown';
  if (interval[1] < instant) return 'before';
  if (interval[0] > instant) return 'after';
  return 'overlap';
}

// MSI time-only records are compared on the same local day, including midnight wrap.
// An untimed Info record is an interval between its adjacent timed records, not an exact instant.
export function classifyRunningUpgradeLog(text, moments) {
  const result = empty();
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_LOG_BYTES ||
      !Number.isFinite(moments?.started) || !Number.isFinite(moments?.finished) ||
      moments.finished < moments.started || moments.finished - moments.started >= DAY / 2) return result;
  const day = new Date(moments.started);
  day.setHours(0, 0, 0, 0);
  let previousTime = null, rebootInterval = null, pendingReboot = false, action = 'unknown';
  let timedRecordObserved = false, chronologyValid = true;
  for (const line of text.split(/\r?\n/)) {
    const timestamp = /^MSI \([cs]\) \([^)]*\) \[(\d{2}):(\d{2}):(\d{2}):(\d{3})\]:/.exec(line);
    let time = null;
    if (timestamp) {
      const [, h, m, s, ms] = timestamp.map(Number);
      if (h < 24 && m < 60 && s < 60) {
        time = day.getTime() + h * 3_600_000 + m * 60_000 + s * 1000 + ms;
        if (time < moments.started) time += DAY;
        if (time > moments.finished) time = null;
      }
    }
    if (time !== null) {
      timedRecordObserved = true;
      if (previousTime !== null && time < previousTime) chronologyValid = false;
      if (pendingReboot) { rebootInterval[1] = time; pendingReboot = false; }
      previousTime = time;
    } else if (timestamp) chronologyValid = false;
    const nextAction = /(?:Doing action: |Action start \d{1,2}:\d{2}:\d{2}: )([A-Za-z]+)\.?\s*$/.exec(line)?.[1];
    if (nextAction) action = ACTIONS.includes(nextAction) ? nextAction : 'unknown';
    if (/\bInfo 1603\./.test(line) && /\bbeing held in use\b/.test(line)) result.fileInUseObserved = true;
    if (/\bReplacedInUseFiles\b.*(?:value is '1'|= 1)\s*\.?\s*$/.test(line)) result.replacedInUseFilesObserved = true;
    if (/\bMsiSystemRebootPending\b.*(?:value is '1'|= 1)\s*\.?\s*$/.test(line)) result.rebootPendingObserved = true;
    if (/\bInfo 1903\.\s*Scheduling reboot operation: Deleting file\b/.test(line)) {
      result.scheduledDeletionObserved = true;
      if (rebootInterval === null) {
        result.rebootAction = action;
        rebootInterval = time === null ? [previousTime ?? moments.started, moments.finished] : [time, time];
        pendingReboot = time === null;
      }
    }
  }
  if (!timedRecordObserved) return empty();
  result.status = 'observed';
  result.rebootVsCloseRequest = order(chronologyValid ? rebootInterval : null, moments.closeRequested);
  result.rebootVsExitObservation = order(chronologyValid ? rebootInterval : null, moments.applicationExitObserved);
  result.msiCompletionVsExitObservation = order(Number.isFinite(moments.msiCompleted)
    ? [moments.msiCompleted, moments.msiCompleted] : null, moments.applicationExitObserved);
  return validateRunningUpgradeObservation(result);
}

export async function readRunningUpgradeObservation(path, moments) {
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
        before.size < 1n || before.size > BigInt(MAX_LOG_BYTES)) return empty();
    handle = await open(path, 'r');
    const actual = await handle.stat({ bigint: true });
    if (actual.ino !== before.ino || actual.dev !== before.dev || actual.nlink !== 1n || actual.size !== before.size) return empty();
    const bytes = Buffer.alloc(Number(actual.size) + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat({ bigint: true });
    if (bytesRead !== Number(actual.size) || after.size !== actual.size || after.mtimeNs !== actual.mtimeNs) return empty();
    const content = bytes.subarray(0, bytesRead);
    const text = content[0] === 0xff && content[1] === 0xfe
      ? content.subarray(2).toString('utf16le') : content.toString('utf8');
    return classifyRunningUpgradeLog(text, moments);
  } catch { return empty(); }
  finally { await handle?.close().catch(() => undefined); }
}

export const initDiagnosticLimit = 128;
export const initDiagnosticPrefix = 'EKY_T3CL_INIT_FAILURE_V1';

const initPhases = [
  'context', 'arguments', 'deadline', 'pid', 'identity', 'statusRead',
  'statusValidation', 'responseOpen', 'controlSetup', 'readyWrite', 'awaitGo',
];
const initCauses = [
  'invalidContext', 'invalidArguments', 'deadlineExceeded', 'invalidIdentity',
  'invalidStatus', 'invalidMessage', 'channelFailed', 'channelLimit',
  'unexpectedEof', 'experimentFailed', 'statusReadFailed', 'statusMalformed',
  'statusPidMismatch', 'statusIdentityMismatch', 'statusCapabilities',
];

export function createInitFailureReporter(writeLine) {
  let attempted = false;
  return function report(phase, cause) {
    if (attempted) return;
    attempted = true;
    try {
      if (!initPhases.includes(phase) || !initCauses.includes(cause)) return;
      const line = `${initDiagnosticPrefix} ${phase} ${cause}\n`;
      if (line.length > initDiagnosticLimit) return;
      writeLine(line, () => {});
    } catch { /* Best effort only; diagnostics never retry or delay termination. */ }
  };
}

export function parseInitDiagnostic(stderr, unavailable = false) {
  const empty = state => ({ state, phase: null, cause: null });
  if (unavailable || typeof stderr !== 'string') return empty('unavailable');
  if (!stderr.includes(initDiagnosticPrefix)) return empty('absent');
  if (stderr.length > initDiagnosticLimit || /[^\x00-\x7f]/u.test(stderr)) return empty('invalid');
  const fields = stderr.slice(0, -1).split(' ');
  const [prefix, phase, cause] = fields;
  if (fields.length !== 3 || prefix !== initDiagnosticPrefix ||
      !initPhases.includes(phase) || !initCauses.includes(cause) ||
      stderr !== `${initDiagnosticPrefix} ${phase} ${cause}\n`) return empty('invalid');
  return { state: 'valid', phase, cause };
}

// Whole-buffer literals only. These observations never authorize prerequisite absence.
const unshareStderrClasses = new Map([
  ['unshare: mount /proc failed: Operation not permitted\n', 'unshareMountProcDenied'],
  ['unshare: mount /proc failed: Permission denied\n', 'unshareMountProcDenied'],
  ['unshare: cannot change root filesystem propagation: Operation not permitted\n', 'unsharePropagationDenied'],
  ['unshare: cannot change root filesystem propagation: Permission denied\n', 'unsharePropagationDenied'],
  ['unshare: write failed /proc/self/uid_map: Operation not permitted\n', 'unshareUidMapDenied'],
  ['unshare: write failed /proc/self/uid_map: Permission denied\n', 'unshareUidMapDenied'],
  ['unshare: write failed /proc/self/gid_map: Operation not permitted\n', 'unshareGidMapDenied'],
  ['unshare: write failed /proc/self/gid_map: Permission denied\n', 'unshareGidMapDenied'],
  ['unshare: write failed /proc/self/setgroups: Operation not permitted\n', 'unshareSetgroupsDenied'],
  ['unshare: write failed /proc/self/setgroups: Permission denied\n', 'unshareSetgroupsDenied'],
  ['unshare: unshare failed: Permission denied\n', 'unshareCreatePermissionDenied'],
  ["unshare: unrecognized option '--map-current-user'\nTry 'unshare --help' for more information.\n",
    'unshareMapCurrentUserUnsupported'],
]);

function stderrClass(snapshot, unreadable) {
  if (unreadable) return 'unreadableOrOverLimit';
  if (snapshot.stderr === '') return 'empty';
  if (snapshot.stderr === 'unshare: unshare failed: Operation not permitted\n') return 'exactUnshareDenied';
  if (snapshot.wrapper?.closed !== true || snapshot.stderrEnded !== true ||
      snapshot.readyAccepted !== false || snapshot.goAttempted !== false) return 'other';
  return unshareStderrClasses.get(snapshot.stderr) ?? 'other';
}

const diagnosticEnums = {
  wrapperTerminal: ['notObserved', 'spawnFailed', 'exit0', 'exit1', 'exit41', 'exit42', 'otherExit', 'signaled'],
  stderrClass: ['empty', 'exactUnshareDenied', 'other', 'unreadableOrOverLimit',
    ...new Set(unshareStderrClasses.values())],
  responseBytes: ['none', 'present'],
  spawnClass: ['none', 'enoent', 'other'],
  toolAbsence: ['notChecked', 'provenAbsent', 'notProven'],
  initDiagnostic: ['absent', 'valid', 'invalid', 'unavailable'],
};
const diagnosticBooleans = [
  'wrapperClosed', 'stderrEnded', 'stderrFailed', 'responseEnded', 'readyAccepted',
  'goAttempted', 'emergencyUsed', 'readyBudgetExpired', 'classificationAttempted',
];
const diagnosticFields = [
  'bootstrapCause', ...Object.keys(diagnosticEnums), ...diagnosticBooleans, 'initPhase', 'initCause',
];

function wrapperTerminal(wrapper) {
  if (!wrapper) return 'notObserved';
  if (wrapper.spawnCode) return 'spawnFailed';
  if (!wrapper.exited && !wrapper.closed) return 'notObserved';
  if (wrapper.signal) return 'signaled';
  switch (wrapper.code) {
    case 0: return 'exit0';
    case 1: return 'exit1';
    case 41: return 'exit41';
    case 42: return 'exit42';
    default: return 'otherExit';
  }
}

export function captureBootstrapDiagnostic(snapshot) {
  // The caller supplies a safe bootstrap reason and enforces its existing stderr cap.
  // This projection never probes, waits, changes classification or retains raw data.
  const { wrapper, replies, stderr } = snapshot;
  const unreadable = snapshot.stderrFailed === true || typeof stderr !== 'string';
  const init = parseInitDiagnostic(stderr, unreadable);
  return {
    bootstrapCause: snapshot.bootstrapCause,
    wrapperTerminal: wrapperTerminal(wrapper),
    stderrClass: stderrClass(snapshot, unreadable),
    wrapperClosed: wrapper?.closed === true,
    stderrEnded: snapshot.stderrEnded === true,
    stderrFailed: snapshot.stderrFailed === true,
    responseEnded: replies?.ended === true,
    responseBytes: replies?.receivedBytes > 0 ? 'present' : 'none',
    spawnClass: !wrapper?.spawnCode ? 'none' : wrapper.spawnCode === 'ENOENT' ? 'enoent' : 'other',
    toolAbsence: snapshot.toolAbsence,
    readyAccepted: snapshot.readyAccepted === true,
    goAttempted: snapshot.goAttempted === true,
    emergencyUsed: snapshot.emergencyUsed === true,
    readyBudgetExpired: snapshot.readyBudgetExpired === true,
    classificationAttempted: snapshot.classificationAttempted === true,
    initDiagnostic: init.state,
    initPhase: init.phase,
    initCause: init.cause,
  };
}

export function validateBootstrapDiagnostic(value, isReason) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== diagnosticFields.length ||
        !diagnosticFields.every(key => Object.hasOwn(descriptors, key) &&
          Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable)) return false;
    // Read only the checked data descriptors, including across the caller's predicate.
    const fields = Object.fromEntries(diagnosticFields.map(key => [key, descriptors[key].value]));
    if (typeof fields.bootstrapCause !== 'string' || typeof isReason !== 'function' ||
        isReason(fields.bootstrapCause) !== true) return false;
    if (!Object.entries(diagnosticEnums).every(([key, values]) => values.includes(fields[key])) ||
        !diagnosticBooleans.every(key => typeof fields[key] === 'boolean')) return false;
    return fields.initDiagnostic === 'valid'
      ? initPhases.includes(fields.initPhase) && initCauses.includes(fields.initCause)
      : fields.initPhase === null && fields.initCause === null;
  } catch { return false; }
}

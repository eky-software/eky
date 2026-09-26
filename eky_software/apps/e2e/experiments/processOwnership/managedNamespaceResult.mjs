import { types } from 'node:util';
import { validEvidenceBinding } from './linuxPrerequisiteContract.mjs';
import { exactKeys, limits, NamespaceFailure } from './pidNamespaceContract.mjs';

// Keep the inner session's existing classification unchanged when sharing it.
export const managedSessionFailureReasons = Object.freeze([
  'invalidContext', 'invalidIdentity', 'invalidArguments', 'invalidMessage', 'rootFailed', 'sentinelFailed',
  'channelFailed', 'channelLimit', 'unexpectedEof', 'deadlineExceeded', 'cleanupUnverified',
  'metadataInvalid', 'metadataReadFailed', 'cgroupV2Unverified', 'spawnFailed', 'processError',
  'exitFailed', 'terminalIncomplete', 'streamMissing', 'streamError', 'streamIncomplete',
  'streamInvalid', 'outputLimit', 'stderrNotEmpty', 'outputInvalid', 'observationInvalid',
]);
const reasons = [...managedSessionFailureReasons, 'notLinux', 'experimentFailed', 'reportFailed',
  'workloadFailed', 'invalidStatus', 'unverified'];
const sessionStages = ['configuration', 'metadata', 'manager', 'policy', 'control', 'launch',
  'ready', 'ownership', 'go', 'workload', 'controlClose', 'wrapper', 'finalize'];
const cleanupStages = ['stop', 'commandDrain'];
const stages = [...sessionStages, ...cleanupStages, 'context', 'root', 'sentinelStart',
  'sentinelBefore', 'sentinelAfter', 'sentinelStop', 'rootRemoval', 'report', 'session'];
const bindingKeys = ['consumer', 'checkoutSha', 'runId', 'runAttempt'];
const phaseKeys = ['metadata', 'manager', 'policies', 'launchAttempted', 'launchAccepted',
  'ready', 'owned', 'go', 'workload', 'controlClosed'];
const factKeys = [...phaseKeys, 'waitingWrapper', 'stop', 'commandsClosed'];
const sessionKeys = ['outcome', 'failure', 'cleanupFailure', 'facts'];
const sentinelKeys = ['started', 'before', 'after', 'closed', 'normalExit'];
const stateKeys = ['session', 'failure', 'cleanupFailure', 'root', 'sentinel'];
const resultKeys = ['schemaVersion', 'evidence', ...bindingKeys, ...stateKeys,
  'namespaceOutcome', 'evidenceOutcome'];
const schemaVersion = 1;
const evidence = 'boundedManagedPidNamespaceOnly';

function requireResult(condition) {
  if (!condition) throw new NamespaceFailure('reportFailed');
}

function copyRecord(value, keys) {
  requireResult(!types.isProxy(value) && exactKeys(value, keys));
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

export function managedFailure(stage, error) {
  let reason;
  try {
    if (error !== null && typeof error === 'object' && !types.isProxy(error)) {
      reason = Object.getOwnPropertyDescriptor(error, 'reason')?.value;
    }
  } catch { /* Unknown failures never carry their original diagnostic content. */ }
  return Object.freeze({ stage: stages.includes(stage) ? stage : 'session',
    reason: reasons.includes(reason) ? reason : 'unverified' });
}

function copyFailure(value, allowedStages = stages) {
  if (value === null) return null;
  const failure = copyRecord(value, ['stage', 'reason']);
  requireResult(allowedStages.includes(failure.stage) && reasons.includes(failure.reason));
  return Object.freeze(failure);
}

function copySession(value) {
  const session = copyRecord(value, sessionKeys);
  session.failure = copyFailure(session.failure, sessionStages);
  session.cleanupFailure = copyFailure(session.cleanupFailure, cleanupStages);
  const facts = copyRecord(session.facts, factKeys);
  requireResult([...phaseKeys, 'commandsClosed'].every(key => typeof facts[key] === 'boolean'));
  requireResult(['unverified', 'normalExit'].includes(facts.waitingWrapper));
  requireResult(['notRequested', 'unverified', 'commandAccepted'].includes(facts.stop));
  for (let index = 1; index < phaseKeys.length; index++) {
    requireResult(!facts[phaseKeys[index]] || facts[phaseKeys[index - 1]]);
  }
  requireResult(facts.waitingWrapper !== 'normalExit' || facts.controlClosed);
  requireResult(facts.stop === 'notRequested' || (facts.owned && session.failure !== null));
  requireResult(facts.commandsClosed || session.cleanupFailure !== null);
  requireResult(facts.stop !== 'unverified' || session.cleanupFailure?.stage === 'stop');
  requireResult(session.cleanupFailure?.stage !== 'stop' || facts.stop === 'unverified');
  requireResult(['observed', 'unverified'].includes(session.outcome));
  if (session.outcome === 'observed') {
    requireResult(session.failure === null && session.cleanupFailure === null &&
      phaseKeys.every(key => facts[key]) && facts.commandsClosed &&
      facts.waitingWrapper === 'normalExit' && facts.stop === 'notRequested');
  } else {
    // A stop acknowledgement or late normal exit never erases the first failure.
    requireResult(session.failure !== null);
  }
  session.facts = Object.freeze(facts);
  return Object.freeze(session);
}

export function validateManagedSessionResult(value) {
  try { return copySession(value); }
  catch { throw new NamespaceFailure('reportFailed'); }
}

function copyState(value, unbound) {
  const state = copyRecord(value, stateKeys);
  state.session = state.session === null ? null : copySession(state.session);
  state.failure = copyFailure(state.failure);
  state.cleanupFailure = copyFailure(state.cleanupFailure);
  if (state.session?.failure) {
    const original = state.session.failure;
    // Unbound reports carry invalidContext outside, retaining the original
    // session failure inside. Bound reports must preserve it in both places.
    requireResult((state.failure?.stage === original.stage && state.failure.reason === original.reason) ||
      (unbound && state.failure?.stage === 'context' && state.failure.reason === 'invalidContext'));
  }
  requireResult(['notCreated', 'retained', 'removalUnverified', 'removed'].includes(state.root));
  const sentinel = copyRecord(state.sentinel, sentinelKeys);
  requireResult(sentinelKeys.every(key => typeof sentinel[key] === 'boolean'));
  requireResult((!sentinel.before && !sentinel.after && !sentinel.closed) || sentinel.started);
  requireResult(!sentinel.normalExit || sentinel.closed);
  state.sentinel = Object.freeze(sentinel);
  requireResult(state.root !== 'notCreated' || (state.session === null && !sentinel.started));
  if (['removed', 'removalUnverified'].includes(state.root)) {
    requireResult(state.session?.outcome === 'observed' && sentinelKeys.every(key => sentinel[key]) &&
      state.cleanupFailure === null);
  }
  return state;
}

function copyBinding(value) {
  if (types.isProxy(value) || !validEvidenceBinding(value)) return null;
  return copyRecord(value, bindingKeys);
}

function resultFromState(binding, state) {
  // An outer deadline can publish while the inner session is still pending.
  // Once the sentinel has started, a missing session is not proof of no launch.
  const namespaceOutcome = state.session?.outcome === 'observed' ? 'destroyed' :
    state.session === null ? (state.sentinel.started ? 'unverified' : 'notStarted') :
      state.session.facts.launchAttempted ? 'unverified' : 'notStarted';
  const complete = binding !== null && state.session?.outcome === 'observed' &&
    sentinelKeys.every(key => state.sentinel[key]) && state.root === 'removed' &&
    state.failure === null && state.cleanupFailure === null;
  return Object.freeze({ schemaVersion, evidence,
    consumer: binding?.consumer ?? null, checkoutSha: binding?.checkoutSha ?? null,
    runId: binding?.runId ?? null, runAttempt: binding?.runAttempt ?? null,
    session: state.session, failure: binding === null ? managedFailure('context', { reason: 'invalidContext' }) : state.failure,
    cleanupFailure: state.cleanupFailure, root: state.root, sentinel: state.sentinel,
    namespaceOutcome, evidenceOutcome: complete ? 'complete' : 'incomplete' });
}

export function createManagedResult(binding, state) {
  try {
    const context = copyBinding(binding);
    return resultFromState(context, copyState(state, context === null));
  }
  catch { throw new NamespaceFailure('reportFailed'); }
}

export function serializeManagedResult(value, binding) {
  try {
    const result = copyRecord(value, resultKeys);
    const expected = copyBinding(binding);
    requireResult(result.schemaVersion === schemaVersion && result.evidence === evidence);
    requireResult(bindingKeys.every(key => result[key] === (expected?.[key] ?? null)));
    const state = copyState(Object.fromEntries(stateKeys.map(key => [key, result[key]])), expected === null);
    const canonical = resultFromState(expected, state);
    requireResult(result.namespaceOutcome === canonical.namespaceOutcome &&
      result.evidenceOutcome === canonical.evidenceOutcome);
    if (expected === null) {
      requireResult(result.failure?.stage === 'context' && result.failure.reason === 'invalidContext');
    }
    const line = `${JSON.stringify(canonical)}\n`;
    requireResult(Buffer.byteLength(line, 'utf8') <= limits.result);
    return line;
  } catch { throw new NamespaceFailure('reportFailed'); }
}

export function parseManagedResult(line, binding) {
  try {
    requireResult(typeof line === 'string' && line.length <= limits.result &&
      Buffer.byteLength(line, 'utf8') <= limits.result && line.endsWith('\n'));
    const body = line.slice(0, -1);
    requireResult(body.length > 0 && !/[\n\r\0\uFFFD]/u.test(body));
    const value = JSON.parse(body);
    // Compare with the writer, not JSON.parse alone: duplicates, reordered keys,
    // alternate encodings, whitespace and trailing bytes are not canonical.
    requireResult(serializeManagedResult(value, binding) === line);
    return createManagedResult(binding, Object.fromEntries(stateKeys.map(key => [key, value[key]])));
  } catch { throw new NamespaceFailure('reportFailed'); }
}

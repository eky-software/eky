import { managedSessionFailureReasons } from './managedNamespaceResult.mjs';

export const linuxServiceDiagnosticPrefix = 'EKY_LINUX_SERVICE_FAILURE ';
const maximumLineLength = 512;
const phases = new Set(['prepare', 'preflight', 'managerPrepare', 'controlListen',
  'managerLaunch', 'controlReady', 'managerOwn', 'workloadStart']);
const reasons = new Set(['preparationFailed', 'startupDeadlineExceeded', 'launchFailed',
  'workloadExited', 'observationLost']);
const causeReasons = new Set([...managedSessionFailureReasons, ...reasons, 'unverified']);
const causeStages = new Set(['context', 'tools', 'manager', 'cgroup', 'unverified']);

export function projectLinuxServiceCause(error) {
  let reason;
  let stage;
  try {
    reason = Object.getOwnPropertyDescriptor(error, 'reason')?.value;
    stage = Object.getOwnPropertyDescriptor(error, 'stage')?.value;
  } catch { /* Unknown failures do not expose their raw content. */ }
  return { causeReason: causeReasons.has(reason) ? reason : 'unverified',
    causeStage: causeStages.has(stage) ? stage : 'unverified' };
}

export function encodeLinuxServiceDiagnostic(value) {
  if (!value || Object.keys(value).sort().join(',') !==
    'causeReason,causeStage,phase,processTree,profile,schemaVersion,spawnObserved,startupFailure' ||
    value.schemaVersion !== 1 || !['backend', 'vite', 'chromium'].includes(value.profile) ||
    !phases.has(value.phase) || !reasons.has(value.startupFailure) ||
    !causeReasons.has(value.causeReason) || !causeStages.has(value.causeStage) ||
    typeof value.spawnObserved !== 'boolean' || !['stopped', 'unverified'].includes(value.processTree)) {
    throw new Error('E2E_LINUX_SERVICE_DIAGNOSTIC_INVALID');
  }
  return linuxServiceDiagnosticPrefix + JSON.stringify({ schemaVersion: 1,
    profile: value.profile, phase: value.phase, startupFailure: value.startupFailure,
    causeReason: value.causeReason, causeStage: value.causeStage,
    spawnObserved: value.spawnObserved, processTree: value.processTree }) + '\n';
}

// The reporter may receive partial or combined public stdout chunks. Drop
// arbitrary output and oversized lines without retaining raw diagnostics.
export function createLinuxServiceDiagnosticRelay(emit) {
  let pending = '';
  let discarding = false;
  return chunk => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    if (typeof text !== 'string') return;
    for (const character of text) {
      if (character !== '\n') {
        if (!discarding) {
          pending += character;
          if (pending.length > maximumLineLength) { pending = ''; discarding = true; }
        }
        continue;
      }
      const line = pending;
      pending = '';
      const dropped = discarding;
      discarding = false;
      if (dropped || !line.startsWith(linuxServiceDiagnosticPrefix)) continue;
      try {
        const safe = encodeLinuxServiceDiagnostic(JSON.parse(line.slice(linuxServiceDiagnosticPrefix.length)));
        emit(safe);
      } catch { /* Unknown, malformed or extended records remain private. */ }
    }
  };
}

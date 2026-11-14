import { managedSessionFailureReasons } from './managedNamespaceResult.mjs';

export const linuxServiceDiagnosticPrefix = 'EKY_LINUX_SERVICE_FAILURE ';
const phases = new Set(['prepare', 'preflight', 'managerPrepare', 'controlListen',
  'managerLaunch', 'controlReady', 'managerOwn', 'workloadStart']);
const reasons = new Set(['preparationFailed', 'startupDeadlineExceeded', 'launchFailed',
  'workloadExited', 'observationLost']);
const causeReasons = new Set([...managedSessionFailureReasons, ...reasons, 'unverified']);
const causeStages = new Set(['context', 'tools', 'manager', 'cgroup', 'unverified']);

export function linuxPreflightPrivateCheck(value) {
  return typeof value === 'string' && /^MANAGED_NAMESPACE_PREFLIGHT_CHECK:(sudo|manager|control|environment|namespace|credentials):(tool|ancestor):(symbolicLink|entryKind|rootOwner|modeRange|writePermissions|specialBits|deviceIdentity|inodeIdentity|canonicalPath|executable)$/u.test(value)
    ? value : undefined;
}

// Read only fixed technical text, never raw errors, getters or host metadata.
export function readLinuxServicePreflightCheck(error) {
  try {
    for (let depth = 0; depth < 3 && error !== null && typeof error === 'object'; depth++) {
      const check = linuxPreflightPrivateCheck(Object.getOwnPropertyDescriptor(error, 'message')?.value);
      if (check !== undefined) return check;
      error = Object.getOwnPropertyDescriptor(error, 'cause')?.value;
    }
  } catch { /* Optional private evidence cannot change startup or cleanup. */ }
  return undefined;
}

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
    value.schemaVersion !== 1 || !['backend', 'vite', 'chromium', 'profileInspection'].includes(value.profile) ||
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

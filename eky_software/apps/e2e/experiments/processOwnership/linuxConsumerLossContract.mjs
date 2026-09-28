import { exactKeys, failureExit, isNonce } from './pidNamespaceContract.mjs';
import { captureRunningUnit, verifyOwnedUnitObservation } from './managedNamespaceUnitContract.mjs';

const backendProfiles = Object.freeze(['backend']);
const webProfiles = Object.freeze(['chromium', 'backend', 'vite']);
// Only a validated, deliberately executed owner fault uses this exit code.
// Real init/control failures remain 42 and normal requested stops remain 41.
export const ownerLossExit = 43;
export const linuxConsumerPhases = Object.freeze(['context', 'setup', 'backendStart', 'viteStart', 'chromiumStart',
  'readiness', 'faultGrant', 'fault', 'lossObservation', 'consumerRefusal', 'fixtureTeardown',
  'replacementRefusal', 'commandsClose', 'outcome', 'report']);
export const linuxConsumerLossCases = Object.freeze([
  ...['backend', 'vite', 'chromium'].flatMap(profile => ['owner', 'control'].map(cause =>
    Object.freeze({ id: `${profile}-${cause}`, profile, cause,
      profiles: profile === 'backend' ? backendProfiles : webProfiles }))),
  Object.freeze({ id: 'caller', profile: null, cause: 'caller', profiles: webProfiles }),
]);

export function requireConsumerLoss(condition) {
  if (!condition) throw new Error('E2E_LINUX_CONSUMER_LOSS_UNVERIFIED');
}

export function consumerLossCase(id) {
  const selected = linuxConsumerLossCases.find(value => value.id === id);
  requireConsumerLoss(selected !== undefined);
  return selected;
}

export function validateConsumerLossArm(value, caseId, profile, generation) {
  const selected = consumerLossCase(caseId);
  requireConsumerLoss(exactKeys(value, ['caseId', 'profile', 'generation', 'cause']) &&
    selected.profiles.includes(profile) && (selected.profile === null || selected.profile === profile) &&
    isNonce(generation) && value.caseId === caseId && value.profile === profile &&
    value.generation === generation && value.cause === selected.cause);
  return value;
}

// This is only the armed experiment's waiting-wrapper observation. The caller
// must separately bind the known init launch, command close and passive ordering.
// Normal service cleanup continues to require its unchanged exit-41 receipt.
export function observeConsumerLossExit(observation, receipt, arm) {
  requireConsumerLoss(exactKeys(arm, ['caseId', 'profile', 'generation', 'cause']));
  validateConsumerLossArm(arm, arm?.caseId, arm?.profile, receipt?.generation);
  const value = verifyOwnedUnitObservation(observation, receipt);
  if (value.ActiveState === 'active') {
    captureRunningUnit(value, receipt.generation);
    return Object.freeze({ waitingWrapper: 'pending' });
  }
  if (value.ActiveState === 'deactivating') return Object.freeze({ waitingWrapper: 'pending' });
  const exited = value.ExecMainExitTimestampMonotonic;
  requireConsumerLoss(value.ActiveState === 'failed' && value.SubState === 'failed' &&
    value.Result === 'exit-code' && value.MainPID === '0' && value.ControlPID === '0' &&
    value.ExecMainCode === '1' && value.ExecMainStatus === String(arm.cause === 'owner' ? ownerLossExit : failureExit) &&
    /^[1-9][0-9]*$/u.test(exited) && BigInt(exited) >= BigInt(receipt.started));
  return Object.freeze({ generation: receipt.generation, waitingWrapper: 'armedFailureExit' });
}

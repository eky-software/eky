import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import {
  LEGACY_PROCESS_OBSERVATIONS, LEGACY_RUNTIME_PROCESS_ROLES,
  LEGACY_WORKER_OBSERVATION_OPERATION, LEGACY_WORKER_OBSERVATION_PHASES,
} from './legacyUpgradeContracts.mjs';

export const WORKSPACE_PHASE_MAX_BYTES = 512;
const KEYS = ['schemaVersion', 'operation', 'scenario', 'phase', 'status', 'durationMs', 'elapsedMs'];
const SCENARIOS = new Set(['packagedWorkspaceSuccess', 'packagedWorkspaceFaultRollback']);
const PHASES = new Set([
  'supervisorExit', 'supervisorClose', 'supervisorResult', 'scenarioResult',
  'initialProductState', 'semanticPostcondition', 'sessionPostcondition',
  'installationCleanup', 'finalProductState', 'removalPostcondition',
  'sourceProductInspection', 'targetProductInspection', 'sourceProductUninstall', 'targetProductUninstall',
  'productChannelSetup', 'productSupervisorWait', 'productSupervisorExit', 'productSupervisorClose', 'productChannelCleanup',
  'productHostLaunch', 'productHostSpawn', 'productHostDeadline', 'productHostTermination',
  'artifactVerification', 'normalProfileVerification', 'fixtureCleanup', 'callerTerminal',
]);
const STATUSES = new Set(['started', 'completed', 'failed']);

function requireObservation(input) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new Error('WINDOWS_ACCEPTANCE_PHASE_OBSERVATION_INVALID');
  }
  const properties = Object.getOwnPropertyDescriptors(input);
  const keys = Object.hasOwn(properties, 'resultCode') ? [...KEYS, 'resultCode'] : KEYS;
  if (Reflect.ownKeys(properties).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(properties, key) || !Object.hasOwn(properties[key], 'value'))) {
    throw new Error('WINDOWS_ACCEPTANCE_PHASE_OBSERVATION_INVALID');
  }
  const value = Object.fromEntries(keys.map((key) => [key, properties[key].value]));
  const worker = value.operation === LEGACY_WORKER_OBSERVATION_OPERATION;
  const identityValid = worker
    ? value.scenario === 'historicalLegacyUpgrade' && LEGACY_WORKER_OBSERVATION_PHASES.includes(value.phase) &&
      (!Object.hasOwn(value, 'resultCode') || LEGACY_RUNTIME_PROCESS_ROLES.includes(value.phase) &&
        LEGACY_PROCESS_OBSERVATIONS.includes(value.resultCode))
    : !Object.hasOwn(value, 'resultCode') && PHASES.has(value.phase) &&
      (value.operation === 'workspaceAcceptanceCaller' && SCENARIOS.has(value.scenario) ||
        value.operation === 'legacyAcceptanceCaller' && value.scenario === 'historicalLegacyUpgrade');
  if (
    value.schemaVersion !== 1 ||
    !identityValid || !STATUSES.has(value.status) ||
    !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 ||
    !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0) {
    throw new Error('WINDOWS_ACCEPTANCE_PHASE_OBSERVATION_INVALID');
  }
  return Object.freeze(value);
}

export function encodeWorkspacePhaseObservation(value) {
  const bytes = Buffer.from(JSON.stringify(requireObservation(value)) + '\n', 'utf8');
  if (bytes.length > WORKSPACE_PHASE_MAX_BYTES) {
    throw new Error('WINDOWS_ACCEPTANCE_PHASE_OBSERVATION_INVALID');
  }
  return bytes;
}

export function parseWorkspacePhaseObservation(bytes) {
  return requireObservation(parseStrictJsonObjectBytes(bytes, {
    maximumBytes: WORKSPACE_PHASE_MAX_BYTES,
    errorCode: 'WINDOWS_ACCEPTANCE_PHASE_OBSERVATION_INVALID',
  }));
}

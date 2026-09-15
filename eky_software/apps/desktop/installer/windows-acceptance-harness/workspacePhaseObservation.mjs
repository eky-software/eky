import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

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
  if (Reflect.ownKeys(properties).length !== KEYS.length ||
    KEYS.some((key) => !Object.hasOwn(properties, key) || !Object.hasOwn(properties[key], 'value'))) {
    throw new Error('WINDOWS_ACCEPTANCE_PHASE_OBSERVATION_INVALID');
  }
  const value = Object.fromEntries(KEYS.map((key) => [key, properties[key].value]));
  if (
    value.schemaVersion !== 1 ||
    !(value.operation === 'workspaceAcceptanceCaller' && SCENARIOS.has(value.scenario) ||
      value.operation === 'legacyAcceptanceCaller' && value.scenario === 'historicalLegacyUpgrade') ||
    !PHASES.has(value.phase) || !STATUSES.has(value.status) ||
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

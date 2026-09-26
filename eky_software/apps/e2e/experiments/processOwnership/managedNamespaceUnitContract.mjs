import { exactKeys, isNonce, expectedEofExit } from './pidNamespaceContract.mjs';

export const unitObservationLimit = 8192;
export const managedUnitProperties = Object.freeze({
  Type: 'exec', ExitType: 'main', KillMode: 'control-group', Restart: 'no',
  RemainAfterExit: 'no', CollectMode: 'inactive', NoNewPrivileges: 'yes', ProtectControlGroups: 'yes',
  User: 'root', Group: 'root',
});
const observationKeys = Object.freeze([
  'Id', 'InvocationID', 'LoadState', 'Transient', 'ActiveState', 'SubState',
  'Result', 'MainPID', 'ControlPID', 'ControlGroup', 'ExecMainCode', 'ExecMainStatus',
  'ExecMainStartTimestampMonotonic', 'ExecMainExitTimestampMonotonic',
  ...Object.keys(managedUnitProperties),
]);
export const unitObservationArguments = Object.freeze([
  'show', '--no-pager', '--all', `--property=${observationKeys.join(',')}`,
]);

function requireUnit(condition) {
  if (!condition) throw new Error('Managed namespace unit observation unverified');
}

export function managedUnitName(generation) {
  requireUnit(isNonce(generation));
  return `eky-e2e-${generation}.service`;
}

function decimal(value, nonzero = false) {
  return typeof value === 'string' && value.length <= 20 &&
    /^(?:0|[1-9][0-9]*)$/u.test(value) && !/[^0-9]/u.test(value) &&
    (!nonzero || value !== '0') && BigInt(value) <= 18446744073709551615n;
}

// The adapter must supply ONLY a complete, bounded, successfully closed
// systemctl response. Raw manager output stays private and never grants GO.
export function parseUnitObservation(text, generation) {
  const unit = managedUnitName(generation);
  requireUnit(typeof text === 'string' && Buffer.byteLength(text) < unitObservationLimit &&
    text.endsWith('\n') && !/[\0\r\uFFFD]/u.test(text));
  const properties = Object.create(null);
  for (const line of text.slice(0, -1).split('\n')) {
    const separator = line.indexOf('=');
    requireUnit(separator > 0);
    const key = line.slice(0, separator);
    requireUnit(observationKeys.includes(key) && !Object.hasOwn(properties, key));
    properties[key] = line.slice(separator + 1);
  }
  requireUnit(exactKeys(properties, observationKeys) && properties.Id === unit &&
    isNonce(properties.InvocationID) && properties.LoadState === 'loaded' && properties.Transient === 'yes');
  for (const [name, value] of Object.entries(managedUnitProperties)) requireUnit(properties[name] === value);
  for (const name of ['MainPID', 'ControlPID', 'ExecMainCode', 'ExecMainStatus',
    'ExecMainStartTimestampMonotonic', 'ExecMainExitTimestampMonotonic']) requireUnit(decimal(properties[name]));
  requireUnit(properties.ControlGroup === '' || properties.ControlGroup === `/system.slice/${unit}`);
  return Object.freeze(properties);
}

function validateObservation(observation, generation) {
  requireUnit(exactKeys(observation, observationKeys));
  // Revalidate even caller-created objects. Do not invoke accessors or coerce values.
  for (const key of observationKeys) requireUnit(typeof observation[key] === 'string');
  return parseUnitObservation(observationKeys.map(key => `${key}=${observation[key]}\n`).join(''), generation);
}

export function captureRunningUnit(observation, generation) {
  const value = validateObservation(observation, generation);
  requireUnit(value.ActiveState === 'active' && value.SubState === 'running' && value.Result === 'success' &&
    decimal(value.MainPID, true) && value.ControlPID === '0' &&
    value.ControlGroup === `/system.slice/${value.Id}` && value.ExecMainCode === '0' && value.ExecMainStatus === '0' &&
    decimal(value.ExecMainStartTimestampMonotonic, true) && value.ExecMainExitTimestampMonotonic === '0');
  return Object.freeze({ generation, unit: value.Id, invocation: value.InvocationID,
    started: value.ExecMainStartTimestampMonotonic });
}

function validateReceipt(receipt) {
  requireUnit(exactKeys(receipt, ['generation', 'unit', 'invocation', 'started']));
  requireUnit(receipt.unit === managedUnitName(receipt.generation) && isNonce(receipt.invocation) &&
    decimal(receipt.started, true));
}

// This proves ONLY the normal exit of the previously observed waiting wrapper.
// The intentional protocol exit 41 is NOT a systemd success code. A failed
// unit retains evidence without RemainAfterExit keeping descendants alive after
// a clean signal. Protocol/deadline/sentinel/root-cleanup gates remain separate.
export function verifyWaitingWrapperExit(observation, receipt) {
  validateReceipt(receipt);
  const value = validateObservation(observation, receipt.generation);
  requireUnit(value.InvocationID === receipt.invocation && value.ExecMainStartTimestampMonotonic === receipt.started &&
    value.ActiveState === 'failed' && value.SubState === 'failed' && value.Result === 'exit-code' &&
    value.MainPID === '0' && value.ControlPID === '0' && value.ExecMainCode === '1' &&
    value.ExecMainStatus === String(expectedEofExit) && decimal(value.ExecMainExitTimestampMonotonic, true) &&
    BigInt(value.ExecMainExitTimestampMonotonic) >= BigInt(receipt.started));
  return Object.freeze({ generation: receipt.generation, waitingWrapper: 'normalExit' });
}

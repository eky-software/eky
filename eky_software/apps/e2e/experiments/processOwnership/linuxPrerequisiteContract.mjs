import { posix } from 'node:path';

export const maximumReadBytes = 256 * 1024;
export const maximumResultBytes = 4 * 1024;
export const deadlineMilliseconds = 10_000;

const consumers = ['system-api', 'web-chromium'];
const bindingKeys = ['consumer', 'checkoutSha', 'runId', 'runAttempt'];
const hintKeys = ['createChild', 'writeProcs', 'writeKill'];
const observationKeys = ['cgroupV2', 'cgroupType', 'mountMode', 'events', 'killAvailability'];
const reasons = [
  'observed', 'v2Absent', 'invalidContext', 'notLinux', 'invalidProcData',
  'ambiguousMapping', 'readFailed', 'readLimitExceeded', 'invalidMetadata',
  'deadlineExceeded', 'probeFailed',
];

export class PrerequisiteFailure extends Error {
  constructor(reason) {
    super('Linux prerequisite observation incomplete');
    this.reason = reasons.includes(reason) ? reason : 'probeFailed';
  }
}

function requireValue(condition, reason = 'invalidMetadata') {
  if (!condition) throw new PrerequisiteFailure(reason);
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key =>
    Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value') &&
    descriptors[key].enumerable);
}

function decimal(value, positive = false) {
  return typeof value === 'string' && value.length > 0 && value.length <= 32 &&
    !/[^0-9]/u.test(value) && (!positive || value[0] !== '0');
}

export function validEvidenceBinding(value) {
  return exactKeys(value, bindingKeys) && consumers.includes(value.consumer) &&
    typeof value.checkoutSha === 'string' && value.checkoutSha.length === 40 &&
    !/[^a-f0-9]/u.test(value.checkoutSha) && decimal(value.runId) &&
    decimal(value.runAttempt, true);
}

export function parseProbeContext(argv, environment) {
  if (!Array.isArray(argv) || argv.length !== 2 || !environment ||
      environment.EKY_E2E !== '1' || environment.GITHUB_ACTIONS !== 'true') return null;
  const values = {};
  for (const argument of argv) {
    if (typeof argument !== 'string' || argument.length > 128) return null;
    const match = /^--(consumer|checkout-sha)=([^\r\n]*)$/u.exec(argument);
    if (!match || match[0] !== argument || Object.hasOwn(values, match[1])) return null;
    values[match[1]] = match[2];
  }
  const binding = {
    consumer: values.consumer, checkoutSha: values['checkout-sha'],
    runId: environment.GITHUB_RUN_ID, runAttempt: environment.GITHUB_RUN_ATTEMPT,
  };
  return validEvidenceBinding(binding) ? Object.freeze(binding) : null;
}

export function unknownObservation(binding = null, reason = 'probeFailed') {
  const valid = validEvidenceBinding(binding);
  return {
    schemaVersion: 1, evidence: 'ciPrerequisiteOnly',
    consumer: valid ? binding.consumer : null,
    checkoutSha: valid ? binding.checkoutSha : null,
    runId: valid ? binding.runId : null,
    runAttempt: valid ? binding.runAttempt : null,
    observation: 'incomplete', reason: valid ? reason : 'invalidContext',
    cgroupV2: 'unknown', cgroupType: 'unknown', mountMode: 'unknown',
    events: 'unknown', killAvailability: 'unknown',
    accessHints: { createChild: 'unknown', writeProcs: 'unknown', writeKill: 'unknown' },
    systemd: 'notAttempted', ownershipProof: 'notAttempted',
  };
}

export function validatePrerequisiteResult(value, expectedBinding) {
  requireValue(exactKeys(value, [
    'schemaVersion', 'evidence', ...bindingKeys, 'observation', 'reason',
    ...observationKeys, 'accessHints', 'systemd', 'ownershipProof',
  ]));
  requireValue(value.schemaVersion === 1 && value.evidence === 'ciPrerequisiteOnly');
  requireValue(value.systemd === 'notAttempted' && value.ownershipProof === 'notAttempted');
  requireValue(reasons.includes(value.reason));
  requireValue(exactKeys(value.accessHints, hintKeys));
  requireValue(hintKeys.every(key => ['allowed', 'denied', 'unknown'].includes(value.accessHints[key])));
  const bound = validEvidenceBinding(expectedBinding);
  requireValue(bound || expectedBinding === null);
  requireValue(bindingKeys.every(key => value[key] === (bound ? expectedBinding[key] : null)));
  requireValue(bound ? value.reason !== 'invalidContext' : value.reason === 'invalidContext');
  requireValue(['complete', 'incomplete'].includes(value.observation));
  requireValue(['mapped', 'absent', 'unknown'].includes(value.cgroupV2));
  requireValue(['domain', 'domainThreaded', 'domainInvalid', 'threaded', 'absent', 'unknown'].includes(value.cgroupType));
  requireValue(['rw', 'ro', 'unknown'].includes(value.mountMode));
  requireValue(['observed', 'absent', 'unknown'].includes(value.events));
  requireValue(['present', 'absent', 'unknown'].includes(value.killAvailability));
  if (value.observation === 'incomplete') {
    requireValue(!['observed', 'v2Absent'].includes(value.reason));
    requireValue(observationKeys.every(key => value[key] === 'unknown'));
    requireValue(hintKeys.every(key => value.accessHints[key] === 'unknown'));
  } else if (value.reason === 'v2Absent') {
    requireValue(bound && value.cgroupV2 === 'absent');
    requireValue(observationKeys.slice(1).every(key => value[key] === 'unknown'));
    requireValue(hintKeys.every(key => value.accessHints[key] === 'unknown'));
  } else {
    requireValue(bound && value.reason === 'observed' && value.cgroupV2 === 'mapped');
    requireValue(observationKeys.every(key => value[key] !== 'unknown'));
    requireValue(value.accessHints.createChild !== 'unknown');
    requireValue(value.killAvailability !== 'absent' || value.accessHints.writeKill === 'unknown');
    requireValue(value.killAvailability !== 'present' || value.accessHints.writeKill !== 'unknown');
    requireValue(value.mountMode !== 'ro' || hintKeys.every(key => value.accessHints[key] !== 'allowed'));
  }
  return value;
}

export function serializePrerequisiteResult(value, binding) {
  validatePrerequisiteResult(value, binding);
  const line = `${JSON.stringify(value)}\n`;
  requireValue(Buffer.byteLength(line, 'utf8') <= maximumResultBytes);
  return line;
}

function boundedLines(text) {
  requireValue(typeof text === 'string', 'invalidProcData');
  requireValue(Buffer.byteLength(text, 'utf8') < maximumReadBytes, 'readLimitExceeded');
  requireValue(text.length > 0 && !/[\0\r\uFFFD]/u.test(text), 'invalidProcData');
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  requireValue(lines.every(line => line.length > 0), 'invalidProcData');
  return lines;
}

function validAbsolutePath(path) {
  return path.startsWith('/') && !/[\0\r\n]/u.test(path) &&
    !path.endsWith(' (deleted)') && (path === '/' ||
      path.slice(1).split('/').every(part => part !== '' && part !== '.' && part !== '..'));
}

function mountPath(field) {
  requireValue(!/\\(?!040|011|012|134)/u.test(field), 'invalidProcData');
  const decoded = field.replace(/\\(040|011|012|134)/gu,
    (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
  requireValue(validAbsolutePath(decoded), 'ambiguousMapping');
  return decoded;
}

function inside(path, root) {
  return path === root || (root === '/' ? path.startsWith('/') : path.startsWith(`${root}/`));
}

function mountMode(options, superOptions) {
  const mode = field => {
    const found = field.split(',').filter(option => option === 'ro' || option === 'rw');
    requireValue(found.length === 1, 'invalidProcData');
    return found[0];
  };
  return [mode(options), mode(superOptions)].includes('ro') ? 'ro' : 'rw';
}

export function resolveOwnCgroup(cgroupText, mountinfoText) {
  const memberships = boundedLines(cgroupText).map(line => {
    const match = /^(0|[1-9][0-9]*):([^:]*):(\/.*)$/u.exec(line);
    requireValue(match !== null, 'invalidProcData');
    requireValue(validAbsolutePath(match[3]), 'ambiguousMapping');
    requireValue(match[1] === '0' ? match[2] === '' : /^[a-zA-Z0-9_=,-]+$/u.test(match[2]), 'invalidProcData');
    return { hierarchy: match[1], path: match[3] };
  });
  requireValue(new Set(memberships.map(value => value.hierarchy)).size === memberships.length, 'ambiguousMapping');
  const mounts = boundedLines(mountinfoText).map(line => {
    const fields = line.split(' ');
    const separator = fields.indexOf('-');
    requireValue(separator >= 6 && fields.length === separator + 4 && fields.every(Boolean), 'invalidProcData');
    requireValue(/^[0-9]+$/u.test(fields[0]) && /^[0-9]+$/u.test(fields[1]) &&
      /^[0-9]+:[0-9]+$/u.test(fields[2]), 'invalidProcData');
    return {
      id: fields[0], parent: fields[1], root: mountPath(fields[3]), point: mountPath(fields[4]),
      type: fields[separator + 1], options: fields[5], superOptions: fields[separator + 3],
    };
  });
  requireValue(new Set(mounts.map(mount => mount.id)).size === mounts.length, 'ambiguousMapping');
  const own = memberships.find(value => value.hierarchy === '0');
  const v2 = mounts.filter(mount => mount.type === 'cgroup2');
  if (!own && v2.length === 0) return { cgroupV2: 'absent' };
  requireValue(own && v2.length === 1, 'ambiguousMapping');
  const mount = v2[0];
  // Both proc views must agree on the namespace root; never prepend a guessed root.
  requireValue(inside(own.path, mount.root), 'ambiguousMapping');
  const target = posix.join(mount.point, posix.relative(mount.root, own.path));
  requireValue(inside(target, mount.point), 'ambiguousMapping');
  const byId = new Map(mounts.map(value => [value.id, value]));
  const ancestors = new Set([mount.id]);
  let cursor = mount;
  while (byId.has(cursor.parent) && cursor.parent !== cursor.id) {
    requireValue(!ancestors.has(cursor.parent), 'ambiguousMapping');
    cursor = byId.get(cursor.parent);
    ancestors.add(cursor.id);
  }
  requireValue(!mounts.some(other => inside(mount.point, other.point) &&
    !ancestors.has(other.id)), 'ambiguousMapping');
  const inspected = ['cgroup.type', 'cgroup.events', 'cgroup.procs', 'cgroup.kill']
    .map(name => posix.join(target, name));
  requireValue(!mounts.some(other => other !== mount && inside(other.point, mount.point) &&
    (inside(target, other.point) || inspected.includes(other.point))), 'ambiguousMapping');
  return { cgroupV2: 'mapped', target, mountMode: mountMode(mount.options, mount.superOptions) };
}

export function parseCgroupType(text) {
  const lines = boundedLines(text);
  const types = { domain: 'domain', threaded: 'threaded', 'domain threaded': 'domainThreaded', 'domain invalid': 'domainInvalid' };
  requireValue(lines.length === 1 && Object.hasOwn(types, lines[0]));
  return types[lines[0]];
}

export function parseCgroupEvents(text) {
  const entries = boundedLines(text).map(line => line.split(' '));
  requireValue(entries.every(([key, value, extra]) =>
    ['populated', 'frozen'].includes(key) && ['0', '1'].includes(value) && extra === undefined));
  requireValue(new Set(entries.map(([key]) => key)).size === entries.length);
  requireValue(entries.some(([key]) => key === 'populated'));
  // No population count or empty-tree/reaping claim crosses the output boundary.
  return 'observed';
}

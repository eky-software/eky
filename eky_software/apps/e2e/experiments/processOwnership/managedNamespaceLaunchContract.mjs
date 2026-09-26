import { posix } from 'node:path';
import { actorArguments, childEnvironment, exactKeys, budgets } from './pidNamespaceContract.mjs';
import { managedUnitName, managedUnitProperties, unitObservationArguments } from './managedNamespaceUnitContract.mjs';

export const managedSystemTools = Object.freeze({
  sudo: '/usr/bin/sudo', manager: '/usr/bin/systemd-run', control: '/usr/bin/systemctl',
  environment: '/usr/bin/env', namespace: '/usr/bin/unshare', credentials: '/usr/bin/setpriv',
});
// These are independent manager containment limits, NOT extensions to the
// original monotonic experiment deadlines or permission to accept a late exit.
export const managerContainment = Object.freeze({ start: budgets.ready, runtime: budgets.init, stop: 1000 });
const protectedProperties = Object.freeze([
  'CapabilityBoundingSet=CAP_SYS_ADMIN CAP_SETUID CAP_SETGID CAP_SETPCAP',
  'AmbientCapabilities=', 'PassEnvironment=',
  'UnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT NODE_OPTIONS NODE_PATH BASH_ENV ENV',
  'InaccessiblePaths=-/run/dbus -/run/systemd/private -/run/user',
  'Delegate=no', 'SendSIGKILL=yes', 'FinalKillSignal=SIGKILL',
  'StandardInput=null', 'StandardOutput=null', 'StandardError=null',
]);

function requireLaunch(condition) {
  if (!condition) throw new Error('Managed namespace launch configuration invalid');
}

function path(value) {
  // This experiment deliberately fails closed on paths requiring systemd's
  // specifier/quoting expansion; it is not a general command-line builder.
  requireLaunch(typeof value === 'string' && value.length < 2048 &&
    /^\/[A-Za-z0-9_./-]+$/u.test(value) && !/[^A-Za-z0-9_./-]/u.test(value) &&
    posix.normalize(value) === value && !value.endsWith('/'));
  return value;
}

function command(file, args) {
  return Object.freeze({ file, args: Object.freeze(args), env: Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }) });
}

export function managedLaunchCommand(config) {
  requireLaunch(exactKeys(config, ['generation', 'started', 'uid', 'gid', 'root', 'node', 'init']));
  requireLaunch(typeof config.generation === 'string' && typeof config.started === 'string' &&
    Number.isSafeInteger(config.uid) && Number.isSafeInteger(config.gid));
  const actor = actorArguments(config);
  const unit = managedUnitName(config.generation);
  const root = path(config.root);
  const node = path(config.node);
  const init = path(config.init);
  requireLaunch(posix.basename(root).startsWith('eky-managed-ns-') &&
    posix.basename(node) === 'node' && posix.basename(init) === 'managedNamespaceInit.mjs');
  const properties = [
    ...Object.entries(managedUnitProperties).map(([key, value]) => `${key}=${value}`),
    ...protectedProperties, `WorkingDirectory=${root}`, 'SuccessExitStatus=',
    `TimeoutStartSec=${managerContainment.start}ms`, `RuntimeMaxSec=${managerContainment.runtime}ms`,
    `TimeoutStopSec=${managerContainment.stop}ms`,
  ];
  return command(managedSystemTools.sudo, [
    '-n', '--', managedSystemTools.manager, '--system', '--no-ask-password', '--no-block', '--quiet',
    '--expand-environment=no', '--description=Eky bounded synthetic test session', `--unit=${unit}`,
    ...properties.map(value => `--property=${value}`), '--',
    managedSystemTools.environment, '--ignore-environment',
    ...Object.entries(childEnvironment()).map(([key, value]) => `${key}=${value}`),
    managedSystemTools.namespace, '--mount', '--propagation=private', '--mount-proc=/proc',
    '--pid', '--fork', '--kill-child=SIGKILL', '--',
    managedSystemTools.credentials, `--reuid=${config.uid}`, `--regid=${config.gid}`, '--clear-groups',
    '--no-new-privs', '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all', '--',
    node, init, ...actor, `--root=${root}`,
  ]);
}

export function managedObservationCommand(generation) {
  return command(managedSystemTools.sudo, ['-n', '--', managedSystemTools.control,
    '--system', '--no-ask-password', ...unitObservationArguments, '--', managedUnitName(generation)]);
}

// Call only after the owning adapter has verified the invocation receipt. A
// unit name alone is not stop authority or protection against name reuse.
export function managedStopCommand(generation) {
  return command(managedSystemTools.sudo, ['-n', '--', managedSystemTools.control,
    '--system', '--no-ask-password', '--no-block', 'stop', '--', managedUnitName(generation)]);
}

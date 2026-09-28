import { spawn } from 'node:child_process';
import { childEnvironment, waitWithin } from './pidNamespaceContract.mjs';
import { startManagedCommand } from './managedNamespaceCommand.mjs';
import { managedSystemTools, managedStopCommand } from './managedNamespaceLaunchContract.mjs';
import { captureRunningUnit, managedUnitName, managedUnitProperties, observeWaitingWrapper,
  verifyOwnedUnitObservation } from './managedNamespaceUnitContract.mjs';
import { linuxServiceInitPath } from './linuxServiceConfiguration.mjs';
import { guardLinuxService, requireService, serviceFailure, servicePath, validateServiceConfig } from './linuxServiceContract.mjs';

export function linuxServiceLaunchCommand(config, deadline, initPath = linuxServiceInitPath) {
  validateServiceConfig(config);
  servicePath(initPath);
  deadline.check('ready');
  const start = Math.floor(deadline.remaining('ready'));
  const runtime = Math.floor(deadline.remaining('wrapper'));
  requireService(start > 0 && runtime > 0, 'startupDeadlineExceeded');
  const properties = [
    ...Object.entries(managedUnitProperties).map(([key, value]) => `${key}=${value}`),
    'CapabilityBoundingSet=CAP_SYS_ADMIN CAP_SETUID CAP_SETGID CAP_SETPCAP',
    'AmbientCapabilities=', 'PassEnvironment=',
    'UnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT NODE_OPTIONS NODE_PATH BASH_ENV ENV',
    'InaccessiblePaths=-/run/dbus -/run/systemd/private -/run/user',
    'Delegate=no', 'SendSIGKILL=yes', 'FinalKillSignal=SIGKILL',
    'StandardInput=null', 'StandardOutput=null', 'StandardError=null',
    `WorkingDirectory=${config.root}`, 'SuccessExitStatus=',
    `TimeoutStartSec=${start}ms`, `RuntimeMaxSec=${runtime}ms`, 'TimeoutStopSec=1000ms',
  ];
  return Object.freeze({ file: managedSystemTools.sudo, args: Object.freeze([
    '-n', '--', managedSystemTools.manager, '--system', '--no-ask-password', '--no-block', '--quiet',
    '--expand-environment=no', '--description=Eky bounded synthetic service',
    `--unit=${managedUnitName(config.generation)}`, ...properties.map(value => `--property=${value}`), '--',
    managedSystemTools.environment, '--ignore-environment',
    ...Object.entries(childEnvironment()).map(([key, value]) => `${key}=${value}`),
    managedSystemTools.namespace, '--mount', '--propagation=private', '--mount-proc=/proc',
    '--pid', '--fork', '--kill-child=SIGKILL', '--', managedSystemTools.credentials,
    `--reuid=${config.uid}`, `--regid=${config.gid}`, '--clear-groups', '--no-new-privs',
    '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all', '--',
    config.node, initPath, `--root=${config.root}`,
  ]), env: Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }) });
}

// Only the private, closed service launch/authorization/stop commands use this
// executor. Observation continues to use the existing strict LM reader.
function execute(command, policy, deadline, phase, spawnChild, time) {
  let child;
  let spawned = false;
  let exited = false;
  let closed = false;
  let failure;
  let timer;
  const streams = { stdout: { bytes: 0, ended: false }, stderr: { bytes: 0, ended: false } };
  let resolveClosed;
  let resolveResult;
  let rejectResult;
  const completion = new Promise(resolve => { resolveClosed = resolve; });
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  result.catch(() => {});
  let killed = false;
  const terminate = () => {
    if (!spawned || exited || closed || killed) return;
    killed = true;
    try { child.kill('SIGKILL'); } catch { /* Signal delivery is never a close receipt. */ }
  };
  const fail = () => {
    failure ??= serviceFailure('launchFailed');
    rejectResult(failure);
    terminate();
  };
  try {
    deadline.check(phase);
    child = spawnChild(command.file, command.args, {
      cwd: '/', env: command.env, shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.once('spawn', () => { spawned = true; if (failure) terminate(); });
    child.on('error', fail);
    child.once('exit', (code, signal) => { exited = true; if (code !== 0 || signal !== null) fail(); });
    child.once('close', (code, signal) => {
      closed = true;
      time.clearTimeout(timer);
      try {
        deadline.check(phase);
        requireService(!failure && spawned && exited && code === 0 && signal === null &&
          streams.stdout.ended && streams.stderr.ended, 'launchFailed');
        resolveResult();
      } catch { fail(); }
      resolveClosed();
    });
    for (const name of ['stdout', 'stderr']) {
      const stream = child[name];
      if (!stream) { fail(); continue; }
      const state = streams[name];
      stream.on('error', fail);
      stream.once('end', () => { state.ended = true; });
      stream.once('close', () => { if (!state.ended) fail(); });
      stream.on('data', chunk => {
        if (!Buffer.isBuffer(chunk) || state.ended) { fail(); return; }
        state.bytes += chunk.length;
        if (state.bytes >= 8192 || ((!policy || name === 'stderr') && chunk.length > 0)) fail();
      });
    }
    timer = time.setTimeout(fail, deadline.remaining(phase));
  } catch {
    fail();
    if (!child) { closed = true; resolveClosed(); }
  }
  return { result, closed: completion, isClosed: () => closed };
}

export function createLinuxServiceManager(config, deadline, {
  runtime = process, spawnChild = spawn, time = globalThis, startCommand = startManagedCommand,
  initPath = linuxServiceInitPath,
} = {}) {
  validateServiceConfig(config);
  const identity = guardLinuxService(runtime);
  requireService(config.uid === identity.uid && config.gid === identity.gid);
  const handles = [];
  let receipt;
  let attempted = false;
  let authorized;
  let stopResult;
  const existing = (operation, phase = 'ready') => {
    const handle = startCommand({ operation, generation: config.generation, deadline, phase, runtime, spawnChild, time });
    handles.push(handle);
    return handle.result;
  };
  const run = (command, policy, phase) => {
    const handle = execute(command, policy, deadline, phase, spawnChild, time);
    handles.push(handle);
    return handle.result;
  };
  const drain = phase => waitWithin(Promise.all(handles.map(handle => handle.closed)), deadline, phase, time);
  const guard = () => {
    const actual = guardLinuxService(runtime);
    requireService(actual.uid === config.uid && actual.gid === config.gid);
  };
  return Object.freeze({
    async prepare() {
      guard();
      await existing('managerProbe');
      await existing('authorizeObservation');
      await existing('authorizeStop');
      authorized = linuxServiceLaunchCommand(config, deadline, initPath);
      await run({ ...authorized, args: ['-n', '-l', ...authorized.args.slice(1)] }, true, 'ready');
    },
    async launch() {
      guard();
      deadline.check('ready');
      requireService(authorized && !attempted);
      attempted = true;
      // The immutable authorized request may contain a longer containment timer
      // after preparation. Init still enforces the ORIGINAL absolute work limit.
      await run(authorized, false, 'ready');
    },
    async own() {
      requireService(attempted && !receipt);
      receipt = captureRunningUnit(await existing('observation'), config.generation);
    },
    async observe() {
      requireService(receipt && !stopResult, 'cleanupUnverified');
      await drain('wrapper');
      return observeWaitingWrapper(await existing('observation', 'wrapper'), receipt);
    },
    emergencyStop() {
      stopResult ??= (async () => {
        await drain('wrapper');
        requireService(receipt, 'cleanupUnverified');
        verifyOwnedUnitObservation(await existing('observation', 'wrapper'), receipt);
        await run(managedStopCommand(config.generation), false, 'wrapper');
      })();
      stopResult.catch(() => {});
      return stopResult;
    },
    settle: () => drain('wrapper'),
    mayHaveStarted: () => attempted,
  });
}

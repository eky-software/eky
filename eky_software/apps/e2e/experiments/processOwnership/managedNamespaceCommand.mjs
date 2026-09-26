import { spawn } from 'node:child_process';
import { currentIdentity } from './pidNamespaceActor.mjs';
import { requireCondition, validateIdentity, waitWithin } from './pidNamespaceContract.mjs';
import { managedLaunchCommand, managedObservationCommand, managedStopCommand,
  managedSystemTools } from './managedNamespaceLaunchContract.mjs';
import { captureRunningUnit, observeWaitingWrapper, parseUnitObservation, unitObservationLimit,
  verifyOwnedUnitObservation } from './managedNamespaceUnitContract.mjs';

function guard(runtime, expected) {
  requireCondition(runtime.platform === 'linux' && runtime.env.EKY_E2E === '1' &&
    runtime.env.CI === 'true' && runtime.env.GITHUB_ACTIONS === 'true', 'invalidContext');
  const identity = currentIdentity(runtime);
  validateIdentity(identity, expected ?? identity);
}

function authorization(command) {
  return Object.freeze({ ...command, args: Object.freeze(['-n', '-l', ...command.args.slice(1)]) });
}

// Closed operations only: callers cannot supply a command, environment or parser.
export function startManagedCommand({ operation, generation, deadline, phase,
  runtime = process, spawnChild = spawn, time = globalThis }) {
  guard(runtime);
  let command;
  switch (operation) {
    case 'observation': command = managedObservationCommand(generation); break;
    case 'authorizeObservation': command = authorization(managedObservationCommand(generation)); break;
    case 'authorizeStop': command = authorization(managedStopCommand(generation)); break;
    case 'managerProbe':
      command = Object.freeze({ file: managedSystemTools.control,
        args: Object.freeze(['--system', '--no-ask-password', 'show', '--no-pager', '--property=Version', '--value']),
        env: Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }) });
      break;
    default: requireCondition(false, 'invalidArguments');
  }
  if (operation !== 'observation' && phase === undefined) phase = 'ready';
  requireCondition(operation === 'observation' ? ['ready', 'wrapper'].includes(phase) : phase === 'ready',
    'invalidArguments');
  return runCommand({ command, operation, generation, deadline, phase, spawnChild, time });
}

// One immutable launch request. Acceptance only queues the start; own() must
// capture a fresh running receipt internally before exposing unit operations.
export function prepareManagedLaunch({ config, deadline, runtime = process, spawnChild = spawn, time = globalThis }) {
  guard(runtime);
  const command = managedLaunchCommand(config);
  const generation = config.generation;
  const expected = Object.freeze({ uid: config.uid, gid: config.gid });
  guard(runtime, expected);
  deadline.check('ready');
  let authorizationStarted = false;
  let authorized = false;
  let launchStarted = false;
  let launchAccepted = false;
  let ownership;
  let sealed = false;
  let pendingOperations = 0;
  let tail = Promise.resolve();
  const commands = [];
  const schedule = (phase, operation) => {
    requireCondition(!sealed, 'invalidArguments');
    pendingOperations++;
    const result = tail.catch(() => {}).then(async () => {
      // A rejected result is not a closed ChildProcess. Never overlap manager
      // commands while a preceding child still has uncertain closure.
      await waitWithin(Promise.all(commands.map(handle => handle.closed)), deadline, phase, time);
      return operation();
    }).finally(() => { pendingOperations--; });
    tail = result;
    result.catch(() => {});
    return result;
  };
  const track = input => {
    const handle = runCommand({ ...input, deadline, spawnChild, time });
    commands.push(handle);
    return handle;
  };
  const observe = phase => {
    guard(runtime, expected);
    return track({ command: managedObservationCommand(generation), operation: 'observation', generation, phase });
  };
  return Object.freeze({
    authorize() {
      guard(runtime, expected);
      deadline.check('ready');
      requireCondition(!sealed && !authorizationStarted, 'invalidArguments');
      authorizationStarted = true;
      const query = track({ command: authorization(command), operation: 'authorizeLaunch', phase: 'ready' });
      const result = query.result.then(value => { authorized = true; return value; });
      result.catch(() => {});
      return Object.freeze({ ...query, result });
    },
    launch() {
      guard(runtime, expected);
      deadline.check('ready');
      requireCondition(!sealed && authorized && !launchStarted, 'invalidArguments');
      launchStarted = true;
      const handle = track({ command, operation: 'launch', phase: 'ready' });
      const result = handle.result.then(value => { launchAccepted = true; return value; });
      result.catch(() => {});
      return Object.freeze({ ...handle, result });
    },
    own() {
      guard(runtime, expected);
      deadline.check('ready');
      requireCondition(launchAccepted, 'invalidArguments');
      if (!ownership) {
        ownership = schedule('ready', async () => {
          const value = await observe('ready').result;
          const receipt = captureRunningUnit(value, generation);
          guard(runtime, expected);
          deadline.check('ready');
          let stopping;
          return Object.freeze({
            async observeWrapper() {
              requireCondition(!stopping, 'cleanupUnverified');
              return schedule('wrapper', async () => {
                requireCondition(!stopping, 'cleanupUnverified');
                const value = await observe('wrapper').result;
                guard(runtime, expected);
                deadline.check('wrapper');
                requireCondition(!stopping, 'cleanupUnverified');
                return observeWaitingWrapper(value, receipt);
              });
            },
            stop() {
              if (!stopping) {
                // Schedule once, before observation can fail or reenter. A fresh
                // receipt check is not an atomic CAS against a hostile manager.
                stopping = schedule('wrapper', async () => {
                  const value = await observe('wrapper').result;
                  verifyOwnedUnitObservation(value, receipt);
                  guard(runtime, expected);
                  return track({ command: managedStopCommand(generation), operation: 'stop', phase: 'wrapper' }).result;
                });
                stopping.catch(() => {});
              }
              return stopping;
            },
          });
        });
        ownership.catch(() => {});
      }
      return ownership;
    },
    async settleCommands() {
      sealed = true;
      // Includes operations already queued but not yet represented by a child.
      await waitWithin(tail.catch(() => {}), deadline, 'wrapper', time);
      await waitWithin(Promise.all(commands.map(handle => handle.closed)), deadline, 'wrapper', time);
    },
    commandsClosed() {
      return pendingOperations === 0 && commands.every(handle => handle.snapshot().commandCleanup !== 'unverified');
    },
  });
}

function acceptOutput(text, operation, generation) {
  if (operation === 'observation') return parseUnitObservation(text, generation);
  if (operation === 'managerProbe') {
    const body = text.slice(0, -1);
    requireCondition(text.endsWith('\n') && body.trim().length > 0 && !/[^\x20-\x7e]/u.test(body), 'invalidMessage');
    return Object.freeze({ kind: 'managerReachable' });
  }
  if (operation === 'launch' || operation === 'stop') {
    requireCondition(text.length === 0, 'invalidMessage');
    return Object.freeze({ kind: operation === 'launch' ? 'launchCommandAccepted' : 'stopCommandAccepted' });
  }
  // Listing policy can have different authentication rules from execution.
  // Discard its bounded output; never promote it to broader permission.
  return Object.freeze({ kind: 'policyListed' });
}

function runCommand({ command, operation, generation, deadline, phase, spawnChild, time }) {
  deadline.check(phase);
  let child;
  let spawned = false;
  let exited = false;
  let closed = false;
  let notStarted = false;
  let exitCode;
  let exitSignal;
  let terminationAttempted = false;
  let fault = null;
  let accepted = false;
  let timer;
  let output = Buffer.alloc(0);
  const streams = { stdout: { ended: false, bytes: 0 }, stderr: { ended: false, bytes: 0 } };
  let resolveResult;
  let rejectResult;
  let resolveClosed;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  result.catch(() => {});
  const completion = new Promise(resolve => { resolveClosed = resolve; });
  const snapshot = () => Object.freeze({
    reason: fault, accepted, spawned, exited,
    commandCleanup: closed ? 'closed' : notStarted ? 'notStarted' : 'unverified',
    terminationAttempted,
  });
  const terminate = () => {
    if (!child || !spawned || exited || closed || terminationAttempted) return;
    terminationAttempted = true;
    // Only this ChildProcess, never a cached PID/group or the observed unit.
    // sudo may reject the signal; even a true return is not closure evidence.
    try { child.kill('SIGKILL'); } catch { /* The actual close remains required. */ }
  };
  const fail = reason => {
    if (fault || accepted) return;
    fault = reason;
    time.clearTimeout(timer);
    const error = new Error(operation === 'observation' ? 'Managed namespace query unverified' :
      'Managed namespace command unverified');
    error.reason = reason;
    rejectResult(error);
    // Latch the failure before kill, which can emit error/exit/close reentrantly.
    terminate();
  };
  const checkDeadline = () => {
    try { deadline.check(phase); return true; }
    catch { fail('deadlineExceeded'); return false; }
  };
  try {
    child = spawnChild(command.file, command.args, {
      env: command.env, cwd: '/', shell: false, detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    notStarted = true;
    fail('spawnFailed');
    resolveClosed(snapshot());
    return Object.freeze({ result, closed: completion, snapshot });
  }
  child.once('spawn', () => {
    spawned = true;
    if (fault) terminate(); else checkDeadline();
  });
  child.on('error', () => fail('processError'));
  child.once('exit', (code, signal) => {
    exited = true; exitCode = code; exitSignal = signal;
    if (code !== 0 || signal !== null) fail('exitFailed');
  });
  child.once('close', (code, signal) => {
    closed = true;
    time.clearTimeout(timer);
    if (!fault && checkDeadline()) {
      if (!spawned || !exited || code !== 0 || signal !== null || code !== exitCode || signal !== exitSignal ||
          !streams.stdout.ended || !streams.stderr.ended) fail('terminalIncomplete');
      if (!fault) {
        try {
          // Decode only the complete bounded byte sequence; do not repair UTF-8.
          const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(output);
          const value = acceptOutput(text, operation, generation);
          if (checkDeadline()) { accepted = true; resolveResult(value); }
        } catch { fail(operation === 'observation' ? 'observationInvalid' : 'outputInvalid'); }
      }
    }
    output = Buffer.alloc(0);
    resolveClosed(snapshot());
  });
  for (const name of ['stdout', 'stderr']) {
    const stream = child[name];
    const state = streams[name];
    if (!stream) { fail('streamMissing'); continue; }
    stream.on('error', () => fail('streamError'));
    stream.on('end', () => { state.ended = true; });
    stream.on('close', () => { if (!state.ended) fail('streamIncomplete'); });
    stream.on('data', chunk => {
      if (fault || accepted) return;
      if (state.ended || !Buffer.isBuffer(chunk)) { fail('streamInvalid'); return; }
      if (chunk.length >= unitObservationLimit - state.bytes) { fail('outputLimit'); return; }
      state.bytes += chunk.length;
      if (name === 'stderr' && chunk.length > 0) { fail('stderrNotEmpty'); return; }
      if (name === 'stdout') output = Buffer.concat([output, chunk]);
    });
  }
  if (!fault && checkDeadline()) {
    timer = time.setTimeout(() => fail('deadlineExceeded'), deadline.remaining(phase));
  }
  return Object.freeze({ result, closed: completion, snapshot });
}

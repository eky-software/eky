import { spawn } from 'node:child_process';
import { currentIdentity } from './pidNamespaceActor.mjs';
import { requireCondition, validateIdentity } from './pidNamespaceContract.mjs';
import { managedObservationCommand } from './managedNamespaceLaunchContract.mjs';
import { parseUnitObservation, unitObservationLimit } from './managedNamespaceUnitContract.mjs';

// Internal show-only adapter. Its caller must complete the managed-session
// preflight before live use. This is not launch, stop or tree-cleanup authority.
export function startManagedObservation({
  generation, deadline, phase, runtime = process, spawnChild = spawn, time = globalThis,
}) {
  requireCondition(runtime.platform === 'linux' && runtime.env.EKY_E2E === '1' &&
    runtime.env.CI === 'true' && runtime.env.GITHUB_ACTIONS === 'true', 'invalidContext');
  const identity = currentIdentity(runtime);
  validateIdentity(identity, identity);
  requireCondition(['ready', 'wrapper'].includes(phase), 'invalidArguments');
  const command = managedObservationCommand(generation);
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
    queryCleanup: closed ? 'closed' : notStarted ? 'notStarted' : 'unverified',
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
    const error = new Error('Managed namespace query unverified');
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
          const observation = parseUnitObservation(text, generation);
          if (checkDeadline()) { accepted = true; resolveResult(observation); }
        } catch { fail('observationInvalid'); }
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

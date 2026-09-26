import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { currentIdentity } from './pidNamespaceActor.mjs';
import { captureBootstrapDiagnostic } from './pidNamespaceDiagnostics.mjs';
import {
  actorArguments, childEnvironment, classifyBootstrap, createDeadline, descriptors,
  expectedEofExit, experimentContext, limits, message, NamespaceFailure,
  requireCondition, responseChannel, resultFor, safeReason, serializeResult,
  unshareArguments, validateIdentity, writeMessage,
} from './pidNamespaceContract.mjs';

export function waitWithin(promise, deadline, phase, time = globalThis) {
  // The operation may already have rejected before the deadline guard runs.
  // Always observe it, even when this wait can no longer accept its result.
  promise = Promise.resolve(promise);
  promise.catch(() => {});
  return new Promise((resolve, reject) => {
    let timer;
    try { deadline.check(phase); }
    catch (error) { reject(error); return; }
    timer = time.setTimeout(() => reject(new NamespaceFailure('deadlineExceeded')), deadline.remaining(phase));
    promise.then(value => {
      time.clearTimeout(timer);
      try { deadline.check(phase); resolve(value); } catch (error) { reject(error); }
    }, error => { time.clearTimeout(timer); reject(error); });
  });
}

export function watchChild(child) {
  const state = { child, exited: false, closed: false, spawnCode: null, code: null, signal: null, inputFailed: false };
  child.on('error', error => { state.spawnCode = error?.code ?? 'unknown'; });
  child.stdin?.on('error', () => { state.inputFailed = true; });
  child.once('exit', (code, signal) => { state.exited = true; state.code = code; state.signal = signal; });
  state.completion = new Promise(resolve => child.once('close', (code, signal) => {
    state.closed = true;
    state.code = code;
    state.signal = signal;
    resolve(state);
  }));
  return state;
}

export function emergencyStop(owned) {
  // Only this still-open ChildProcess; no lookup, cached PID or process-group signal.
  if (!owned || owned.exited || owned.closed || owned.spawnCode) return false;
  try { return owned.child.kill('SIGKILL'); } catch { return false; }
}

function closeControl(owned) {
  try { owned.child.stdin.end(); }
  catch { owned.inputFailed = true; }
}

export async function runNamespaceExperiment({
  binding, started, facts, platform = process.platform, identity = () => currentIdentity(),
  execPath = process.execPath, fs = filesystem, tempDirectory = tmpdir,
  spawnChild = spawn, nonce = () => randomBytes(16).toString('hex'),
  now = () => process.hrtime.bigint(), time = globalThis,
  isEnded = () => false,
}) {
  const deadline = createDeadline(started, now);
  const check = phase => { requireCondition(!isEnded(), 'deadlineExceeded'); deadline.check(phase); };
  const wait = (promise, phase) => waitWithin(promise, deadline, phase, time);
  let root;
  let temp;
  let wrapper;
  let sentinel;
  let replies;
  let sentinelReplies;
  let emergencyTimer;
  let stderr = '';
  let stderrBytes = 0;
  let stderrFailed = false;
  let stderrEnded = false;
  let emergency = false;
  let sentinelBefore = false;
  let ready = false;
  let sentinelGeneration;
  let reason = 'experimentFailed';

  const challengeSentinel = async phase => {
    check(phase);
    requireCondition(sentinel && !sentinel.exited && !sentinel.closed && !sentinel.inputFailed, 'sentinelFailed');
    const challenge = nonce();
    const response = sentinelReplies.expect('ALIVE', sentinelGeneration, phase, challenge);
    await wait(writeMessage(sentinel.child.stdin,
      message('CHALLENGE', sentinelGeneration, challenge), deadline, phase), phase);
    await response;
    sentinelReplies.check();
    check(phase);
  };

  try {
    requireCondition(binding !== null, 'invalidContext');
    requireCondition(platform === 'linux', 'notLinux');
    check('ready');
    const ids = identity();
    validateIdentity(ids, ids);
    temp = await fs.realpath(tempDirectory());
    check('ready');
    root = await fs.mkdtemp(join(temp, 'eky-pid-namespace-'));
    facts.rootCreated = true;
    check('ready');
    const metadata = await fs.lstat(root);
    requireCondition(metadata.isDirectory() && !metadata.isSymbolicLink() &&
      dirname(root) === temp && /^eky-pid-namespace-[a-zA-Z0-9]{6}$/u.test(basename(root)) &&
      await fs.realpath(root) === root, 'rootFailed');
    check('ready');
    const generation = nonce();
    sentinelGeneration = nonce();
    requireCondition(generation !== sentinelGeneration, 'invalidArguments');
    const config = { generation, started, uid: ids.uid, gid: ids.gid };
    const sentinelArgs = actorArguments({ ...config, generation: sentinelGeneration }, 'sentinel');
    const initArgs = actorArguments(config);
    check('ready');
    sentinel = watchChild(spawnChild(execPath,
      [fileURLToPath(new URL('./pidNamespaceActor.mjs', import.meta.url)), ...sentinelArgs], {
        cwd: root, env: childEnvironment(), shell: false, detached: false, stdio: [...descriptors.sentinel],
      }));
    facts.sentinelStarted = true;
    sentinelReplies = responseChannel(sentinel.child.stdio[3], deadline, time);
    await challengeSentinel('ready');
    sentinelBefore = true;
    check('ready');
    wrapper = watchChild(spawnChild('unshare', [
      ...unshareArguments, execPath,
      fileURLToPath(new URL('./pidNamespaceInit.mjs', import.meta.url)), ...initArgs,
    ], { cwd: root, env: childEnvironment(), shell: false, detached: false, stdio: [...descriptors.wrapper] }));
    facts.launched = true;
    emergencyTimer = time.setTimeout(() => {
      if (!wrapper.closed) {
        emergency = true;
        emergencyStop(wrapper);
      }
    }, deadline.remaining('wrapper'));
    wrapper.child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > limits.channel) { stderrFailed = true; return; }
      stderr += chunk.toString('utf8');
    });
    wrapper.child.stderr.on('error', () => { stderrFailed = true; });
    wrapper.child.stderr.on('end', () => { stderrEnded = true; });
    replies = responseChannel(wrapper.child.stdio[3], deadline, time);
    await replies.expect('READY', generation, 'ready');
    ready = true;
    check('ready');
    replies.check();
    sentinelReplies.check();
    requireCondition(!sentinel.exited && !wrapper.exited && !wrapper.inputFailed, 'channelFailed');
    const workload = replies.expect('WORKLOAD', generation, 'workload');
    // Record GO before writing: even an ambiguous write failure is post-GO.
    facts.go = true;
    await wait(writeMessage(wrapper.child.stdin, message('GO', generation), deadline, 'ready'), 'ready');
    await workload;
    check('workload');
    replies.check();
    facts.workload = true;
    check('init');
    closeControl(wrapper);
    await wait(wrapper.completion, 'wrapper');
    replies.closed();
    requireCondition(wrapper.exited && wrapper.code === expectedEofExit && wrapper.signal === null &&
      !wrapper.spawnCode && !wrapper.inputFailed && stderrEnded && !stderrFailed &&
      stderr === '' && !emergency, 'cleanupUnverified');
    facts.destroyed = true;
    reason = 'observed';
  } catch (error) {
    reason = safeReason(error);
  } finally {
    if (wrapper && !wrapper.closed) {
      closeControl(wrapper);
      try { await wait(wrapper.completion, 'wrapper'); } catch { /* Emergency timer owns the open wrapper. */ }
    }
    facts.wrapperClosed = Boolean(wrapper?.closed);
    const bootstrapCause = reason;
    const recordDiagnostic = (toolAbsence, classificationAttempted) => {
      if (reason === 'observed') return;
      // Snapshot only; it never supplies readiness, classification or cleanup authority.
      let readyBudgetExpired = true;
      try { readyBudgetExpired = deadline.remaining('ready') === 0; } catch { /* Unknown clock remains failed. */ }
      facts.bootstrapDiagnostic = captureBootstrapDiagnostic({
        bootstrapCause, wrapper, stderr, stderrFailed, stderrEnded, replies, toolAbsence,
        readyAccepted: ready, goAttempted: Boolean(facts.go), emergencyUsed: emergency,
        readyBudgetExpired, classificationAttempted,
      });
    };
    if (wrapper && !ready && !facts.go && !emergency && reason !== 'deadlineExceeded' &&
        deadline.remaining('ready') > 0) {
      // spawn ENOENT can also mean a missing cwd or interpreter. Prove tool absence
      // in the exact fixed search path before calling it a missing prerequisite.
      let toolAbsent = false;
      let toolAbsence = 'notChecked';
      if (wrapper.spawnCode === 'ENOENT') {
        toolAbsence = 'notProven';
        try {
          check('wrapper');
          const present = [];
          for (const directory of childEnvironment().PATH.split(':')) {
            try { await fs.access(posix.join(directory, 'unshare')); present.push(true); }
            catch (error) { if (error?.code !== 'ENOENT') throw error; present.push(false); }
            check('wrapper');
          }
          toolAbsent = present.every(value => !value);
          if (toolAbsent) toolAbsence = 'provenAbsent';
        } catch { /* Unknown read failures cannot prove absence. */ }
      }
      recordDiagnostic(toolAbsence, true);
      const prerequisite = classifyBootstrap({
        spawnCode: wrapper.spawnCode, code: wrapper.code, signal: wrapper.signal,
        stderr, ready, go: Boolean(facts.go), toolAbsent, responseBytes: replies?.receivedBytes,
        streamsClosed: wrapper.closed && stderrEnded && !stderrFailed && replies?.ended,
      });
      if (prerequisite !== 'bootstrapUnknown') reason = prerequisite;
      else if (!['deadlineExceeded', 'channelLimit', 'invalidMessage'].includes(reason)) reason = 'bootstrapUnknown';
    } else {
      recordDiagnostic('notChecked', false);
    }
    if (sentinel) {
      let after = false;
      try { await challengeSentinel('sentinel'); after = true; } catch { /* Still stop this separately owned child. */ }
      try {
        check('sentinel');
        await wait(writeMessage(sentinel.child.stdin, message('STOP', sentinelGeneration), deadline, 'sentinel'), 'sentinel');
        await wait(sentinel.completion, 'sentinel');
        sentinelReplies.closed();
        requireCondition(sentinel.exited && sentinel.code === 0 && sentinel.signal === null &&
          !sentinel.spawnCode && !sentinel.inputFailed, 'sentinelFailed');
        facts.sentinel = sentinelBefore && after;
      } catch {
        emergencyStop(sentinel);
      }
      if (!sentinel.closed) {
        try { await wait(sentinel.completion, 'report'); } catch { /* Retain uncertainty and root. */ }
      }
    }
    if (wrapper && !wrapper.closed) {
      try { await wait(wrapper.completion, 'report'); } catch { /* Never infer destruction from emergency stop. */ }
    }
    time.clearTimeout(emergencyTimer);
  }
  if (reason === 'observed' && !facts.sentinel) reason = 'sentinelFailed';
  if (reason === 'observed') {
    try {
      check('report');
      const metadata = await fs.lstat(root);
      requireCondition(metadata.isDirectory() && !metadata.isSymbolicLink() && await fs.realpath(root) === root &&
        dirname(root) === temp, 'rootFailed');
      check('report');
      // Empty synthetic cwd only; never recursive deletion or a user-selected path.
      facts.removalStarted = true;
      await fs.rmdir(root);
      facts.removed = true;
      check('report');
    } catch (error) { reason = safeReason(error); }
  }
  return resultFor(binding, { ...facts, reason });
}

export function runPidNamespaceCli({
  argv, environment, platform, now = () => process.hrtime.bigint(), time = globalThis,
  writeLine = (line, done) => process.stdout.write(line, done), exit = code => process.exit(code),
  ...operations
}) {
  const started = now().toString();
  const deadline = createDeadline(started, now);
  const binding = experimentContext(argv, environment);
  const facts = {};
  let ended = false;
  let published = false;
  let timer;
  return new Promise(resolve => {
    const end = code => {
      if (ended) return;
      try { deadline.check('report'); } catch { code = 1; }
      ended = true;
      time.clearTimeout(timer);
      try { exit(code); } finally { resolve(code); }
    };
    const publish = result => {
      if (ended || published) return;
      let line;
      try { line = serializeResult(result, binding); }
      catch { line = serializeResult(resultFor(binding, { ...facts, reason: 'reportFailed' }), binding); }
      published = true;
      const code = JSON.parse(line).evidenceOutcome === 'complete' ? 0 : 1;
      try { writeLine(line, error => end(error ? 1 : code)); } catch { end(1); }
    };
    timer = time.setTimeout(() => {
      publish(resultFor(binding, { ...facts, reason: 'deadlineExceeded' }));
      end(1);
    }, deadline.remaining('report'));
    if (!binding) { publish(resultFor(null, { reason: 'invalidContext' })); return; }
    void runNamespaceExperiment({
      ...operations, binding, started, facts, platform, now, time, isEnded: () => ended,
    }).then(publish, () => publish(resultFor(binding, { ...facts, reason: 'experimentFailed' })));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.on('error', () => process.exit(1));
  await runPidNamespaceCli({ argv: process.argv.slice(2), environment: process.env, platform: process.platform });
}

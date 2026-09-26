import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as filesystem from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validEvidenceBinding } from './linuxPrerequisiteContract.mjs';
import { managedLaunchCommand, validateManagedWorkload } from './managedNamespaceLaunchContract.mjs';
import { readManagedChromiumFailure, validateManagedChromiumDiagnostic } from './managedChromiumFailure.mjs';
import { inspectManagedRoot } from './managedNamespaceRoot.mjs';
import { createManagedResult, managedFailure, serializeManagedResult,
  validateManagedSessionResult } from './managedNamespaceResult.mjs';
import { runManagedSession } from './managedNamespaceSession.mjs';
import { currentIdentity } from './pidNamespaceActor.mjs';
import { actorArguments, childEnvironment, createDeadline, descriptors, experimentContext,
  message, requireCondition, responseChannel, validateIdentity, waitWithin, writeMessage,
} from './pidNamespaceContract.mjs';
import { emergencyStop, watchChild } from './runPidNamespaceExperiment.mjs';

function initialState(workload = 'actor') {
  return { session: null, failure: null, cleanupFailure: null, root: 'notCreated',
    sentinel: { started: false, before: false, after: false, closed: false, normalExit: false },
    ...(workload === 'chromium' ? { chromiumFailure: { status: 'unavailable', phase: null, reason: null } } : {}) };
}

// A normal namespace receipt and an independently preserved sentinel are both
// required. Failed/ambiguous launches never grant authority to remove the root.
export async function runManagedExperiment({ binding, started, workload = 'actor', state = initialState(workload), runtime = process,
  fs = filesystem, hostFs, tempDirectory = tmpdir, createListener, spawnChild = spawn,
  nonce = () => randomBytes(16).toString('hex'), now = () => process.hrtime.bigint(),
  time = globalThis, session = runManagedSession, isEnded = () => false,
  readChromiumFailure = readManagedChromiumFailure,
}) {
  const deadline = createDeadline(started, now);
  const check = phase => { requireCondition(!isEnded(), 'deadlineExceeded'); deadline.check(phase); };
  const wait = (promise, phase) => waitWithin(promise, deadline, phase, time);
  let stage = 'context';
  let root;
  let rootReceipt;
  let ids;
  let failureScope;
  let sentinel;
  let replies;
  let sentinelGeneration;
  let sentinelTimer;
  let emergencyAttempted = false;
  const stopSentinel = () => {
    if (emergencyAttempted) return;
    emergencyAttempted = true;
    emergencyStop(sentinel);
  };
  const challenges = new Set();
  const challenge = async phase => {
    check(phase);
    requireCondition(sentinel && !sentinel.exited && !sentinel.closed && !sentinel.inputFailed &&
      !sentinel.spawnCode, 'sentinelFailed');
    const token = nonce();
    requireCondition(!challenges.has(token), 'invalidArguments');
    challenges.add(token);
    const response = replies.expect('ALIVE', sentinelGeneration, phase, token);
    await wait(writeMessage(sentinel.child.stdin, message('CHALLENGE', sentinelGeneration, token),
      deadline, phase), phase);
    await wait(response, phase);
    replies.check();
    requireCondition(!replies.ended && !sentinel.exited && !sentinel.closed && !sentinel.inputFailed,
      'sentinelFailed');
    check(phase);
  };
  try {
    validateManagedWorkload(workload);
    requireCondition(validEvidenceBinding(binding) && runtime.platform === 'linux' &&
      runtime.env.EKY_E2E === '1' && runtime.env.CI === 'true' && runtime.env.GITHUB_ACTIONS === 'true',
    'invalidContext');
    check('ready');
    ids = currentIdentity(runtime);
    validateIdentity(ids, ids);
    stage = 'root';
    const temp = fs.realpathSync(tempDirectory());
    check('ready');
    root = fs.mkdtempSync(posix.join(temp, 'eky-managed-ns-'));
    state.root = 'retained';
    check('ready');
    rootReceipt = inspectManagedRoot(root, ids, { fs, tempDirectory });
    const config = Object.freeze({ generation: nonce(), started, uid: ids.uid, gid: ids.gid, root,
      node: fs.realpathSync(runtime.execPath),
      init: fs.realpathSync(fileURLToPath(new URL('./managedNamespaceInit.mjs', import.meta.url))),
      ...(workload === 'chromium' ? { workload } : {}) });
    managedLaunchCommand(config);
    failureScope = Object.freeze({ root, generation: config.generation, uid: ids.uid, gid: ids.gid,
      rootReceipt, tempRoot: temp });
    sentinelGeneration = nonce();
    requireCondition(config.generation !== sentinelGeneration, 'invalidArguments');
    const args = actorArguments({ ...config, generation: sentinelGeneration }, 'sentinel');
    stage = 'sentinelStart';
    check('ready');
    sentinel = watchChild(spawnChild(config.node,
      [fileURLToPath(new URL('./pidNamespaceActor.mjs', import.meta.url)), ...args], {
        cwd: root, env: childEnvironment(), shell: false, detached: false, stdio: [...descriptors.sentinel],
      }));
    state.sentinel.started = true;
    // A pending session must not defer cleanup of this independently owned child.
    sentinelTimer = time.setTimeout(() => {
      if (sentinel.closed) return;
      state.cleanupFailure ??= managedFailure('sentinelStop', { reason: 'deadlineExceeded' });
      stopSentinel();
    }, deadline.remaining('sentinel'));
    sentinel.child.once('close', () => {
      state.sentinel.closed = true;
      time.clearTimeout(sentinelTimer);
    });
    replies = responseChannel(sentinel.child.stdio[3], deadline, time);
    stage = 'session';
    const result = await session({ config, runtime, fs, hostFs, tempDirectory,
      createListener, spawnChild, now, time, beforeGo: async () => {
        check('ready');
        inspectManagedRoot(root, ids, { fs, tempDirectory, previous: rootReceipt });
        await challenge('ready');
        state.sentinel.before = true;
      } });
    validateManagedSessionResult(result);
    state.session = structuredClone(result);
    state.failure = result.failure;
    if (result.outcome === 'observed') requireCondition(state.sentinel.before, 'sentinelFailed');
  } catch (error) {
    state.failure ??= managedFailure(stage, error);
  } finally {
    if (sentinel) {
      try {
        await challenge('sentinel');
        state.sentinel.after = true;
      } catch (error) { state.failure ??= managedFailure('sentinelAfter', error); }
      try {
        check('sentinel');
        requireCondition(!sentinel.exited && !sentinel.closed && !sentinel.spawnCode &&
          !sentinel.inputFailed, 'sentinelFailed');
        await wait(writeMessage(sentinel.child.stdin, message('STOP', sentinelGeneration),
          deadline, 'sentinel'), 'sentinel');
        await wait(sentinel.completion, 'sentinel');
        replies.closed();
        requireCondition(sentinel.exited && sentinel.code === 0 && sentinel.signal === null &&
          !sentinel.spawnCode && !sentinel.inputFailed, 'sentinelFailed');
        state.sentinel.normalExit = true;
      } catch (error) {
        state.cleanupFailure ??= managedFailure('sentinelStop', error);
        // This child handle is separate from the manager unit; never signal by PID.
        stopSentinel();
      }
      if (!sentinel.closed) {
        try { await wait(sentinel.completion, 'report'); }
        catch (error) { state.cleanupFailure ??= managedFailure('sentinelStop', error); }
      }
      state.sentinel.closed = sentinel.closed;
      time.clearTimeout(sentinelTimer);
    }
  }
  if (workload === 'chromium' && failureScope) {
    try {
      check('report');
      const diagnostic = validateManagedChromiumDiagnostic(readChromiumFailure(failureScope, { fs, runtime }));
      check('report');
      state.chromiumFailure = diagnostic;
      if (diagnostic.status !== 'absent') state.failure ??= managedFailure('workload', { reason: 'workloadFailed' });
    } catch {
      state.failure ??= managedFailure('report', { reason: 'reportFailed' });
    }
  }
  if (state.session?.outcome === 'observed' && !state.failure && !state.cleanupFailure &&
      state.sentinel.before && state.sentinel.after && state.sentinel.closed && state.sentinel.normalExit &&
      (workload !== 'chromium' || state.chromiumFailure.status === 'absent')) {
    try {
      check('report');
      validateIdentity(currentIdentity(runtime), ids);
      inspectManagedRoot(root, ids, { fs, tempDirectory, previous: rootReceipt });
      check('report');
      // The listener owns its socket's removal on close. Do not unlink leftovers
      // or recursively delete: an unexpected file must retain this synthetic root.
      state.root = 'removalUnverified';
      fs.rmdirSync(root);
      state.root = 'removed';
      check('report');
    } catch (error) { state.failure = managedFailure('rootRemoval', error); }
  }
  return createManagedResult(binding, state, workload);
}

export function runManagedNamespaceCli({ argv, runtime = process,
  now = () => process.hrtime.bigint(), time = globalThis,
  writeLine = (line, done) => process.stdout.write(line, done), exit = code => process.exit(code),
  ...operations
}) {
  const started = now().toString();
  const deadline = createDeadline(started, now);
  const selected = Array.isArray(argv) && argv.length === 3 && ['--workload=actor', '--workload=chromium'].includes(argv[2])
    ? argv[2].slice(11) : null;
  const workload = selected ?? 'actor';
  const binding = experimentContext(selected ? argv.slice(0, 2) : argv, runtime.env);
  const state = initialState(workload);
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
    const publish = () => {
      if (ended || published) return;
      let result;
      let line;
      try {
        result = createManagedResult(binding, state, workload);
        line = serializeManagedResult(result, binding, workload);
      } catch {
        // Missing evidence fails the caller. Do not replace invalid evidence with
        // invented not-started/not-created facts after side effects may exist.
        end(1);
        return;
      }
      published = true;
      try { writeLine(line, error => end(error ? 1 : result.evidenceOutcome === 'complete' ? 0 : 1)); }
      catch { end(1); }
    };
    timer = time.setTimeout(() => {
      state.failure ??= managedFailure('report', { reason: 'deadlineExceeded' });
      publish();
      end(1);
    }, deadline.remaining('report'));
    if (!binding) { state.failure = managedFailure('context', { reason: 'invalidContext' }); publish(); return; }
    void runManagedExperiment({ ...operations, binding, started, workload, state, runtime, now, time,
      isEnded: () => ended }).then(publish, error => {
      state.failure ??= managedFailure('report', error);
      publish();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.on('error', () => process.exit(1));
  await runManagedNamespaceCli({ argv: process.argv.slice(2) });
}

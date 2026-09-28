import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as filesystem from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';
import { childEnvironment, exactKeys, failureExit, waitWithin } from './pidNamespaceContract.mjs';
import { guardLinuxService, serviceDeadlines, servicePath } from './linuxServiceContract.mjs';
import { inspectManagedRoot } from './managedNamespaceRoot.mjs';
import { consumerLossCase, linuxConsumerPhases, requireConsumerLoss } from './linuxConsumerLossContract.mjs';
import { consumerLossRecords, waitConsumerLossRecord } from './linuxConsumerLossRecords.mjs';
import { validateConsumerLossOutcome } from './linuxConsumerLossOutcome.mjs';
import { openLinuxConsumerExchange } from './linuxConsumerExchange.mjs';
import { createLinuxConsumerCommandGate } from './linuxConsumerCommandGate.mjs';
import { createLinuxConsumerObserver } from './linuxConsumerObserver.mjs';
import { startLinuxConsumerSentinel } from './linuxConsumerSentinel.mjs';
import { watchChild, emergencyStop } from './runPidNamespaceExperiment.mjs';
import { observeBoundedChildOutput } from './boundedChildOutput.mjs';

export const consumerCaseStages = Object.freeze(['context', 'root', 'callerStart', 'registration',
  'readiness', 'sentinelBefore', 'fault', 'passive', 'callerClose', 'result', 'retention',
  'takeover', 'sentinelAfter', 'commandsClose', 'complete']);

export function readConsumerFailurePhase(bytes) {
  const prefix = 'EKY_LINUX_CONSUMER_FAILURE ';
  const lines = bytes.toString('utf8').split('\n').slice(0, -1).filter(line => line.startsWith(prefix));
  if (lines.length !== 1 || lines[0].length > 512) return null;
  try {
    const value = JSON.parse(lines[0].slice(prefix.length));
    return exactKeys(value, ['schemaVersion', 'operation', 'phase', 'errorCode']) && value.schemaVersion === 1 &&
      value.operation === 'consumerLoss' && value.errorCode === 'E2E_LINUX_CONSUMER_LOSS_UNVERIFIED' &&
      linuxConsumerPhases.includes(value.phase) ? value.phase : null;
  } catch { return null; }
}

// No fixture root is deleted here. Healthy roots are removed by their real
// fixture; fault evidence and uncertain roots stay retained for this CI case.
export async function runLinuxConsumerLossCase({ caseId, repositoryRoot, actorEntry, config, createRunRoot }, {
  runtime = process, fs = filesystem, tempDirectory = tmpdir, spawnChild = spawn,
  now = () => process.hrtime.bigint(), time = globalThis, nonce = () => randomBytes(16).toString('hex'),
  guard = guardLinuxService, openExchange = openLinuxConsumerExchange,
  createObserver = createLinuxConsumerObserver, startSentinel = startLinuxConsumerSentinel,
  waitRecord = waitConsumerLossRecord,
} = {}) {
  const selected = consumerLossCase(caseId);
  const state = { caseId, stage: 'context', outcome: 'incomplete', registered: 0, passive: 0,
    callerClosed: false, commandsClosed: false, sentinelPreserved: false,
    retentionVerified: false, takeover: 'notAttempted', forcedCaller: false, callerFailurePhase: null };
  const commands = createLinuxConsumerCommandGate({ spawnChild });
  const leafCommands = createLinuxConsumerCommandGate({ spawnChild });
  let deadline;
  let root;
  let rootReceipt;
  let identity;
  let caller;
  let output;
  let observer;
  let sentinel;
  let timer;
  let failure;
  let callerCommandsProven = false;
  let observersSettled = false;
  const observerTasks = [];
  const passiveTasks = [];
  const fail = error => { failure ??= error; };
  const stopCaller = () => {
    if (caller && !caller.closed) { state.forcedCaller = true; emergencyStop(caller); }
  };
  const check = (phase = 'work') => deadline.check(phase);
  const stage = name => { requireConsumerLoss(consumerCaseStages.includes(name)); state.stage = name; };
  const inspectRunRoot = path => {
    servicePath(path);
    const stat = fs.lstatSync(path);
    requireConsumerLoss(posix.dirname(path) === posix.join(fs.realpathSync(tempDirectory()), 'eky-e2e') &&
      /^run-[A-Za-z0-9-]+$/u.test(posix.basename(path)) && fs.realpathSync(path) === path &&
      stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === identity.uid && stat.gid === identity.gid &&
      (stat.mode & 0o7777) === 0o700);
    return { dev: stat.dev, ino: stat.ino };
  };
  const verifyRetention = (path, retained, previous) => {
    if (retained) {
      const current = inspectRunRoot(path);
      requireConsumerLoss(current.dev === previous.dev && current.ino === previous.ino);
    } else {
      let absent = false;
      try { fs.lstatSync(path); } catch (error) { if (error?.code === 'ENOENT') absent = true; else throw error; }
      requireConsumerLoss(absent);
    }
  };
  try {
    identity = guard(runtime);
    requireConsumerLoss(Number.isSafeInteger(config.timeout) && config.timeout > 0 &&
      Number.isSafeInteger(config.globalTimeout) && config.globalTimeout >= config.timeout && config.workers === 1);
    const until = (now() + BigInt(config.timeout) * 1_000_000n).toString();
    deadline = serviceDeadlines({ startUntil: until, workUntil: until }, now);
    stage('root');
    root = fs.mkdtempSync(posix.join(fs.realpathSync(tempDirectory()), 'eky-managed-ns-'));
    rootReceipt = inspectManagedRoot(root, identity, { fs, tempDirectory });
    const auxiliaryRoot = createRunRoot();
    inspectRunRoot(auxiliaryRoot);
    const actorNonce = nonce();
    const exchange = openExchange({ root, identity: { uid: identity.uid, gid: identity.gid }, nonce: actorNonce,
      caseId, role: 'observer', records: consumerLossRecords(caseId) });
    observer = createObserver({ caseId, exchange, deadline, commands, callerClosed: () => caller?.closed === true });
    stage('callerStart'); check();
    const values = { root, nonce: actorNonce, caseId, repositoryRoot, auxiliaryRoot, until };
    caller = watchChild(leafCommands.spawnChild(runtime.execPath,
      [actorEntry, ...Object.entries(values).map(([key, value]) => `--${key}=${value}`)], {
        cwd: repositoryRoot, env: childEnvironment(), shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'],
      }));
    output = observeBoundedChildOutput(caller.child);
    timer = time.setTimeout(stopCaller, deadline.remaining('wrapper'));
    caller.child.once('close', () => time.clearTimeout(timer));
    stage('registration');
    for (const profile of selected.profiles) {
      const task = observer.register(profile);
      task.catch(fail); observerTasks.push(task);
      await output.guard(task);
    }
    stage('readiness');
    const ready = await output.guard(waitRecord(exchange, 'ready.json', deadline, 'work', time));
    const testReceipt = inspectRunRoot(ready.testRoot);
    const workerReceipt = ready.workerRoot === null ? null : inspectRunRoot(ready.workerRoot);
    requireConsumerLoss(ready.testRoot !== auxiliaryRoot && ready.workerRoot !== auxiliaryRoot &&
      (ready.admissionDirectory === null || ready.admissionDirectory === posix.join(auxiliaryRoot, 'admission')));
    stage('sentinelBefore'); check();
    sentinel = startSentinel({ root, identity, outerDeadline: deadline }, { runtime, spawnChild, now, time, nonce });
    await waitWithin(sentinel.before(), deadline, 'work', time);
    requireConsumerLoss(!caller.exited && !caller.closed && !state.forcedCaller);
    stage('fault');
    for (const profile of selected.profiles.filter(profile => selected.profile === null || profile === selected.profile)) {
      const task = observer.observePassive(profile);
      task.catch(fail); passiveTasks.push(task); observerTasks.push(task);
    }
    check(); exchange.publish('grant.json', { caseId }); check();
    stage('passive');
    await output.guard(waitWithin(Promise.all(passiveTasks), deadline, 'wrapper', time));
    stage('callerClose');
    await output.guard(waitWithin(caller.completion, deadline, 'wrapper', time));
    await leafCommands.drain(deadline, 'wrapper');
    leafCommands.seal(); leafCommands.verifySealed();
    requireConsumerLoss(!state.forcedCaller && caller.exited && caller.closed && caller.signal === null &&
      caller.spawnCode === null && caller.code === (selected.cause === 'caller' ? failureExit : 0));
    stage('result');
    const result = selected.cause === 'caller' ? null
      : await waitRecord(exchange, 'result.json', deadline, 'wrapper', time);
    if (result !== null) validateConsumerLossOutcome(result, caseId);
    // Only the validated final receipt or the deliberately armed sealed caller
    // exit proves its internal command handles. An early abort never does.
    callerCommandsProven = true;
    stage('retention');
    verifyRetention(ready.testRoot, result === null || result.fixtureCleanup.runRoot === 'retained', testReceipt);
    if (workerReceipt) {
      const retained = result === null || result.workerCleanup.workerRoot === 'retained';
      verifyRetention(ready.workerRoot, retained, workerReceipt);
      requireConsumerLoss(fs.existsSync(posix.join(ready.admissionDirectory, '.eky-chromium-worker-pending.json')) === retained);
    }
    check('wrapper'); state.retentionVerified = true;
    if (selected.cause === 'caller') {
      stage('takeover'); state.takeover = 'unverified';
      await observer.containAfterCallerClosed(); state.takeover = 'completed';
    }
  } catch (error) { fail(error); }
  finally {
    observer?.stopAdmission();
    if (caller && !caller.closed) {
      try { await waitWithin(caller.completion, deadline, 'wrapper', time); }
      catch (error) { fail(error); stopCaller(); }
    }
    // Pending observations retain the same deadline; no next case starts while
    // an earlier observer can still issue a manager command.
    if (deadline) {
      try {
        await waitWithin(Promise.allSettled(observerTasks), deadline, 'wrapper', time);
        observersSettled = true;
      }
      catch (error) { fail(error); }
    }
    if (failure && observer && observersSettled && caller?.closed && state.takeover === 'notAttempted') {
      state.takeover = 'unverified';
      try { await observer.containAfterCallerClosed(); state.takeover = 'completed'; }
      catch (error) { fail(error); }
    }
    if (sentinel) {
      if (!failure) stage('sentinelAfter');
      try { await waitWithin(sentinel.finish(), deadline, 'wrapper', time); state.sentinelPreserved = true; }
      catch (error) { fail(error); }
    }
    if (deadline) {
      if (!failure) stage('commandsClose');
      try {
        await commands.drain(deadline, 'wrapper');
        await leafCommands.drain(deadline, 'wrapper');
        commands.seal(); commands.verifySealed();
        leafCommands.seal(); leafCommands.verifySealed();
        state.commandsClosed = callerCommandsProven;
        if (root) inspectManagedRoot(root, identity, { fs, tempDirectory, previous: rootReceipt });
        check('wrapper');
      } catch (error) { fail(error); }
      finally {
        // Even an unsuccessful drain permanently closes command admission.
        try { commands.seal(); } catch (error) { fail(error); }
        try { leafCommands.seal(); } catch (error) { fail(error); }
      }
    }
    if (timer !== undefined) time.clearTimeout(timer);
    state.callerClosed = caller?.closed === true;
    if (output) state.callerFailurePhase = readConsumerFailurePhase(output.output);
    if (observer) {
      const observed = observer.readState(); state.registered = observed.registered; state.passive = observed.passive;
      if (!observed.complete) fail(new Error('E2E_LINUX_CONSUMER_LOSS_UNVERIFIED'));
    }
  }
  if (!failure && state.callerFailurePhase === null && state.registered === selected.profiles.length &&
      state.passive === (selected.cause === 'caller' ? selected.profiles.length : 1) &&
      state.callerClosed && state.commandsClosed && state.sentinelPreserved && state.retentionVerified) {
    state.outcome = 'complete'; state.stage = 'complete';
  }
  return Object.freeze(state);
}

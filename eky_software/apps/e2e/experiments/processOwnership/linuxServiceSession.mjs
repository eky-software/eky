import { randomUUID } from 'node:crypto';
import { waitWithin } from './pidNamespaceContract.mjs';
import { inspectManagedHost } from './managedNamespacePreflight.mjs';
import { prepareLinuxService, removeLinuxServiceControl } from './linuxServiceConfiguration.mjs';
import { createLinuxServiceManager } from './linuxServiceManager.mjs';
import { listenLinuxServiceControl } from './linuxServiceControl.mjs';
import { requireService, serviceDeadlines, serviceFailure, linuxChromiumPaths } from './linuxServiceContract.mjs';
import { encodeLinuxServiceDiagnostic, projectLinuxServiceCause } from './linuxServiceDiagnostic.mjs';

export class OwnedLinuxServiceStartupFailure extends Error {
  constructor(profile, evidence, output) {
    super(profile === 'backend' ? 'E2E_BACKEND_OWNER_START_FAILED' : profile === 'chromium'
      ? 'E2E_CHROMIUM_OWNER_START_FAILED' : 'E2E_VITE_OWNER_START_FAILED');
    this.evidence = Object.freeze({ spawnObserved: evidence.spawnObserved,
      exitedBeforeCleanup: evidence.exitedBeforeCleanup, processTree: evidence.processTree,
      startupFailure: evidence.startupFailure });
    this.readStdout = output.readStdout;
    this.readStderr = output.readStderr;
  }
}

export async function startLinuxService(profile, input, {
  prepare = prepareLinuxService, preflight = inspectManagedHost, createManager = createLinuxServiceManager,
  listen = listenLinuxServiceControl, removeControl = removeLinuxServiceControl,
  now = () => process.hrtime.bigint(), time = globalThis,
  reportFailure = value => process.stdout.write('\n' + encodeLinuxServiceDiagnostic(value)),
} = {}) {
  let phase = 'prepare';
  let prepared;
  let deadline;
  let manager;
  let control;
  let firstFailure;
  let state = Object.freeze({ spawnObserved: false, terminal: undefined });
  const listeners = new Set();
  let stdout = '';
  let stderr = '';
  let exitedBeforeCleanup = false;
  let stopping = false;
  let stopped = false;
  let observationLost = false;
  let completed = false;
  let stopResult;
  let workTimer;
  let queue = Promise.resolve();
  let rejectAdmission;
  const admissionClosed = new Promise((_, reject) => { rejectAdmission = reject; });
  void admissionClosed.catch(() => {});
  const output = Object.freeze({ readStdout: () => stdout, readStderr: () => stderr });
  const failure = () => new OwnedLinuxServiceStartupFailure(profile, {
    spawnObserved: state.spawnObserved, exitedBeforeCleanup, processTree: stopped ? 'stopped' : 'unverified',
    startupFailure: firstFailure ?? 'observationLost',
  }, output);
  const record = reason => { firstFailure ??= reason; rejectAdmission(serviceFailure(firstFailure)); };
  const publish = next => {
    if (state.terminal !== undefined) return;
    state = Object.freeze(next);
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try { listener(state); } catch { record('observationLost'); }
    }
    if (state.terminal !== undefined) {
      listeners.clear(); rejectAdmission(serviceFailure(state.terminal === 'exited' ? 'workloadExited' : 'observationLost'));
    }
  };
  const lose = () => {
    if (observationLost) return;
    observationLost = true; record('observationLost');
    publish({ ...state, terminal: 'observationLost' });
    if (completed) void stop().catch(() => {});
  };
  const onReply = value => {
    stdout = value.stdout; stderr = value.stderr;
    if (stopping) return;
    if (!stopping && value.state === 'exited') exitedBeforeCleanup = true;
    publish({ spawnObserved: state.spawnObserved || value.spawned,
      terminal: value.state === 'exited' ? 'exited' : value.state === 'unavailable'
        ? value.spawned ? 'observationLost' : 'spawnFailed' : undefined });
    if ((!completed || profile === 'chromium') && value.state === 'exited') record('workloadExited');
    if (value.state === 'unavailable') lose();
  };
  const serialize = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const wait = (promise, phase) => waitWithin(promise, deadline, phase, time);
  async function cleanup() {
    try {
      requireService(control && manager && !observationLost, 'cleanupUnverified');
      await wait(serialize(() => control.request('stop')), 'wrapper');
      await wait(control.closed, 'wrapper');
      control.verifyClosed();
      for (;;) {
        const observation = await wait(manager.observe(), 'wrapper');
        if (observation.waitingWrapper === 'normalExit') break;
        await wait(new Promise(resolve => time.setTimeout(resolve, 25)), 'wrapper');
      }
      await manager.settle();
      deadline.check('wrapper');
      removeControl(prepared);
      deadline.check('wrapper');
      stopped = true;
    } catch {
      // A manager stop is containment only. Never promote it to namespace or
      // fixture-root deletion evidence, even if its command exits successfully.
      try { await wait(control?.dispose(), 'wrapper'); } catch { /* Keep first failure. */ }
      try { await wait(manager?.emergencyStop(), 'wrapper'); } catch { /* Keep uncertainty. */ }
      try { await wait(manager?.settle(), 'wrapper'); } catch { /* Actual command close still required. */ }
      throw failure();
    } finally { time.clearTimeout(workTimer); }
    if (firstFailure !== undefined) throw failure();
  }
  function stop() {
    if (stopResult) return stopResult;
    stopping = true;
    rejectAdmission(serviceFailure('observationLost'));
    try { deadline.beginCleanup(); }
    catch { record('startupDeadlineExceeded'); }
    stopResult = Promise.resolve().then(cleanup);
    stopResult.catch(() => {});
    return stopResult;
  }
  try {
    prepared = prepare(profile, input);
    deadline = serviceDeadlines(prepared.config, now);
    phase = 'preflight';
    await preflight({ deadline });
    deadline.check('ready');
    phase = 'managerPrepare';
    manager = createManager(prepared.config, deadline);
    await wait(manager.prepare(), 'ready');
    phase = 'controlListen';
    control = listen(prepared, deadline, onReply, lose);
    await wait(control.opened, 'ready');
    phase = 'managerLaunch';
    await wait(manager.launch(), 'ready');
    phase = 'controlReady';
    await wait(control.ready, 'ready');
    phase = 'managerOwn';
    await wait(manager.own(), 'ready');
    requireService(!observationLost, 'observationLost');
    phase = 'workloadStart';
    const started = await wait(serialize(() => control.request('go')), 'ready');
    requireService(started.state === 'running' && state.spawnObserved && state.terminal === undefined &&
      !observationLost, started.state === 'exited' ? 'workloadExited' : 'launchFailed');
    completed = true;
    workTimer = time.setTimeout(() => {
      record('startupDeadlineExceeded');
      publish({ ...state, terminal: 'observationLost' });
      void stop().catch(() => {});
    }, deadline.remaining('work'));
  } catch (error) {
    const cause = projectLinuxServiceCause(error);
    record(error?.reason === 'deadlineExceeded' ? 'startupDeadlineExceeded'
      : ['preparationFailed', 'startupDeadlineExceeded', 'launchFailed', 'workloadExited', 'observationLost']
      .includes(error?.reason) ? error.reason : prepared ? 'observationLost' : 'preparationFailed');
    if (!manager?.mayHaveStarted()) {
      try {
        deadline?.beginCleanup();
        if (control) await wait(control.dispose(), 'wrapper');
        if (manager) await manager.settle();
        if (prepared) removeControl(prepared);
        stopped = error?.preparationCleanupUnverified !== true;
      } catch { /* Even prelaunch command closure must be verified. */ }
    } else {
      try { await stop(); } catch { /* Preserve original startup classification separately. */ }
    }
    const original = failure();
    try {
      reportFailure({ schemaVersion: 1, profile, phase, ...cause,
        startupFailure: original.evidence.startupFailure,
        spawnObserved: original.evidence.spawnObserved, processTree: original.evidence.processTree });
    } catch { /* Reporting cannot replace the original failure or cleanup evidence. */ }
    throw original;
  }
  const requireStartupOpen = () => {
    deadline.check('ready');
    requireService(!stopping && !observationLost && firstFailure === undefined && state.terminal === undefined,
      state.terminal === 'exited' ? 'workloadExited' : 'observationLost');
  };
  const connectionOwner = profile !== 'chromium' ? {} : { connectionOwner: Object.freeze({
    readyPath: linuxChromiumPaths(prepared.config).ready, generation: prepared.config.browserGeneration,
    requireStartupOpen,
    async beforeStartupDeadline(operation) {
      try {
        const value = await wait(Promise.race([operation, admissionClosed]), 'ready');
        requireStartupOpen();
        return value;
      } catch (error) {
        if (error?.reason === 'deadlineExceeded' || error?.reason === 'startupDeadlineExceeded') record('startupDeadlineExceeded');
        throw error;
      }
    },
    readStartupRemainingMilliseconds() { requireStartupOpen(); return deadline.remaining('ready'); },
    stop,
    readCleanupRemainingMilliseconds: () => deadline.remaining('wrapper'),
    readCleanupEvidence: () => Object.freeze({ processTree: stopped ? 'stopped' : 'unverified',
      firstFailure: firstFailure ?? null }),
  }) };
  return Object.freeze({ ...output, ...connectionOwner,
    startup: Object.freeze({ readState: () => state, subscribe(listener) {
      if (state.terminal === undefined) listeners.add(listener);
      return () => { listeners.delete(listener); };
    } }),
    workload: Object.freeze({
      instanceId: randomUUID(),
      async readState() {
        if (stopped) return 'exited';
        if (stopping || observationLost) return 'unavailable';
        try {
          const reply = await serialize(() => {
            requireService(!stopping && !observationLost, 'observationLost');
            return control.request('status');
          });
          return stopping || observationLost ? 'unavailable' : state.terminal === 'exited' ? 'exited' : reply.state;
        } catch { lose(); return 'unavailable'; }
      },
      async readRssBytes() {
        try {
          requireService(!stopping && !observationLost, 'observationLost');
          const reply = await serialize(() => {
            requireService(!stopping && !observationLost, 'observationLost');
            return control.request('rss');
          });
          requireService(!stopping && !observationLost && state.terminal === undefined && reply.state === 'running' &&
            Number.isSafeInteger(reply.rssBytes) && reply.rssBytes > 0, 'observationLost');
          return reply.rssBytes;
        } catch { throw new Error(profile === 'backend' ? 'E2E_BACKEND_RSS_UNAVAILABLE'
          : profile === 'vite' ? 'E2E_VITE_RSS_UNAVAILABLE' : 'E2E_CHROMIUM_RSS_UNAVAILABLE'); }
      },
    }), stop,
  });
}

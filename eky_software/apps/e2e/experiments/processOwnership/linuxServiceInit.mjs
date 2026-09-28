import * as filesystem from 'node:fs';
import { Socket } from 'node:net';
import { pathToFileURL } from 'node:url';
import { expectedEofExit, failureExit } from './pidNamespaceContract.mjs';
import { validateManagedInitStatus } from './managedNamespaceIdentity.mjs';
import { inspectManagedRoot, inspectManagedSocket } from './managedNamespaceRoot.mjs';
import { linuxServiceWorkload, managedControlPath, readLinuxServiceConfig } from './linuxServiceConfiguration.mjs';
import { encodeServiceMessage, guardLinuxService, requireService, serviceDeadlines, serviceFrames,
  serviceMessage, validateServiceMessage } from './linuxServiceContract.mjs';
import { spawnLinuxServiceWorkload } from './linuxServiceWorkload.mjs';

export function runLinuxServiceInit(root, {
  runtime = process, fs = filesystem, tempDirectory, socket = options => new Socket(options),
  now = () => process.hrtime.bigint(), time = globalThis, spawnWorkload = spawnLinuxServiceWorkload,
} = {}) {
  let finished = false;
  let timer;
  let channel;
  const finish = code => {
    if (finished) return;
    finished = true; time.clearTimeout(timer);
    // Exiting PID 1 invokes kernel namespace teardown. The caller must still
    // observe the original waiting wrapper's exit; this call is not that proof.
    runtime.exit(code);
  };
  try {
    guardLinuxService(runtime);
    requireService(runtime.pid === 1);
    const config = readLinuxServiceConfig(root, { runtime, fs, tempDirectory });
    const deadline = serviceDeadlines(config, now);
    deadline.check('ready');
    validateManagedInitStatus(fs.readFileSync('/proc/self/status', 'utf8'), config);
    const command = linuxServiceWorkload(config, { fs, tempDirectory });
    const rootIdentity = inspectManagedRoot(root, config, { fs, tempDirectory });
    const socketIdentity = inspectManagedSocket(root, config, { fs });
    let sequence = 0;
    let running = false;
    let busy = false;
    let stopping = false;
    let workload;
    let deferredTerminal;
    const check = phase => {
      requireService(!finished);
      deadline.check(phase);
      inspectManagedRoot(root, config, { fs, tempDirectory, previous: rootIdentity });
      inspectManagedSocket(root, config, { fs, previous: socketIdentity });
    };
    const send = value => new Promise((resolve, reject) => {
      channel.write(encodeServiceMessage(value), error => {
        if (error || finished) { reject(new Error('E2E_LINUX_SERVICE_CHANNEL_FAILED')); finish(failureExit); }
        else resolve();
      });
    });
    const terminal = snapshot => {
      if (finished || stopping) return;
      if (busy) { deferredTerminal = snapshot; return; }
      void send(serviceMessage(config.generation, snapshot.state === 'exited' ? 'exit' : 'failed', 0, snapshot))
        .catch(() => finish(failureExit));
    };
    const empty = () => ({ state: 'pending', spawned: false, stdout: '', stderr: '', rssBytes: null });
    const frames = serviceFrames(raw => {
      requireService(!busy && !stopping);
      const request = validateServiceMessage(raw, config.generation);
      requireService(['go', 'status', 'rss', 'stop'].includes(request.type) && request.sequence === sequence + 1);
      const phase = request.type === 'stop' ? 'wrapper' : !running ? 'ready' : 'work';
      if (request.type === 'stop') deadline.beginCleanup();
      check(phase);
      sequence = request.sequence;
      busy = true;
      void (async () => {
        if (request.type === 'go') {
          requireService(!running && sequence === 1);
          running = true;
          time.clearTimeout(timer);
          timer = time.setTimeout(() => finish(failureExit), deadline.remaining('work'));
          workload = spawnWorkload(command, [...config.redactedValues, config.repositoryRoot, config.runRoot, root,
            ...(config.profile === 'vite' ? [config.sessionSecret] : [])], terminal);
          const snapshot = await workload.started;
          check('ready');
          await send(serviceMessage(config.generation, 'started', sequence, snapshot));
        } else if (request.type === 'stop') {
          stopping = true;
          time.clearTimeout(timer);
          timer = time.setTimeout(() => finish(failureExit), deadline.remaining('wrapper'));
          await send(serviceMessage(config.generation, 'stopping', sequence, workload?.snapshot() ?? empty()));
          check('wrapper');
          channel.end(() => finish(expectedEofExit));
          return;
        } else {
          requireService(running && workload);
          await send(serviceMessage(config.generation, 'snapshot', sequence,
            request.type === 'rss' ? workload.rss() : workload.snapshot()));
        }
        busy = false;
        if (deferredTerminal) { const value = deferredTerminal; deferredTerminal = undefined; terminal(value); }
      })().catch(async () => {
        if (deferredTerminal && !finished) {
          try { await send(serviceMessage(config.generation, 'failed', 0,
            { ...deferredTerminal, state: 'unavailable', rssBytes: null })); } catch { /* Fail closed below. */ }
        }
        finish(failureExit);
      });
    });
    deadline.check('ready');
    channel = socket({ allowHalfOpen: true });
    timer = time.setTimeout(() => finish(failureExit), deadline.remaining('ready'));
    channel.on('error', () => finish(failureExit));
    channel.on('data', bytes => { try { frames.push(bytes); } catch { finish(failureExit); } });
    channel.on('end', () => {
      try { frames.end(); } catch { finish(failureExit); return; }
      // Abrupt caller loss still destroys the namespace, but cannot mint the
      // requested-stop receipt consumed by normal service cleanup.
      if (!stopping) finish(failureExit);
    });
    channel.on('close', () => { if (!finished) finish(failureExit); });
    channel.once('connect', () => {
      try {
        check('ready');
        void send(serviceMessage(config.generation, 'ready', 0)).catch(() => finish(failureExit));
      } catch { finish(failureExit); }
    });
    deadline.check('ready');
    channel.connect({ path: managedControlPath(root) });
  } catch { finish(failureExit); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0].startsWith('--root=')) process.exit(failureExit);
  runLinuxServiceInit(args[0].slice(7));
}

import * as filesystem from 'node:fs';
import { createServer } from 'node:net';
import { waitWithin } from './pidNamespaceContract.mjs';
import { inspectManagedRoot, inspectManagedSocket, managedControlPath } from './managedNamespaceRoot.mjs';
import { encodeServiceMessage, guardLinuxService, requireService, serviceFailure,
  serviceFrames, serviceMessage, validateServiceMessage } from './linuxServiceContract.mjs';

function pending() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export function listenLinuxServiceControl(prepared, deadline, onReply, onLost, {
  runtime = process, fs = filesystem, tempDirectory, createListener = createServer, time = globalThis,
} = {}) {
  guardLinuxService(runtime);
  const { config, rootIdentity } = prepared;
  const opened = pending();
  const ready = pending();
  const closed = pending();
  let server;
  let socket;
  let socketIdentity;
  let serverClosed = false;
  let socketClosed = false;
  let listening = false;
  let disposing = false;
  let fault;
  let seenReady = false;
  let seenExit = false;
  let workloadStarted = false;
  let eof = false;
  let stopping = false;
  let stopAcknowledged = false;
  let waiting;
  let sequence = 0;
  let timer;
  const settle = () => { if (serverClosed && (!socket || socketClosed)) closed.resolve(); };
  const closeListener = () => {
    try { server?.close(); } catch { /* A pending listen closes in its callback. */ }
    if (!server) { serverClosed = true; settle(); }
  };
  const fail = () => {
    if (fault) return;
    fault = serviceFailure('observationLost');
    time.clearTimeout(timer);
    opened.reject(fault); ready.reject(fault); waiting?.reject(fault); waiting = undefined;
    socket?.destroy(); closeListener();
    try { onLost(); } catch { /* An observer cannot invent successful cleanup. */ }
  };
  const check = () => {
    if (fault) throw fault;
    requireService(!disposing && listening, 'observationLost');
    inspectManagedRoot(config.root, config, { fs, tempDirectory, previous: rootIdentity });
    inspectManagedSocket(config.root, config, { fs, previous: socketIdentity });
  };
  try {
    deadline.check('ready');
    inspectManagedRoot(config.root, config, { fs, tempDirectory, previous: rootIdentity });
    const path = managedControlPath(config.root);
    let absent = false;
    try { fs.lstatSync(path); } catch (error) { if (error?.code === 'ENOENT') absent = true; else throw error; }
    requireService(absent);
    server = createListener({ allowHalfOpen: true, pauseOnConnect: true });
    server.on('error', fail);
    server.once('close', () => { serverClosed = true; settle(); });
    server.once('listening', () => {
      try {
        if (fault || disposing) { closeListener(); return; }
        deadline.check('ready');
        fs.chmodSync(path, 0o600);
        socketIdentity = inspectManagedSocket(config.root, config, { fs });
        listening = true;
        check(); opened.resolve();
      } catch { fail(); }
    });
    server.on('connection', channel => {
      channel.on('error', fail);
      try {
        requireService(!socket && !stopping, 'observationLost');
        check(); deadline.check('ready');
        socket = channel;
        const frames = serviceFrames(raw => {
          check();
          const value = validateServiceMessage(raw, config.generation);
          if (!seenReady) {
            deadline.check('ready');
            requireService(value.type === 'ready' && value.sequence === 0, 'observationLost');
            seenReady = true; time.clearTimeout(timer); ready.resolve(); return;
          }
          if (value.type === 'exit' || value.type === 'failed') {
            requireService(!seenExit && sequence > 0 && !stopAcknowledged && value.sequence === 0 &&
              (value.type === 'exit' ? value.state === 'exited' : value.state === 'unavailable'), 'observationLost');
            seenExit = true;
            onReply(value);
            if (value.type === 'failed') fail();
            return;
          }
          requireService(waiting && waiting.type === value.type && waiting.sequence === value.sequence,
            'observationLost');
          if (value.type === 'started') {
            requireService(!workloadStarted && value.state === 'running' && value.spawned, 'observationLost');
            workloadStarted = true;
          } else if (value.type === 'snapshot') {
            requireService(workloadStarted && value.spawned && value.state !== 'pending' &&
              (!seenExit || value.state === 'exited'), 'observationLost');
          }
          deadline.check(waiting.phase);
          const request = waiting; waiting = undefined;
          if (value.type === 'stopping') stopAcknowledged = true;
          onReply(value); request.resolve(value);
        }, true);
        channel.on('data', bytes => { try { frames.push(bytes); } catch { fail(); } });
        channel.once('end', () => {
          try {
            frames.end();
            requireService(stopping && stopAcknowledged && !waiting, 'observationLost');
            eof = true; channel.end();
          } catch { fail(); }
        });
        channel.once('close', () => {
          socketClosed = true;
          if (!eof && !disposing) fail();
          closeListener(); settle();
        });
        channel.resume();
      } catch { channel.destroy(); fail(); }
    });
    timer = time.setTimeout(fail, deadline.remaining('ready'));
    server.listen({ path });
  } catch { fail(); }

  return Object.freeze({
    opened: opened.promise, ready: ready.promise, closed: closed.promise,
    async request(type) {
      check();
      requireService(seenReady && socket && !stopping && !waiting && ['go', 'status', 'rss', 'stop'].includes(type),
        'observationLost');
      const phase = type === 'stop' ? 'wrapper' : type === 'go' ? 'ready' : 'work';
      deadline.check(phase);
      stopping = type === 'stop';
      const request = pending();
      sequence++;
      waiting = { ...request, sequence, phase, type: type === 'go' ? 'started' : type === 'stop' ? 'stopping' : 'snapshot' };
      const timeout = time.setTimeout(fail, deadline.remaining(phase));
      try {
        socket.write(encodeServiceMessage(serviceMessage(config.generation, type, sequence)), error => { if (error) fail(); });
        return await waitWithin(request.promise, deadline, phase, time);
      } catch (error) { fail(); throw error; }
      finally { time.clearTimeout(timeout); }
    },
    verifyClosed() {
      if (fault) throw fault;
      requireService(stopping && stopAcknowledged && eof && socketClosed && serverClosed, 'cleanupUnverified');
    },
    dispose() {
      disposing = true;
      time.clearTimeout(timer);
      const error = serviceFailure('observationLost');
      opened.reject(error); ready.reject(error); waiting?.reject(error); waiting = undefined;
      socket?.destroy(); closeListener();
      return closed.promise;
    },
  });
}

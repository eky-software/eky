import * as filesystem from 'node:fs';
import { createServer } from 'node:net';
import { currentIdentity } from './pidNamespaceActor.mjs';
import {
  actorArguments, NamespaceFailure, requireCondition, responseChannel, validateIdentity,
} from './pidNamespaceContract.mjs';
import { inspectManagedRoot, inspectManagedSocket, managedControlPath } from './managedNamespaceRoot.mjs';

function pending() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

// Owns only the private transport, never a process tree or a manager receipt.
export async function listenManagedControl({
  config, deadline, runtime = process, fs = filesystem, tempDirectory,
  createListener = createServer, time = globalThis,
}) {
  requireCondition(runtime.platform === 'linux' && runtime.env.EKY_E2E === '1' &&
    runtime.env.CI === 'true' && runtime.env.GITHUB_ACTIONS === 'true', 'invalidContext');
  actorArguments(config);
  validateIdentity(currentIdentity(runtime), config);
  deadline.check('ready');
  const opened = pending();
  const connected = pending();
  const closed = pending();
  let server;
  let socket;
  let replies;
  let rootReceipt;
  let socketReceipt;
  let fault;
  let listening = false;
  let serverClosed = false;
  let socketClosed = false;
  let closeRequested = false;
  let expectedEnd = false;
  let readyTimer;
  let lifetimeTimer;
  const settleClose = () => {
    if (serverClosed && (!socket || socketClosed)) {
      time.clearTimeout(readyTimer);
      time.clearTimeout(lifetimeTimer);
      closed.resolve();
    }
  };
  const stopListening = () => {
    closeRequested = true;
    try { server?.close(); } catch { /* A later listening event also closes. */ }
    if (!server) { serverClosed = true; settleClose(); }
  };
  const fail = error => {
    fault ??= error instanceof NamespaceFailure ? error : new NamespaceFailure('channelFailed');
    opened.reject(fault);
    connected.reject(fault);
    time.clearTimeout(readyTimer);
    socket?.destroy();
    stopListening();
  };
  const check = () => {
    if (fault) throw fault;
    requireCondition(!closeRequested && listening, 'channelFailed');
    inspectManagedRoot(config.root, config, { fs, tempDirectory, previous: rootReceipt });
    inspectManagedSocket(config.root, config, { fs, previous: socketReceipt });
    replies?.check();
  };
  const transport = Object.freeze({
    connection: connected.promise,
    closed: closed.promise,
    checkOpen() {
      check();
      requireCondition(socket && !socketClosed && !socket.destroyed && !replies.ended && !expectedEnd, 'unexpectedEof');
    },
    end() {
      this.checkOpen();
      deadline.check('init');
      expectedEnd = true;
      socket.end();
    },
    verifyClosed() {
      if (fault) throw fault;
      deadline.check('wrapper');
      requireCondition(expectedEnd && serverClosed && socketClosed, 'unexpectedEof');
      replies.closed();
    },
    dispose() {
      fail(new NamespaceFailure('channelFailed'));
      return closed.promise;
    },
  });
  try {
    readyTimer = time.setTimeout(() => fail(new NamespaceFailure('deadlineExceeded')), deadline.remaining('ready'));
    lifetimeTimer = time.setTimeout(() => fail(new NamespaceFailure('deadlineExceeded')), deadline.remaining('wrapper'));
    rootReceipt = inspectManagedRoot(config.root, config, { fs, tempDirectory });
    const path = managedControlPath(config.root);
    let absent = false;
    try { fs.lstatSync(path); } catch (error) { if (error?.code === 'ENOENT') absent = true; else throw error; }
    requireCondition(absent, 'rootFailed');
    deadline.check('ready');
    server = createListener({ allowHalfOpen: true, pauseOnConnect: true });
    server.on('error', fail);
    server.on('close', () => { serverClosed = true; settleClose(); });
    server.on('listening', () => {
      try {
        if (fault || closeRequested) { stopListening(); return; }
        deadline.check('ready');
        fs.chmodSync(path, 0o600);
        socketReceipt = inspectManagedSocket(config.root, config, { fs });
        inspectManagedRoot(config.root, config, { fs, tempDirectory, previous: rootReceipt });
        deadline.check('ready');
        listening = true;
        opened.resolve(transport);
      } catch (error) { fail(error); }
    });
    server.on('connection', channel => {
      channel.on('error', fail);
      try {
        requireCondition(!socket && !closeRequested, 'channelFailed');
        check();
        deadline.check('ready');
        socket = channel;
        replies = responseChannel(channel, deadline, time);
        const ready = replies.expect('READY', config.generation, 'ready');
        ready.then(() => { time.clearTimeout(readyTimer); }, fail);
        channel.on('end', () => {
          if (!expectedEnd) fail(new NamespaceFailure('unexpectedEof'));
        });
        channel.on('close', () => {
          socketClosed = true;
          try {
            requireCondition(expectedEnd, 'unexpectedEof');
            replies.closed();
          } catch (error) { fail(error); }
          stopListening();
          settleClose();
        });
        connected.resolve(Object.freeze({ socket: channel, replies, ready }));
        // Expectations and EOF guards are installed before any incoming bytes.
        channel.resume();
      } catch (error) { channel.destroy(); fail(error); }
    });
    server.listen({ path });
  } catch (error) { fail(error); }
  return opened.promise;
}

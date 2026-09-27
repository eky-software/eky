import { Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import {
  createBackendServiceFrameReader, encodeBackendServiceRequest, requireBackendServiceToken,
  validateBackendServiceReply, type BackendServiceReply, type BackendServiceRequestKind,
} from './windowsBackendServiceProtocol.js';

const connectionPollMilliseconds = 10;
const connectionFailure = 'E2E_BACKEND_OWNER_CONNECTION_LOST';
const protocolFailure = 'E2E_BACKEND_OWNER_PROTOCOL_INVALID';

export interface BackendServiceControl {
  request(kind: BackendServiceRequestKind, launchNonce?: string,
    workDeadlineElapsedMilliseconds?: number): Promise<BackendServiceReply>;
  finish(): Promise<void>;
  destroy(): void;
}

export async function beforeBackendOwnerDeadline<T>(
  operation: Promise<T>, deadline: number, now: () => number = () => performance.now(),
): Promise<T> {
  // Always observe an already-started operation, even when its deadline expired.
  void operation.catch(() => {});
  const remaining = deadline - now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('E2E_BACKEND_OWNER_DEADLINE_EXCEEDED');
  const controller = new AbortController();
  try {
    const value = await Promise.race([
      operation,
      delay(Math.min(remaining, 2_147_483_647), undefined, { signal: controller.signal })
        .then(() => { throw new Error('E2E_BACKEND_OWNER_DEADLINE_EXCEEDED'); }),
    ]);
    if (now() >= deadline) throw new Error('E2E_BACKEND_OWNER_DEADLINE_EXCEEDED');
    return value;
  } finally { controller.abort(); }
}

export async function connectBackendServiceControl(input: {
  readonly generation: string;
  readonly deadline: number;
  readDeadline(): number;
  onReply(reply: BackendServiceReply, requestSentAt?: number): void;
  onLost(): void;
}): Promise<BackendServiceControl> {
  requireBackendServiceToken(input.generation);
  while (performance.now() < input.deadline) {
    const socket = new Socket();
    // Connection errors are observed even between the connection and protocol phases.
    socket.on('error', () => {});
    try {
      await beforeBackendOwnerDeadline(new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
        socket.connect(`\\\\.\\pipe\\eky-e2e-backend-v1-${input.generation}`);
      }), input.deadline);
      return attachBackendServiceControl(socket, input);
    } catch (error) {
      socket.destroy();
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT' && code !== 'EBUSY') throw new Error(connectionFailure);
      await beforeBackendOwnerDeadline(delay(connectionPollMilliseconds), input.deadline);
    }
  }
  throw new Error('E2E_BACKEND_OWNER_DEADLINE_EXCEEDED');
}

export function attachBackendServiceControl(socket: Socket, input: {
  readonly generation: string;
  readDeadline(): number;
  onReply(reply: BackendServiceReply, requestSentAt?: number): void;
  onLost(): void;
  readonly now?: () => number;
}): BackendServiceControl {
  requireBackendServiceToken(input.generation);
  const now = input.now ?? (() => performance.now());
  let sent = 0;
  let received = 0;
  let previous: BackendServiceReply | undefined;
  let failure: Error | undefined;
  let finishing = false;
  let ended = false;
  let pending: {
    readonly sequence: number;
    readonly kind: BackendServiceRequestKind;
    readonly sentAt: number;
    resolve(reply: BackendServiceReply): void;
    reject(error: Error): void;
  } | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const fail = (code: string) => {
    if (failure === undefined) {
      failure = new Error(code);
      try { input.onLost(); } catch { /* A diagnostic observer cannot remove the failure. */ }
    }
    pending?.reject(failure);
    pending = undefined;
  };
  const reader = createBackendServiceFrameReader(value => {
    if (failure !== undefined) throw failure;
    const reply = validateBackendServiceReply(value, input.generation, received);
    validateProgress(previous, reply);
    const request = reply.replyTo === null ? undefined : pending;
    if (reply.replyTo !== null && (request === undefined || request.sequence !== reply.replyTo ||
      (reply.kind !== 'terminal' && reply.kind !== (request.kind === 'launch' ? 'started' : request.kind)))) {
      throw new Error(protocolFailure);
    }
    if (reply.replyTo === null && reply.kind !== 'rootExit' && reply.kind !== 'terminal') throw new Error(protocolFailure);
    if (request?.kind === 'stop' && reply.kind !== 'terminal') throw new Error(protocolFailure);
    received = reply.sequence;
    previous = reply;
    // The owner can shorten the cleanup deadline in this callback. Check it before
    // delivering the receipt, never calculate a new deadline from receipt time.
    input.onReply(reply, request?.sentAt);
    if (now() >= input.readDeadline()) throw new Error('E2E_BACKEND_OWNER_DEADLINE_EXCEEDED');
    if (request !== undefined) { pending = undefined; request.resolve(reply); }
    else if (reply.kind === 'terminal' && pending !== undefined) {
      const active = pending;
      pending = undefined;
      active.resolve(reply);
    }
  });
  socket.on('data', (chunk: Buffer) => {
    try { reader.push(chunk); }
    catch { fail(protocolFailure); socket.destroy(); }
  });
  socket.on('error', () => fail(connectionFailure));
  socket.on('end', () => {
    ended = true;
    try { reader.end(); } catch { fail(protocolFailure); }
    if (!finishing) fail(connectionFailure);
  });
  socket.on('close', () => {
    try { reader.end(); } catch { fail(protocolFailure); }
    if (!finishing || !ended || pending !== undefined) fail(connectionFailure);
    resolveClosed();
  });

  return {
    async request(kind, nonce, workDeadlineElapsedMilliseconds) {
      if (failure !== undefined) throw failure;
      if (finishing || pending !== undefined || now() >= input.readDeadline()) throw new Error(connectionFailure);
      const sequence = ++sent;
      const frame = encodeBackendServiceRequest(input.generation, sequence, kind, nonce, workDeadlineElapsedMilliseconds);
      const response = new Promise<BackendServiceReply>((resolve, reject) => {
        pending = { sequence, kind, sentAt: now(), resolve, reject };
      });
      try {
        socket.write(frame, error => { if (error !== undefined && error !== null) fail(connectionFailure); });
        const reply = await beforeBackendOwnerDeadline(response, input.readDeadline(), now);
        if (failure !== undefined) throw failure;
        return reply;
      } catch {
        fail(connectionFailure);
        socket.destroy();
        throw failure;
      }
    },
    async finish() {
      if (failure !== undefined) throw failure;
      if (pending !== undefined || previous?.kind !== 'terminal') throw new Error(protocolFailure);
      finishing = true;
      socket.end();
      try {
        await beforeBackendOwnerDeadline(closed, input.readDeadline(), now);
        if (failure !== undefined) throw failure;
      } catch {
        fail(connectionFailure);
        socket.destroy();
        throw failure;
      }
    },
    destroy() { fail(connectionFailure); socket.destroy(); },
  };
}

function validateProgress(previous: BackendServiceReply | undefined, next: BackendServiceReply): void {
  if (previous === undefined) return;
  if (next.elapsedMilliseconds < previous.elapsedMilliseconds) throw new Error(protocolFailure);
  const before = previous.state;
  const after = next.state;
  const fail = () => { throw new Error(protocolFailure); };
  for (const key of ['created', 'started', 'creationCompleted', 'launchClosed', 'assignedBeforeResume'] as const) {
    if (before[key] && !after[key]) fail();
  }
  if (before.identity !== null && (after.identity?.pid !== before.identity.pid ||
    after.identity.creationTimeFileTimeHex !== before.identity.creationTimeFileTimeHex)) fail();
  if (before.workload === 'exited' && (after.workload !== 'exited' || after.exitCode !== before.exitCode)) fail();
  if (before.firstFailure !== null && after.firstFailure !== before.firstFailure) fail();
  if (previous.cleanupStartedElapsedMilliseconds !== null &&
    (next.cleanupStartedElapsedMilliseconds !== previous.cleanupStartedElapsedMilliseconds ||
      next.remainingCleanupMilliseconds === null ||
      next.remainingCleanupMilliseconds > previous.remainingCleanupMilliseconds!)) fail();
  if (before.cleanup !== 'pending' && JSON.stringify(before) !== JSON.stringify(after)) fail();
}

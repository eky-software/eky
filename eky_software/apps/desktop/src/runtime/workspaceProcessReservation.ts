import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { isAbsolute, resolve } from 'node:path';

import {
  isWorkspaceProcessReservationIdentity,
  type WorkspaceProcessReservationDescriptor,
} from './workspaceProcessReservationDescriptor.js';

const RESERVATION_NAMESPACE = 'eky-workspace-process-v1';

type ReservationFailure = 'unsupportedPlatform' | 'invalidRoot' | 'rootUnavailable'
  | 'identityChanged' | 'busy' | 'unavailable' | 'aborted' | 'lost' | 'released'
  | 'releaseFailed';

export class WorkspaceProcessReservationError extends Error {
  constructor(
    readonly reason: ReservationFailure,
    readonly cleanupFailed = false,
  ) {
    super('WORKSPACE_PROCESS_RESERVATION_FAILED');
    this.name = 'WorkspaceProcessReservationError';
  }
}

export interface WorkspaceProcessReservation {
  readonly identity: string;
  /** Invalidated on loss or intentional release; never grants permission to write. */
  readonly invalidated: AbortSignal;
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}

/** Main binds this port to one current authority and one child generation. */
export interface WorkspaceProcessReservationTransfer {
  readonly descriptor: WorkspaceProcessReservationDescriptor;
  prepare(signal: AbortSignal): Promise<void>;
  assertGrant(signal: AbortSignal): Promise<void>;
  assertCurrent(): void;
  reclaimAfterExit(signal: AbortSignal): Promise<void>;
  invalidate(): void;
}

export async function readWorkspaceProcessReservationIdentity(userDataRoot: string): Promise<string> {
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    throw new WorkspaceProcessReservationError('unsupportedPlatform');
  }
  if (typeof userDataRoot !== 'string' || !isAbsolute(userDataRoot) || userDataRoot.includes('\0')) {
    throw new WorkspaceProcessReservationError('invalidRoot');
  }
  const root = resolve(userDataRoot);
  try {
    const before = await lstat(root, { bigint: true });
    const canonical = await realpath(root);
    const samePath = process.platform === 'win32'
      ? canonical.toLowerCase() === root.toLowerCase() : canonical === root;
    if (!samePath || !before.isDirectory() || before.isSymbolicLink()
      || typeof before.dev !== 'bigint' || typeof before.ino !== 'bigint'
      || before.dev < 0n || before.ino <= 0n) {
      throw new WorkspaceProcessReservationError('invalidRoot');
    }
    const after = await lstat(root, { bigint: true });
    if (!after.isDirectory() || after.isSymbolicLink()
      || before.dev !== after.dev || before.ino !== after.ino) {
      throw new WorkspaceProcessReservationError('identityChanged');
    }
    return createHash('sha256')
      .update(`${RESERVATION_NAMESPACE}:${before.dev}:${before.ino}`).digest('hex');
  } catch (error) {
    if (error instanceof WorkspaceProcessReservationError) throw error;
    throw new WorkspaceProcessReservationError('rootUnavailable');
  }
}

/** The caller owns the existing startup deadline. Its signal only cancels acquisition. */
export async function acquireWorkspaceProcessReservation(options: {
  readonly userDataRoot: string;
  readonly expectedIdentity?: string;
  readonly signal: AbortSignal;
}): Promise<WorkspaceProcessReservation> {
  const { userDataRoot, expectedIdentity, signal } = options;
  if (signal.aborted) throw new WorkspaceProcessReservationError('aborted');
  if (expectedIdentity !== undefined
    && !isWorkspaceProcessReservationIdentity(expectedIdentity)) {
    throw new WorkspaceProcessReservationError('invalidRoot');
  }
  const identity = await readWorkspaceProcessReservationIdentity(userDataRoot);
  if (expectedIdentity !== undefined && identity !== expectedIdentity) {
    throw new WorkspaceProcessReservationError('identityChanged');
  }
  if (signal.aborted) throw new WorkspaceProcessReservationError('aborted');
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\${RESERVATION_NAMESPACE}-${identity}`
    : `\0${RESERVATION_NAMESPACE}-${identity}`;
  let server: ReturnType<typeof createServer>;
  try {
    // This endpoint owns exclusion only; it accepts no data or commands.
    server = createServer((socket) => {
      socket.on('error', () => {});
      socket.destroy();
    });
  } catch {
    throw new WorkspaceProcessReservationError('unavailable');
  }
  const invalidation = new AbortController();
  let state: 'acquiring' | 'owned' | 'releasing' | 'released' = 'acquiring';
  let failure: WorkspaceProcessReservationError | undefined;
  let closeTask: Promise<void> | undefined;
  let readyResolve!: () => void;
  let readyReject!: (error: WorkspaceProcessReservationError) => void;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const fail = (error: WorkspaceProcessReservationError) => {
    failure ??= error;
    invalidation.abort(failure);
    if (state === 'acquiring') readyReject(failure);
  };
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (state === 'released') return;
    fail(new WorkspaceProcessReservationError(
      state === 'acquiring' && error.code === 'EADDRINUSE' ? 'busy' : 'unavailable',
    ));
  });
  server.on('close', () => {
    if (state !== 'releasing' && state !== 'released') {
      fail(new WorkspaceProcessReservationError('lost'));
    }
  });
  const close = (): Promise<void> => {
    if (closeTask) return closeTask;
    let resolveClose!: () => void;
    let rejectClose!: (error: WorkspaceProcessReservationError) => void;
    closeTask = new Promise<void>((resolveTask, rejectTask) => {
      resolveClose = resolveTask;
      rejectClose = rejectTask;
    });
    state = 'releasing';
    invalidation.abort(failure ?? new WorkspaceProcessReservationError('released'));
    const complete = (error?: Error) => {
      if (error && !('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING'
        && !server.listening)) {
        rejectClose(new WorkspaceProcessReservationError('releaseFailed'));
        return;
      }
      state = 'released';
      resolveClose();
    };
    try { server.close(complete); }
    catch { rejectClose(new WorkspaceProcessReservationError('releaseFailed')); }
    return closeTask;
  };
  const abort = () => fail(new WorkspaceProcessReservationError('aborted'));
  signal.addEventListener('abort', abort, { once: true });
  try {
    try {
      if (signal.aborted) abort();
      else server.listen({ path: endpoint, exclusive: true }, readyResolve);
    }
    catch { fail(new WorkspaceProcessReservationError('unavailable')); }
    await ready;
    if (failure) throw failure;
    const current = await readWorkspaceProcessReservationIdentity(userDataRoot);
    if (current !== identity) throw new WorkspaceProcessReservationError('identityChanged');
    if (failure) throw failure;
    if (!server.listening) throw new WorkspaceProcessReservationError('lost');
    state = 'owned';
    return Object.freeze({
      identity,
      invalidated: invalidation.signal,
      async assertOwned() {
        if (failure) throw failure;
        if (state !== 'owned') throw new WorkspaceProcessReservationError('released');
        try {
          if (await readWorkspaceProcessReservationIdentity(userDataRoot) !== identity) {
            throw new WorkspaceProcessReservationError('identityChanged');
          }
        } catch (error) {
          fail(error instanceof WorkspaceProcessReservationError
            ? error : new WorkspaceProcessReservationError('rootUnavailable'));
        }
        if (failure) throw failure;
        if (state !== 'owned') throw new WorkspaceProcessReservationError('released');
        if (!server.listening) {
          fail(new WorkspaceProcessReservationError('lost'));
          throw failure;
        }
      },
      release: close,
    });
  } catch (error) {
    const first = failure ?? (error instanceof WorkspaceProcessReservationError
      ? error : new WorkspaceProcessReservationError('unavailable'));
    fail(first);
    try { await close(); }
    catch { throw new WorkspaceProcessReservationError(first.reason, true); }
    throw first;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

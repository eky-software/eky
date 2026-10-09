import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ lstat: vi.fn(), realpath: vi.fn(), createServer: vi.fn() }));
vi.mock('node:fs/promises', () => ({ lstat: io.lstat, realpath: io.realpath }));
vi.mock('node:net', () => ({ createServer: io.createServer }));

import {
  acquireWorkspaceProcessReservation,
  readWorkspaceProcessReservationIdentity,
  WorkspaceProcessReservationError,
} from './workspaceProcessReservation.js';

const root = resolve(tmpdir(), 'eky-reservation-unit');
const metadata = (overrides = {}) => ({
  dev: 7n, ino: 19n, isDirectory: () => true, isSymbolicLink: () => false, ...overrides,
});
const rawError = () => Object.assign(new Error('private path and private runtime detail'), { code: 'EIO' });
const deferred = <T>() => {
  let resolveValue!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolveValue = resolvePromise; });
  return { promise, resolve: resolveValue };
};

class TestServer extends EventEmitter {
  listening = false;
  autoListen = true;
  completeListen: (() => void) | undefined;
  listen = vi.fn((_options: unknown, callback: () => void) => {
    this.completeListen = () => { this.listening = true; callback(); };
    if (this.autoListen) this.completeListen();
    return this;
  });
  close = vi.fn((callback: (error?: Error) => void) => {
    this.listening = false;
    this.emit('close');
    callback();
    return this;
  });
}

let server: TestServer;
beforeEach(() => {
  vi.resetAllMocks();
  io.lstat.mockResolvedValue(metadata());
  io.realpath.mockResolvedValue(root);
  server = new TestServer();
  io.createServer.mockReturnValue(server);
});
afterEach(() => { vi.unstubAllGlobals(); });
const acquire = (signal = new AbortController().signal, expectedIdentity?: string) =>
  acquireWorkspaceProcessReservation({ userDataRoot: root, signal,
    ...(expectedIdentity === undefined ? {} : { expectedIdentity }) });

describe('workspace reservation identity', () => {
  it('binds identity to bigint filesystem identity, not the spelling of the root', async () => {
    const first = await readWorkspaceProcessReservationIdentity(root);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await readWorkspaceProcessReservationIdentity(`${root}/.`)).toBe(first);
    io.lstat.mockResolvedValue(metadata({ ino: 20n }));
    expect(await readWorkspaceProcessReservationIdentity(root)).not.toBe(first);
  });

  it.each(['relative', '', '\0'])('rejects invalid root %j before IO', async (path) => {
    await expect(readWorkspaceProcessReservationIdentity(path)).rejects.toMatchObject({ reason: 'invalidRoot' });
    expect(io.lstat).not.toHaveBeenCalled();
  });

  it.each([
    { ino: 0n }, { ino: 1 }, { dev: -1n }, { isDirectory: () => false },
    { isSymbolicLink: () => true },
  ])('rejects unusable filesystem identity case %#', async (override) => {
    io.lstat.mockResolvedValue(metadata(override));
    await expect(acquire()).rejects.toMatchObject({ reason: 'invalidRoot' });
    expect(io.createServer).not.toHaveBeenCalled();
  });

  it('rejects an ancestor link and a root changed during inspection', async () => {
    io.realpath.mockResolvedValue(resolve(root, 'different'));
    await expect(acquire()).rejects.toMatchObject({ reason: 'invalidRoot' });
    io.realpath.mockResolvedValue(root);
    io.lstat.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(metadata({ ino: 21n }));
    await expect(acquire()).rejects.toMatchObject({ reason: 'identityChanged' });
    expect(io.createServer).not.toHaveBeenCalled();
  });

  it('contains filesystem errors without retaining the raw exception', async () => {
    io.lstat.mockRejectedValue(rawError());
    const error = await acquire().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(WorkspaceProcessReservationError);
    expect(error).toMatchObject({ message: 'WORKSPACE_PROCESS_RESERVATION_FAILED', reason: 'rootUnavailable' });
    expect(JSON.stringify(error)).not.toContain('private');
    expect(error).not.toHaveProperty('cause');
  });

  it('rejects unsupported platforms without IO or endpoint fallback', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    await expect(acquire()).rejects.toMatchObject({ reason: 'unsupportedPlatform' });
    expect(io.lstat).not.toHaveBeenCalled();
    expect(io.createServer).not.toHaveBeenCalled();
  });

  it('checks expected identity strictly before binding', async () => {
    await expect(acquire(undefined, 'x')).rejects.toMatchObject({ reason: 'invalidRoot' });
    await expect(acquire(undefined, '0'.repeat(64))).rejects.toMatchObject({ reason: 'identityChanged' });
    expect(io.createServer).not.toHaveBeenCalled();
  });
});

describe('workspace reservation lifetime', () => {
  it('uses only local IPC and keeps release idempotent and reentrancy-safe', async () => {
    const owner = await acquire();
    const endpoint = server.listen.mock.calls[0]?.[0] as { path: string; exclusive: boolean };
    expect(endpoint.exclusive).toBe(true);
    expect(endpoint.path.startsWith(process.platform === 'win32' ? '\\\\.\\pipe\\' : '\0')).toBe(true);
    expect(endpoint).not.toHaveProperty('port');
    await owner.assertOwned();
    let reentrant: Promise<void> | undefined;
    owner.invalidated.addEventListener('abort', () => { reentrant = owner.release(); });
    const release = owner.release();
    expect(reentrant).toBe(release);
    await release;
    expect(owner.release()).toBe(release);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(owner.invalidated.aborted).toBe(true);
    await expect(owner.assertOwned()).rejects.toMatchObject({ reason: 'released' });
  });

  it('rejects connected sockets without accepting commands', async () => {
    const owner = await acquire();
    const socket = { on: vi.fn(), destroy: vi.fn() };
    io.createServer.mock.calls[0]?.[0](socket);
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(socket.on.mock.calls.map(([name]) => name)).toEqual(['error']);
    await owner.release();
  });

  it('revalidates root identity after bind, closes and rejects on mismatch', async () => {
    io.lstat.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(metadata())
      .mockResolvedValue(metadata({ ino: 29n }));
    await expect(acquire()).rejects.toMatchObject({ reason: 'identityChanged' });
    expect(server.close).toHaveBeenCalledOnce();
  });

  it('latches a changed identity but retains reservation until its owner releases', async () => {
    const owner = await acquire();
    io.lstat.mockResolvedValue(metadata({ ino: 30n }));
    await expect(owner.assertOwned()).rejects.toMatchObject({ reason: 'identityChanged' });
    expect(owner.invalidated.aborted).toBe(true);
    expect(server.close).not.toHaveBeenCalled();
    io.lstat.mockResolvedValue(metadata());
    await expect(owner.assertOwned()).rejects.toMatchObject({ reason: 'identityChanged' });
    await owner.release();
  });

  it('latches runtime errors without releasing beneath protected work', async () => {
    const owner = await acquire();
    server.emit('error', rawError());
    expect(owner.invalidated.aborted).toBe(true);
    expect(server.close).not.toHaveBeenCalled();
    await expect(owner.assertOwned()).rejects.toMatchObject({ reason: 'unavailable' });
    await owner.release();
  });

  it('detects unexpected close and does not revive ownership', async () => {
    const owner = await acquire();
    server.listening = false;
    server.emit('close');
    server.listening = true;
    await expect(owner.assertOwned()).rejects.toMatchObject({ reason: 'lost' });
    await owner.release();
  });

  it('does not let a concurrent release turn a pending ownership check into success', async () => {
    const owner = await acquire();
    const inspection = deferred<ReturnType<typeof metadata>>();
    io.lstat.mockReturnValueOnce(inspection.promise);
    const check = owner.assertOwned();
    const rejected = expect(check).rejects.toMatchObject({ reason: 'released' });
    await owner.release();
    inspection.resolve(metadata());
    await rejected;
  });

  it('rejects cancellation before IO and during bind', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(acquire(abort.signal)).rejects.toMatchObject({ reason: 'aborted' });
    expect(io.lstat).not.toHaveBeenCalled();
    const pendingAbort = new AbortController();
    server.autoListen = false;
    const listening = deferred<void>();
    server.listen.mockImplementation(() => { listening.resolve(); return server; });
    const pending = acquire(pendingAbort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ reason: 'aborted' });
    await listening.promise;
    pendingAbort.abort();
    await rejected;
    expect(server.close).toHaveBeenCalledOnce();
  });

  it('does not use the completed startup signal to release an active owner', async () => {
    const abort = new AbortController();
    const owner = await acquire(abort.signal);
    abort.abort();
    expect(owner.invalidated.aborted).toBe(false);
    expect(server.close).not.toHaveBeenCalled();
    await owner.release();
  });

  it('waits for actual close completion while immediately invalidating ownership', async () => {
    const owner = await acquire();
    let completeClose!: (error?: Error) => void;
    server.close.mockImplementation((callback) => { completeClose = callback; return server; });
    let completed = false;
    const closing = owner.release();
    void closing.then(() => { completed = true; });
    expect(owner.invalidated.aborted).toBe(true);
    await expect(owner.assertOwned()).rejects.toMatchObject({ reason: 'released' });
    expect(completed).toBe(false);
    expect(owner.release()).toBe(closing);
    server.listening = false;
    server.emit('close');
    await Promise.resolve();
    expect(completed).toBe(false);
    completeClose();
    await closing;
    expect(completed).toBe(true);
  });

  it('cancels during post-bind identity inspection without publishing an owner', async () => {
    const abort = new AbortController();
    const inspecting = deferred<void>();
    const inspection = deferred<ReturnType<typeof metadata>>();
    io.lstat.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(metadata())
      .mockImplementationOnce(() => { inspecting.resolve(); return inspection.promise; });
    const pending = acquire(abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ reason: 'aborted' });
    await inspecting.promise;
    expect(server.listening).toBe(true);
    abort.abort();
    inspection.resolve(metadata());
    await rejected;
    expect(server.close).toHaveBeenCalledOnce();
    expect(server.listening).toBe(false);
  });

  it.each(['EADDRINUSE', 'EACCES'])('reports safe bind failure %s and closes', async (code) => {
    server.listen.mockImplementation(() => {
      server.emit('error', Object.assign(rawError(), { code }));
      return server;
    });
    await expect(acquire()).rejects.toMatchObject({ reason: code === 'EADDRINUSE' ? 'busy' : 'unavailable' });
    expect(server.close).toHaveBeenCalledOnce();
  });

  it('retains bind failure separately from failed cleanup', async () => {
    server.listen.mockImplementation(() => { server.emit('error', rawError()); return server; });
    server.close.mockImplementation((callback) => { callback(rawError()); return server; });
    await expect(acquire()).rejects.toMatchObject({ reason: 'unavailable', cleanupFailed: true });
  });

  it('release failure cannot restore ownership or retry into success', async () => {
    const owner = await acquire();
    server.close.mockImplementation((callback) => { callback(rawError()); return server; });
    const closing = owner.release();
    await expect(closing).rejects.toMatchObject({ reason: 'releaseFailed' });
    expect(owner.release()).toBe(closing);
    await expect(owner.assertOwned()).rejects.toMatchObject({ reason: 'released' });
    expect(owner.invalidated.aborted).toBe(true);
  });
});

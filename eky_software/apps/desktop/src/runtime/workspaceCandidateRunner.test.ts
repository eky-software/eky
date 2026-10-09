import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceCandidatePrepareCommand,
  createWorkspaceCandidateShutdownCommand,
  createWorkspaceCandidateStartCommand,
  parseWorkspaceCandidateProcessStatus,
  workspaceCandidateStartupTimeoutMilliseconds,
  type WorkspaceCandidateProcessOperation,
} from './workspaceCandidateMessages.js';
import {
  startWorkspaceCandidateRunner as startRunner,
  type WorkspaceCandidateRunnerOptions,
  type WorkspaceCandidateRunnerPort,
} from './workspaceCandidateRunner.js';
import type { WorkspaceProcessReservation } from './workspaceProcessReservation.js';

const runtimeSession = 'a'.repeat(43);
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const profileId = 'c'.repeat(64);
const migrationChainIdentity = 'd'.repeat(64);
const reservationIdentity = 'e'.repeat(64);

afterEach(() => vi.useRealTimers());

describe('workspace candidate runner', () => {
  it('handshakes, runs one request and exits only after shutdown', async () => {
    const port = new FakeRunnerPort();
    const exits: number[] = [];
    let handlesClosed = false;
    const loadOperation = vi.fn(async () => async () => {
      handlesClosed = true;
      return migrationResult();
    });
    const reservation = fakeReservation();
    startWorkspaceCandidateRunner({
      acquireReservation: async () => reservation,
      exit: (code) => exits.push(code),
      loadOperation,
      parentPort: port,
    });

    expect(port.statuses().map((status) => status.type)).toEqual(['ready']);
    port.send(prepareCommand());
    await flushTasks();
    expect(loadOperation).not.toHaveBeenCalled();
    expect(exits).toEqual([]);
    port.send(startCommand());
    await flushTasks();

    expect(loadOperation).toHaveBeenCalledTimes(1);
    expect(handlesClosed).toBe(true);
    expect(port.statuses().map((status) => status.type)).toEqual([
      'ready',
      'reservationReady',
      'completed',
    ]);
    expect(exits).toEqual([]);

    port.send(shutdownCommand());
    expect(exits).toEqual([0]);
    expect(reservation.release).not.toHaveBeenCalled();
    expect(reservation.assertOwned).toHaveBeenCalledTimes(2);
  });

  it('aborts a running request and waits for handle cleanup before exit', async () => {
    const port = new FakeRunnerPort();
    const exits: Array<{ code: number; handlesClosed: boolean }> = [];
    let handlesClosed = false;
    let observedSignal: AbortSignal | undefined;
    startWorkspaceCandidateRunner({
      acquireReservation: async () => fakeReservation(),
      exit: (code) => exits.push({ code, handlesClosed }),
      loadOperation: async () => async (_operation, control) => {
        observedSignal = control.signal;
        await new Promise<void>((_resolve, reject) => {
          control.signal.addEventListener(
            'abort',
            () => {
              handlesClosed = true;
              reject(new Error('private test failure'));
            },
            { once: true },
          );
        });
        return migrationResult();
      },
      parentPort: port,
    });

    await prepareRunner(port);
    port.send(startCommand());
    await flushTasks();
    port.send(shutdownCommand());
    await flushTasks();

    expect(observedSignal?.aborted).toBe(true);
    expect(exits).toEqual([{ code: 1, handlesClosed: true }]);
    expect(port.statuses().filter((status) => status.type === 'failed')).toHaveLength(1);
  });

  it('rejects duplicate requests with one safe terminal result', async () => {
    const port = new FakeRunnerPort();
    const exits: number[] = [];
    let rejectOperation: (() => void) | undefined;
    startWorkspaceCandidateRunner({
      acquireReservation: async () => fakeReservation(),
      exit: (code) => exits.push(code),
      loadOperation: async () => async (_operation, control) => {
        await new Promise<void>((_resolve, reject) => {
          rejectOperation = () => reject(new Error('private test failure'));
          control.signal.addEventListener('abort', rejectOperation, {
            once: true,
          });
        });
        return migrationResult();
      },
      parentPort: port,
    });

    const start = startCommand();
    await prepareRunner(port);
    port.send(start);
    await flushTasks();
    port.send(start);
    rejectOperation?.();
    await flushTasks();

    expect(exits).toEqual([1]);
    expect(port.statuses().filter((status) => status.type === 'failed')).toHaveLength(1);
  });

  it('fails safely on an out-of-order shutdown and loader failure', async () => {
    const outOfOrderPort = new FakeRunnerPort();
    const outOfOrderExits: number[] = [];
    startWorkspaceCandidateRunner({
      acquireReservation: async () => fakeReservation(),
      exit: (code) => outOfOrderExits.push(code),
      loadOperation: async () => async () => migrationResult(),
      parentPort: outOfOrderPort,
    });
    outOfOrderPort.send(shutdownCommand());

    expect(outOfOrderExits).toEqual([1]);
    expect(outOfOrderPort.statuses().at(-1)?.type).toBe('failed');

    const loaderPort = new FakeRunnerPort();
    const loaderExits: number[] = [];
    startWorkspaceCandidateRunner({
      acquireReservation: async () => fakeReservation(),
      exit: (code) => loaderExits.push(code),
      loadOperation: async () => {
        throw new Error(`${resolve('private')} raw stack`);
      },
      parentPort: loaderPort,
    });
    await prepareRunner(loaderPort);
    loaderPort.send(startCommand());
    await flushTasks();

    const failed = loaderPort.statuses().at(-1);
    expect(failed).toMatchObject({
      code: 'WORKSPACE_CANDIDATE_OPERATION_FAILED',
      type: 'failed',
    });
    expect(JSON.stringify(failed)).not.toContain('private');
    expect(loaderExits).toEqual([]);
    loaderPort.send(shutdownCommand());
    expect(loaderExits).toEqual([1]);
  });

  it('exits without leaking status data for malformed input', () => {
    const port = new FakeRunnerPort();
    const exits: number[] = [];
    startWorkspaceCandidateRunner({
      acquireReservation: async () => fakeReservation(),
      exit: (code) => exits.push(code),
      loadOperation: async () => async () => migrationResult(),
      parentPort: port,
    });

    port.send({ path: resolve('private'), type: 'start' });

    expect(exits).toEqual([1]);
    expect(port.statuses()).toEqual([
      expect.objectContaining({ type: 'ready' }),
    ]);
  });

  it.each(['beforePreparation', 'duringAcquisition'] as const)(
    'does not load writing code for a grant %s', async (order) => {
      const port = new FakeRunnerPort();
      const exit = vi.fn();
      const loadOperation = vi.fn(async () => async () => migrationResult());
      let finishAcquisition!: (value: WorkspaceProcessReservation) => void;
      const acquireReservation = vi.fn(() => new Promise<WorkspaceProcessReservation>((resolveTask) => {
        finishAcquisition = resolveTask;
      }));
      startWorkspaceCandidateRunner({ acquireReservation, exit, loadOperation, parentPort: port });
      if (order === 'duringAcquisition') port.send(prepareCommand());
      port.send(startCommand());
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      if (order === 'duringAcquisition') {
        finishAcquisition(fakeReservation());
        await flushTasks();
      }
      expect(loadOperation).not.toHaveBeenCalled();
      expect(port.statuses().some((status) => status.type === 'reservationReady')).toBe(false);
    },
  );

  it.each(['operationId', 'requestId', 'runtimeSession'] as const)(
    'rejects a work grant with another %s', async (field) => {
      const port = new FakeRunnerPort();
      const exit = vi.fn();
      const loadOperation = vi.fn(async () => async () => migrationResult());
      startWorkspaceCandidateRunner({
        acquireReservation: async () => fakeReservation(), exit, loadOperation, parentPort: port,
      });
      await prepareRunner(port);
      port.send({ ...startCommand(), [field]: field === 'runtimeSession'
        ? 'z'.repeat(43) : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(loadOperation).not.toHaveBeenCalled();
    },
  );

  it.each(['acquiring', 'ready'] as const)(
    'rejects repeated preparation while %s', async (phase) => {
      const port = new FakeRunnerPort();
      const exit = vi.fn();
      const loadOperation = vi.fn(async () => async () => migrationResult());
      startWorkspaceCandidateRunner({
        acquireReservation: async () => fakeReservation(), exit, loadOperation, parentPort: port,
      });
      port.send(prepareCommand());
      if (phase === 'ready') await flushTasks();
      port.send(prepareCommand());
      await flushTasks();
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(loadOperation).not.toHaveBeenCalled();
    },
  );

  it('cancels acquisition without accepting its late result or a queued grant', async () => {
    const port = new FakeRunnerPort();
    const exit = vi.fn();
    const loadOperation = vi.fn(async () => async () => migrationResult());
    let signal: AbortSignal | undefined;
    let finishAcquisition!: (value: WorkspaceProcessReservation) => void;
    startWorkspaceCandidateRunner({
      acquireReservation: (input) => {
        signal = input.signal;
        return new Promise((resolveTask) => { finishAcquisition = resolveTask; });
      }, exit, loadOperation, parentPort: port,
    });
    port.send(prepareCommand());
    port.send(shutdownCommand());
    expect(signal?.aborted).toBe(true);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    finishAcquisition(fakeReservation());
    await flushTasks();
    port.send(startCommand());
    expect(loadOperation).not.toHaveBeenCalled();
    expect(port.statuses().map((status) => status.type)).toEqual(['ready', 'failed']);
  });

  it.each(['noPreparation', 'pendingAcquisition', 'noGrant'] as const)(
    'exits an ungranted orphan within the existing startup budget: %s', async (state) => {
      vi.useFakeTimers();
      const port = new FakeRunnerPort();
      const exit = vi.fn();
      const loadOperation = vi.fn(async () => async () => migrationResult());
      let acquisitionSignal: AbortSignal | undefined;
      startWorkspaceCandidateRunner({
        acquireReservation: (input) => {
          acquisitionSignal = input.signal;
          return state === 'pendingAcquisition'
            ? new Promise(() => {}) : Promise.resolve(fakeReservation());
        }, exit, loadOperation, parentPort: port,
      });
      await vi.advanceTimersByTimeAsync(workspaceCandidateStartupTimeoutMilliseconds - 1);
      if (state !== 'noPreparation') port.send(prepareCommand());
      await vi.advanceTimersByTimeAsync(0);
      expect(exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      if (state !== 'noPreparation') expect(acquisitionSignal?.aborted).toBe(true);
      port.send(startCommand());
      expect(loadOperation).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['acquireRejects', 'wrongIdentity', 'invalidated', 'assertRejects'] as const)(
    'does not load writing code after reservation failure: %s', async (failure) => {
      const port = new FakeRunnerPort();
      const exit = vi.fn();
      const loadOperation = vi.fn(async () => async () => migrationResult());
      const invalidation = new AbortController();
      if (failure === 'invalidated') invalidation.abort();
      const reservation = fakeReservation(invalidation);
      startWorkspaceCandidateRunner({
        acquireReservation: async () => {
          if (failure === 'acquireRejects') throw new Error('private reservation detail');
          if (failure === 'wrongIdentity') return { ...reservation, identity: 'f'.repeat(64) };
          if (failure === 'assertRejects') return {
            ...reservation, assertOwned: async () => { throw new Error('private identity failure'); },
          };
          return reservation;
        }, exit, loadOperation, parentPort: port,
      });
      await prepareRunner(port);
      if (failure === 'assertRejects') {
        port.send(startCommand());
        await flushTasks();
        port.send(shutdownCommand());
      }
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(loadOperation).not.toHaveBeenCalled();
      expect(JSON.stringify(port.posted)).not.toContain('private reservation detail');
      expect(JSON.stringify(port.posted)).not.toContain('private identity failure');
      expect(reservation.release).not.toHaveBeenCalled();
    },
  );

  it.each(['shutdown', 'reservationLost'] as const)(
    'does not invoke a delayed loaded operation after %s', async (cause) => {
      const port = new FakeRunnerPort();
      const exit = vi.fn();
      const operation = vi.fn(async () => migrationResult());
      let finishLoad!: (value: typeof operation) => void;
      const invalidation = new AbortController();
      const reservation = fakeReservation(invalidation);
      const loadOperation = vi.fn(() => new Promise<typeof operation>((resolveTask) => {
        finishLoad = resolveTask;
      }));
      startWorkspaceCandidateRunner({
        acquireReservation: async () => reservation, exit, loadOperation, parentPort: port,
      });
      await prepareRunner(port);
      port.send(startCommand());
      await flushTasks();
      expect(loadOperation).toHaveBeenCalledTimes(1);
      if (cause === 'shutdown') port.send(shutdownCommand());
      else invalidation.abort();
      expect(exit).not.toHaveBeenCalled();
      finishLoad(operation);
      await flushTasks();
      expect(operation).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(reservation.release).not.toHaveBeenCalled();
    },
  );

  it('keeps ownership until a cancelled writing operation closes its handles', async () => {
    const port = new FakeRunnerPort();
    const exit = vi.fn();
    const invalidation = new AbortController();
    const reservation = fakeReservation(invalidation);
    let signal: AbortSignal | undefined;
    let finishWork!: () => void;
    startWorkspaceCandidateRunner({
      acquireReservation: async () => reservation, exit, parentPort: port,
      loadOperation: async () => async (_operation, control) => {
        signal = control.signal;
        await new Promise<void>((resolveTask) => { finishWork = resolveTask; });
        return migrationResult();
      },
    });
    await prepareRunner(port);
    port.send(startCommand());
    await flushTasks();
    invalidation.abort();
    expect(signal?.aborted).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    expect(reservation.release).not.toHaveBeenCalled();
    finishWork();
    await flushTasks();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(port.statuses().at(-1)?.type).toBe('failed');
  });

  it('includes a pending grant ownership check in the original startup deadline', async () => {
    vi.useFakeTimers();
    const port = new FakeRunnerPort();
    const exit = vi.fn();
    const loadOperation = vi.fn(async () => async () => migrationResult());
    let finishCheck!: () => void;
    startWorkspaceCandidateRunner({
      acquireReservation: async () => ({
        ...fakeReservation(),
        assertOwned: () => new Promise<void>((resolveTask) => { finishCheck = resolveTask; }),
      }), exit, loadOperation, parentPort: port,
    });
    port.send(prepareCommand());
    await vi.advanceTimersByTimeAsync(workspaceCandidateStartupTimeoutMilliseconds - 1);
    port.send(startCommand());
    await vi.advanceTimersByTimeAsync(1);
    expect(loadOperation).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(vi.getTimerCount()).toBe(0);
    finishCheck();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(loadOperation).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rechecks ownership after loading without invoking work when it has changed', async () => {
    const port = new FakeRunnerPort();
    const exit = vi.fn();
    const operation = vi.fn(async () => migrationResult());
    const assertOwned = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('private changed root'));
    startWorkspaceCandidateRunner({
      acquireReservation: async () => ({ ...fakeReservation(), assertOwned }),
      exit, loadOperation: async () => operation, parentPort: port,
    });
    await prepareRunner(port);
    port.send(startCommand());
    await flushTasks();
    expect(operation).not.toHaveBeenCalled();
    expect(port.statuses().at(-1)).toMatchObject({
      type: 'failed', code: 'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    });
    port.send(shutdownCommand());
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits without work when reservation readiness cannot be delivered', async () => {
    const port = new FakeRunnerPort();
    const exit = vi.fn();
    const loadOperation = vi.fn(async () => async () => migrationResult());
    const originalPost = port.postMessage.bind(port);
    vi.spyOn(port, 'postMessage').mockImplementation((value) => {
      if (parseWorkspaceCandidateProcessStatus(value)?.type === 'reservationReady') {
        throw new Error('private disconnected channel');
      }
      originalPost(value);
    });
    startWorkspaceCandidateRunner({
      acquireReservation: async () => fakeReservation(), exit, loadOperation, parentPort: port,
    });
    await prepareRunner(port);
    port.send(startCommand());
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(loadOperation).not.toHaveBeenCalled();
    expect(port.statuses().map((status) => status.type)).toEqual(['ready', 'failed']);
  });
});

function startWorkspaceCandidateRunner(options: WorkspaceCandidateRunnerOptions): void {
  startRunner({
    ...options,
    loadOperation: (operation, control) => {
      // These in-memory loaders evaluate immediately; path-wait tests use startRunner directly.
      control.beginLoad();
      return options.loadOperation(operation, control);
    },
  });
}

function fakeReservation(invalidation = new AbortController()): WorkspaceProcessReservation {
  return {
    identity: reservationIdentity,
    invalidated: invalidation.signal,
    assertOwned: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
}

function prepareCommand() {
  return createWorkspaceCandidatePrepareCommand({
    operationId, requestId, runtimeSession,
    reservation: {
      generationId: requestId,
      identity: reservationIdentity,
      userDataRoot: resolve('private-installation'),
    },
  });
}

async function prepareRunner(port: FakeRunnerPort): Promise<void> {
  port.send(prepareCommand());
  await flushTasks();
}

function operation(): WorkspaceCandidateProcessOperation {
  const backendRoot = resolve('backend');
  const candidateRoot = resolve('private-candidate');
  return {
    appVersion: '0.2.6',
    artifactRoot: resolve(candidateRoot, 'artifacts'),
    backendRoot,
    buildRevision: 'development',
    candidateRoot,
    databaseFilePath: resolve(candidateRoot, 'profile.sqlite'),
    migrationsDirectory: resolve(
      backendRoot,
      'dist',
      'database',
      'migrations',
    ),
    operation: 'bootstrapEmpty',
  };
}

function startCommand() {
  return createWorkspaceCandidateStartCommand({
    operation: operation(),
    operationId,
    requestId,
    runtimeSession,
  });
}

function shutdownCommand() {
  return createWorkspaceCandidateShutdownCommand({
    operationId,
    requestId,
    runtimeSession,
  });
}

function migrationResult() {
  return {
    kind: 'migration' as const,
    migrationChainIdentity,
    profileId,
  };
}

function flushTasks(): Promise<void> {
  return new Promise((resolveTask) => setImmediate(resolveTask));
}

class FakeRunnerPort implements WorkspaceCandidateRunnerPort {
  private listener: ((event: { readonly data: unknown }) => void) | undefined;
  readonly posted: unknown[] = [];

  on(
    _event: 'message',
    listener: (event: { readonly data: unknown }) => void,
  ): void {
    this.listener = listener;
  }

  postMessage(value: unknown): void {
    this.posted.push(value);
  }

  send(value: unknown): void {
    this.listener?.({ data: value });
  }

  statuses() {
    return this.posted.flatMap((value) => {
      const status = parseWorkspaceCandidateProcessStatus(value);
      return status === undefined ? [] : [status];
    });
  }
}

import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceCandidateShutdownCommand,
  createWorkspaceCandidateStartCommand,
  parseWorkspaceCandidateProcessStatus,
  type WorkspaceCandidateProcessOperation,
} from './workspaceCandidateMessages.js';
import {
  startWorkspaceCandidateRunner,
  type WorkspaceCandidateRunnerPort,
} from './workspaceCandidateRunner.js';

const runtimeSession = 'a'.repeat(43);
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const profileId = 'c'.repeat(64);
const migrationChainIdentity = 'd'.repeat(64);

describe('workspace candidate runner', () => {
  it('handshakes, runs one request and exits only after shutdown', async () => {
    const port = new FakeRunnerPort();
    const exits: number[] = [];
    let handlesClosed = false;
    const loadOperation = vi.fn(async () => async () => {
      handlesClosed = true;
      return migrationResult();
    });
    startWorkspaceCandidateRunner({
      exit: (code) => exits.push(code),
      loadOperation,
      parentPort: port,
    });

    expect(port.statuses().map((status) => status.type)).toEqual(['ready']);
    port.send(startCommand());
    await flushTasks();

    expect(loadOperation).toHaveBeenCalledTimes(1);
    expect(handlesClosed).toBe(true);
    expect(port.statuses().map((status) => status.type)).toEqual([
      'ready',
      'completed',
    ]);
    expect(exits).toEqual([]);

    port.send(shutdownCommand());
    expect(exits).toEqual([0]);
  });

  it('aborts a running request and waits for handle cleanup before exit', async () => {
    const port = new FakeRunnerPort();
    const exits: Array<{ code: number; handlesClosed: boolean }> = [];
    let handlesClosed = false;
    let observedSignal: AbortSignal | undefined;
    startWorkspaceCandidateRunner({
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
      exit: (code) => loaderExits.push(code),
      loadOperation: async () => {
        throw new Error(`${resolve('private')} raw stack`);
      },
      parentPort: loaderPort,
    });
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
});

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

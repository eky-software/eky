import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { expect, test } from '@playwright/test';

import {
  createE2eBackendStartupReporter,
  waitForManagedBackendHealth,
  type E2eBackendStartupProgress,
} from '../../src/environment/e2eBackendStartupLifecycle.js';
import { runBoundedWindowsTaskkill } from '../../src/environment/runBoundedWindowsTaskkill.js';
import type { ManagedChildProcess } from '../../src/environment/startManagedProcess.js';

test.describe('managed E2E backend startup lifecycle', () => {
  test('reports a healthy child without changing the startup result', async () => {
    const child = createFakeChild();
    const progress: E2eBackendStartupProgress[] = [];

    await expect(
      waitForManagedBackendHealth({
        child,
        observe: (event) => progress.push(event),
        waitForHealth: () => Promise.resolve(),
      }),
    ).resolves.toBeUndefined();

    expect(progress.map(({ phase, status }) => ({ phase, status }))).toEqual([
      { phase: 'healthWaitStarted', status: 'started' },
      { phase: 'healthReady', status: 'completed' },
    ]);
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });

  test('fails safely when the child exits before health', async () => {
    const child = createFakeChild();
    const progress: E2eBackendStartupProgress[] = [];
    const health = new Promise<void>(() => undefined);
    const result = waitForManagedBackendHealth({
      child,
      observe: (event) => progress.push(event),
      waitForHealth: () => health,
    });

    child.setExitCode(1);
    child.emit('exit', 1, null);

    await expect(result).rejects.toThrow(
      'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH',
    );
    expect(progress.at(-1)).toMatchObject({
      errorCode: 'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH',
      phase: 'childExitedBeforeHealth',
      status: 'failed',
    });
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });

  test('keeps an alive child health timeout distinct from an early exit', async () => {
    const child = createFakeChild();
    const progress: E2eBackendStartupProgress[] = [];

    await expect(
      waitForManagedBackendHealth({
        child,
        observe: (event) => progress.push(event),
        waitForHealth: () => Promise.reject(new Error('raw health detail')),
      }),
    ).rejects.toThrow('E2E_BACKEND_HEALTH_TIMEOUT');
    expect(progress.at(-1)).toMatchObject({
      errorCode: 'E2E_BACKEND_HEALTH_TIMEOUT',
      phase: 'healthTimedOut',
      status: 'failed',
    });
  });

  test('writes only closed progress fields and ignores logger failure', () => {
    const lines: string[] = [];
    const reporter = createE2eBackendStartupReporter({
      now: createMonotonicClock(),
      writeLine: (line) => lines.push(line),
    });
    reporter({
      durationMs: 999,
      elapsedMs: 999,
      phase: 'healthWaitStarted',
      scenario: 'e2eBackendStartup',
      status: 'started',
      rawPath: 'D:\\private\\profile',
      stack: 'raw stack',
    } as E2eBackendStartupProgress);
    reporter({
      durationMs: 999,
      elapsedMs: 999,
      phase: 'healthReady',
      scenario: 'e2eBackendStartup',
      status: 'completed',
    });

    expect(lines).toHaveLength(2);
    expect(lines.join('\n')).not.toContain('private');
    expect(lines.join('\n')).not.toContain('stack');
    expect(Object.keys(JSON.parse(lines[0] ?? '{}')).sort()).toEqual([
      'durationMs',
      'elapsedMs',
      'phase',
      'scenario',
      'status',
    ]);

    const failingReporter = createE2eBackendStartupReporter({
      writeLine: () => {
        throw new Error('raw logger failure');
      },
    });
    expect(() =>
      failingReporter({
        durationMs: 0,
        elapsedMs: 0,
        phase: 'healthReady',
        scenario: 'e2eBackendStartup',
        status: 'completed',
      }),
    ).not.toThrow();
  });
});

test.describe('bounded Windows taskkill', () => {
  test('completes when the taskkill host exits', async () => {
    const taskkill = createFakeChild();
    const result = runBoundedWindowsTaskkill(
      123,
      100,
      () => taskkill as ChildProcess,
    );
    taskkill.setExitCode(0);
    taskkill.emit('exit', 0, null);

    await expect(result).resolves.toBeUndefined();
    expect(taskkill.listenerCount('exit')).toBe(0);
    expect(taskkill.listenerCount('error')).toBe(0);
  });

  test('times out safely and terminates the taskkill host', async () => {
    let killCount = 0;
    const taskkill = createFakeChild(() => {
      killCount += 1;
      return true;
    });

    await expect(
      runBoundedWindowsTaskkill(
        123,
        5,
        () => taskkill as ChildProcess,
      ),
    ).rejects.toThrow('E2E_MANAGED_PROCESS_TREE_TASKKILL_TIMEOUT');
    expect(killCount).toBe(1);
    expect(taskkill.listenerCount('exit')).toBe(0);
    expect(taskkill.listenerCount('error')).toBe(0);
  });

  test('maps launcher and process failures to closed error codes', async () => {
    await expect(
      runBoundedWindowsTaskkill(123, 100, () => {
        throw new Error('raw launcher failure');
      }),
    ).rejects.toThrow('E2E_MANAGED_PROCESS_TREE_TASKKILL_FAILED');

    const taskkill = createFakeChild();
    const result = runBoundedWindowsTaskkill(
      123,
      100,
      () => taskkill as ChildProcess,
    );
    taskkill.emit('error', new Error('raw process failure'));
    await expect(result).rejects.toThrow(
      'E2E_MANAGED_PROCESS_TREE_TASKKILL_FAILED',
    );
  });
});

function createFakeChild(
  kill: (signal?: NodeJS.Signals | number) => boolean = () => true,
): ControlledManagedChild {
  let exitCode: number | null = null;
  const child = new EventEmitter();
  Object.defineProperties(child, {
    exitCode: { get: () => exitCode },
    pid: { value: 123 },
    signalCode: { get: () => null },
  });
  Object.assign(child, {
    kill,
    setExitCode(value: number | null) {
      exitCode = value;
    },
  });
  return child as ControlledManagedChild;
}

type ControlledManagedChild = ManagedChildProcess & {
  setExitCode(value: number | null): void;
};

function createMonotonicClock(): () => number {
  let value = 0;
  return () => {
    value += 1;
    return value;
  };
}

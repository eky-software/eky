import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';

import { expect, test } from '@playwright/test';

import {
  createE2eBackendStartupReporter,
  waitForManagedBackendHealth,
  type E2eBackendStartupProgress,
} from '../../src/environment/e2eBackendStartupLifecycle.js';
import {
  E2E_BACKEND_STARTUP_SAFETY_TIMEOUT_MILLISECONDS,
} from '../../src/environment/e2eServiceStartupBudgets.js';
import {
  observeChildProcessStartup,
  type E2eProcessStartupObservation,
} from '../../src/environment/e2eProcessStartupObservation.js';
import type { ManagedChildProcess } from '../../src/environment/startManagedProcess.js';
import { E2eBackendStartupFailure, reportOwnedBackendStartupFailure, startE2eBackendProcess, waitForE2eBackendStartup } from '../../src/environment/startE2eBackendProcess.js';
import { OwnedWindowsBackendStartupFailure } from '../../src/environment/startOwnedWindowsBackend.js';
import { waitForHttpHealth, type HttpHealthProbeOutcome } from '../../src/environment/waitForHttpHealth.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { createE2eFixtureLifetime } from '../../src/environment/e2eFixtureLifetime.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';

test.describe('managed E2E backend startup lifecycle', () => {
  test('wires the real health response through backend preparation without accepting failed ownership', async () => {
    const runRoot = createE2eRunRoot();
    const scenarioId = 'SYS-BACKEND-HEALTH-001';
    const child = createFakeChild();
    child.emit('spawn');
    let requests = 0;
    let stopped = false;
    const server = createServer((_request, response) => { requests++; response.writeHead(200).end(); });
    const stop = async () => {
      if (stopped) return;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      stopped = true;
      child.emit('close', 0, null);
    };
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('TEST_ADDRESS_UNAVAILABLE');
      await expect(startE2eBackendProcess({
        backendPort: address.port, runRoot, scenarioId,
        paths: createE2eWorkerPaths(runRoot, scenarioId),
        lifetime: createE2eFixtureLifetime(60_000),
      }, {
        async startOwned() {
          return {
            startup: child.startup, readStdout: () => '', readStderr: () => '', stop,
            workload: {
              instanceId: 'synthetic-health-probe',
              readState: async () => 'unavailable', readRssBytes: async () => 0,
            },
          };
        },
      })).rejects.toMatchObject({
        message: 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST',
        evidence: { lastHealthProbe: 'healthy', cleanup: { processTree: 'stopped', port: 'released' } },
      });
      expect(requests).toBe(1);
      expect(stopped).toBe(true);
    } finally {
      await stop();
      await removeE2eRunRoot(runRoot);
    }
  });

  for (const [failure, code] of [
    ['preparationFailed', 'E2E_BACKEND_PROCESS_SPAWN_FAILED'],
    ['ownerSpawnFailed', 'E2E_BACKEND_PROCESS_SPAWN_FAILED'],
    ['launchFailed', 'E2E_BACKEND_PROCESS_SPAWN_FAILED'],
    ['startupDeadlineExceeded', 'E2E_BACKEND_HEALTH_TIMEOUT'],
    ['observationLost', 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST'],
    ['workloadExited', 'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH'],
  ] as const) {
    test(`retains owner failure and independent cleanup proof: ${failure}`, async () => {
      let released = 0;
      const progress: E2eBackendStartupProgress[] = [];
      const error = new OwnedWindowsBackendStartupFailure({
        startupFailure: failure, processTree: 'stopped',
        spawnObserved: true, exitedBeforeCleanup: failure === 'workloadExited',
      }, { readStdout: () => 'E2E backend listening on http://127.0.0.1:12345\n', readStderr: () => '' });
      await expect(reportOwnedBackendStartupFailure({
        error, backendOrigin: 'http://127.0.0.1:12345', observe: event => progress.push(event),
        async releasePort() { released++; },
      })).rejects.toMatchObject({
        message: code, evidence: { errorCode: code, listeningNotice: 'observed', lastHealthProbe: 'notObserved',
          spawnObserved: true, exitedBeforeCleanup: failure === 'workloadExited',
          cleanup: { processTree: 'stopped', port: 'released' } },
      });
      expect(released).toBe(1);
      expect(progress.at(-1)).toMatchObject({ phase: 'cleanupCompleted', status: 'completed' });
    });
  }

  test('retains unverified owner cleanup and port failure without exposing raw output', async () => {
    const error = new OwnedWindowsBackendStartupFailure({
      startupFailure: 'workloadExited', processTree: 'unverified',
      spawnObserved: true, exitedBeforeCleanup: true,
    }, { readStdout: () => '', readStderr: () => 'EADDRINUSE synthetic private detail' });
    const result = reportOwnedBackendStartupFailure({
      error, backendOrigin: 'http://127.0.0.1:12345', observe() {},
      async releasePort() { throw new Error('private port detail'); },
    });
    await expect(result).rejects.toMatchObject({
      message: 'E2E_BACKEND_LOOPBACK_ADDRESS_IN_USE',
      evidence: { cleanup: { processTree: 'unverified', port: 'unverified' } },
    });
    const failure = await result.catch((caught: unknown) => caught);
    expect(JSON.stringify(failure)).not.toContain('private');
    expect(failure).toBeInstanceOf(E2eBackendStartupFailure);
    const output = (failure as E2eBackendStartupFailure).readPrivateOutput();
    expect(output).toEqual({ stdout: '', stderr: 'EADDRINUSE synthetic private detail' });
    expect(Object.isFrozen(output)).toBe(true);
  });

  test('snapshots redacted startup output before cleanup can change the process buffer', async () => {
    const child = createFakeChild();
    child.emit('spawn');
    let stderr = 'synthetic [REDACTED] first failure';
    let released = false;
    const result = waitForE2eBackendStartup({
      backendOrigin: 'http://127.0.0.1:12345',
      managedProcess: { startup: child.startup, readStdout: () => 'synthetic startup', readStderr: () => stderr },
      observe() {},
      async waitForHealth() { throw new Error('E2E_BACKEND_HEALTH_TIMEOUT'); },
      async stopProcessTree() { stderr = 'cleanup output'; child.emit('close', 0, null); },
      async releasePort() { released = true; },
    });
    const failure = await result.catch((error: unknown) => error);
    expect(released).toBe(true);
    expect(failure).toBeInstanceOf(E2eBackendStartupFailure);
    expect((failure as E2eBackendStartupFailure).readPrivateOutput()).toEqual({
      stdout: 'synthetic startup', stderr: 'synthetic [REDACTED] first failure',
    });
    expect(JSON.stringify(failure)).not.toContain('synthetic');
  });

  test('health failure retains cleanup proof even when owner stop reports an earlier operational failure', async () => {
    const child = createFakeChild();
    child.emit('spawn');
    await expect(waitForE2eBackendStartup({
      backendOrigin: 'http://127.0.0.1:12345',
      managedProcess: { startup: child.startup, readStdout: () => '', readStderr: () => '' },
      observe() {},
      async waitForHealth() { throw new Error('E2E_BACKEND_WORKLOAD_OBSERVATION_LOST'); },
      async stopProcessTree() {
        throw new OwnedWindowsBackendStartupFailure({
          startupFailure: 'observationLost', processTree: 'stopped',
          spawnObserved: true, exitedBeforeCleanup: false,
        }, { readStdout: () => '', readStderr: () => '' });
      },
      async releasePort() {},
    })).rejects.toMatchObject({
      message: 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST',
      evidence: { cleanup: { processTree: 'stopped', port: 'released' } },
    });
    child.emit('close', 0, null);
  });

  test('observes actual spawn after handle return and removes the listener after health', async () => {
    const child = createFakeChild();
    const progress: E2eBackendStartupProgress[] = [];
    let ready!: () => void;
    const health = new Promise<void>((resolve) => { ready = resolve; });
    const calls: string[] = [];
    const result = waitForE2eBackendStartup({
      backendOrigin: 'http://127.0.0.1:12345',
      managedProcess: { startup: child.startup, readStdout: () => '', readStderr: () => '' },
      observe: (event) => progress.push(event),
      waitForHealth: () => health,
      async stopProcessTree() { calls.push('stop'); },
      async releasePort() { calls.push('release'); },
    });
    expect(progress.some((event) => event.phase === 'processSpawned')).toBe(false);
    child.emit('spawn');
    expect(progress.at(-1)).toMatchObject({ phase: 'processSpawned', status: 'completed' });
    ready();
    await expect(result).resolves.toBeUndefined();
    expect(progress.at(-1)).toMatchObject({ phase: 'healthReady', status: 'completed' });
    expect(calls).toEqual([]);
    expect(child.listenerCount('spawn')).toBe(0);
    child.emit('close', 0, null);
  });

  for (const outcome of ['healthy', 'connectionRefused', 'requestTimedOut', 'responseNotOk', 'transportFailed'] as const) {
    test(`seals the last completed health probe before failing cleanup: ${outcome}`, async () => {
      const child = createFakeChild();
      child.emit('spawn');
      let report!: (value: HttpHealthProbeOutcome) => void;
      const calls: string[] = [];
      const result = waitForE2eBackendStartup({
        backendOrigin: 'http://127.0.0.1:12345',
        managedProcess: { startup: child.startup, readStdout: () => '', readStderr: () => '' },
        observe() {},
        async waitForHealth(_signal, onProbeCompleted) {
          report = onProbeCompleted;
          report('connectionRefused');
          report(outcome);
          throw new Error('E2E_BACKEND_HEALTH_TIMEOUT');
        },
        async stopProcessTree() {
          calls.push('tree');
          report('healthy');
          throw new Error('private cleanup error');
        },
        async releasePort() {
          calls.push('port');
          report('responseNotOk');
        },
      });
      await expect(result).rejects.toMatchObject({
        message: 'E2E_BACKEND_HEALTH_TIMEOUT', evidence: {
          lastHealthProbe: outcome, cleanup: { processTree: 'unverified', port: 'released' },
        },
      });
      const failure = await result.catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(E2eBackendStartupFailure);
      const evidence = (failure as E2eBackendStartupFailure).evidence;
      report('transportFailed');
      expect(evidence.lastHealthProbe).toBe(outcome);
      expect(Object.isFrozen(evidence)).toBe(true);
      expect(calls).toEqual(['tree', 'port']);
      child.emit('close', 1, null);
    });
  }

  test('keeps an in-flight probe unknown after process exit and ignores its late completion', async () => {
    const child = createFakeChild();
    child.emit('spawn');
    let report!: (value: HttpHealthProbeOutcome) => void;
    let started!: () => void;
    const healthStarted = new Promise<void>((resolve) => { started = resolve; });
    const result = waitForE2eBackendStartup({
      backendOrigin: 'http://127.0.0.1:12345',
      managedProcess: { startup: child.startup, readStdout: () => '', readStderr: () => '' },
      observe() {},
      waitForHealth(signal, onProbeCompleted) {
        report = onProbeCompleted;
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { report('requestTimedOut'); resolve(); }, { once: true });
          started();
        });
      },
      async stopProcessTree() { report('requestTimedOut'); },
      async releasePort() {},
    });
    await healthStarted;
    child.setExitCode(1);
    child.emit('exit', 1, null);
    await expect(result).rejects.toMatchObject({
      message: 'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH', evidence: { lastHealthProbe: 'notObserved' },
    });
    report('healthy');
    await expect(result).rejects.toMatchObject({ evidence: { lastHealthProbe: 'notObserved' } });
    child.emit('close', 1, null);
  });

  test('projects an unsupported probe observation to unknown without exposing it', () => {
    const failure = new E2eBackendStartupFailure({
      errorCode: 'E2E_BACKEND_HEALTH_TIMEOUT', spawnObserved: true, exitedBeforeCleanup: false,
      listeningNotice: 'notObserved', lastHealthProbe: 'private transport detail' as HttpHealthProbeOutcome,
      cleanup: { processTree: 'stopped', port: 'released' },
    });
    expect(failure.evidence.lastHealthProbe).toBe('notObserved');
    expect(JSON.stringify(failure)).not.toContain('private');
  });

  for (const mode of ['beforeListening', 'afterListening', 'cleanupFailure', 'portFailure', 'outputFailure', 'earlyExit', 'spawnFailure'] as const) {
    test(`preserves backend preparation failure and independent cleanup: ${mode}`, async () => {
      const child = createFakeChild();
      const calls: string[] = [];
      const lines: string[] = [];
      const listening = 'E2E backend listening on http://127.0.0.1:12345\n';
      const result = waitForE2eBackendStartup({
        backendOrigin: 'http://127.0.0.1:12345',
        managedProcess: {
          startup: child.startup,
          readStdout: () => {
            if (mode === 'outputFailure') throw new Error('private output failure');
            return mode === 'afterListening' ? listening : 'private output and session';
          },
          readStderr: () => 'private stderr and environment',
        },
        observe: createE2eBackendStartupReporter({ writeLine(line) {
          lines.push(line);
          if (mode === 'outputFailure') throw new Error('private logger failure');
        } }),
        async waitForHealth() {
          if (mode === 'spawnFailure') {
            child.emit('error', new Error('private spawn failure'));
          } else {
            child.emit('spawn');
            if (mode === 'earlyExit') {
              child.setExitCode(1);
              child.emit('exit', 1, null);
            }
          }
          throw new Error('private health detail');
        },
        async stopProcessTree() {
          calls.push('stop');
          if (mode === 'cleanupFailure') throw new Error('private cleanup failure');
          child.setExitCode(1);
        },
        async releasePort() {
          calls.push('release');
          if (mode === 'portFailure') throw new Error('private port failure');
        },
      });
      const errorCode = mode === 'spawnFailure' ? 'E2E_BACKEND_PROCESS_SPAWN_FAILED'
        : mode === 'earlyExit' ? 'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH'
          : 'E2E_BACKEND_HEALTH_TIMEOUT';
      await expect(result).rejects.toMatchObject({
        message: errorCode,
        evidence: {
          errorCode,
          spawnObserved: mode !== 'spawnFailure',
          exitedBeforeCleanup: mode === 'earlyExit',
          listeningNotice: mode === 'outputFailure' ? 'unavailable'
            : mode === 'afterListening' ? 'observed' : 'notObserved',
          lastHealthProbe: 'notObserved',
          cleanup: {
            processTree: mode === 'cleanupFailure' ? 'unverified' : 'stopped',
            port: mode === 'portFailure' ? 'unverified' : 'released',
          },
        },
      });
      const failure = await result.catch((error: unknown) => error);
      expect(JSON.stringify(failure)).not.toMatch(/private|12345|http|session|environment/);
      expect(lines.join('\n')).not.toMatch(/private|12345|http|session|environment/);
      expect(calls).toEqual(['stop', 'release']);
      // Native observation belongs to the actual child until close, not health.
      child.emit('close', 1, null);
      expect(child.listenerCount('spawn')).toBe(0);
      expect(child.listenerCount('exit')).toBe(0);
      expect(child.listenerCount('error')).toBe(0);
    });
  }

  test('reports a healthy child without changing the startup result', async () => {
    const child = createFakeChild();
    const progress: E2eBackendStartupProgress[] = [];

    await expect(
      waitForManagedBackendHealth({
        startup: child.startup,
        observe: (event) => progress.push(event),
        waitForHealth: () => {
          child.emit('spawn');
          return Promise.resolve();
        },
      }),
    ).resolves.toBeUndefined();

    expect(progress.map(({ phase, status }) => ({ phase, status }))).toEqual([
      { phase: 'healthWaitStarted', status: 'started' },
      { phase: 'healthReady', status: 'completed' },
    ]);
    expect(child.listenerCount('exit')).toBe(1);
    expect(child.listenerCount('error')).toBe(1);
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });

  test('fails safely when the child exits before health', async () => {
    const child = createFakeChild();
    const progress: E2eBackendStartupProgress[] = [];
    let healthWaitAborted = false;
    const result = waitForManagedBackendHealth({
      startup: child.startup,
      observe: (event) => progress.push(event),
      waitForHealth: (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              healthWaitAborted = true;
              reject(new Error('health wait aborted'));
            },
            { once: true },
          );
        }),
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
    expect(child.listenerCount('error')).toBe(1);
    expect(healthWaitAborted).toBe(true);
    child.emit('close', 1, null);
    expect(child.listenerCount('error')).toBe(0);
  });

  test('keeps an alive child health timeout distinct from an early exit', async () => {
    const child = createFakeChild();
    const progress: E2eBackendStartupProgress[] = [];

    await expect(
      waitForManagedBackendHealth({
        startup: child.startup,
        observe: (event) => progress.push(event),
        waitForHealth: () => Promise.reject(new Error('raw health detail')),
      }),
    ).rejects.toThrow('E2E_BACKEND_HEALTH_TIMEOUT');
    expect(progress.at(-1)).toMatchObject({
      errorCode: 'E2E_BACKEND_HEALTH_TIMEOUT',
      phase: 'healthTimedOut',
      status: 'failed',
    });
    child.emit('close', 0, null);
  });

  for (const timing of ['beforeSubscribe', 'withHealth', 'duringFinalization'] as const) {
    test(`rejects workload observation loss ${timing} without a ChildProcess consumer`, async () => {
      const child = createFakeChild();
      const lines: string[] = [];
      child.emit('spawn');
      const loseObservation = () => child.emit('error', new Error('private operation failure'));
      if (timing === 'beforeSubscribe') loseObservation();
      const calls: string[] = [];
      const result = waitForE2eBackendStartup({
        backendOrigin: 'http://127.0.0.1:12345',
        managedProcess: {
          startup: child.startup,
          readStdout: () => '',
          readStderr: () => 'EADDRINUSE private output must not mask lost observation',
        },
        observe: createE2eBackendStartupReporter({ writeLine: (line) => lines.push(line) }),
        async waitForHealth(signal) {
          if (timing === 'withHealth') loseObservation();
          if (timing === 'duringFinalization') {
            signal.addEventListener('abort', () => queueMicrotask(loseObservation), { once: true });
          }
        },
        async stopProcessTree() {
          calls.push('stop');
          child.setExitCode(0);
          child.emit('exit', 0, null);
          child.emit('close', 0, null);
        },
        async releasePort() { calls.push('release'); },
      });
      await expect(result).rejects.toMatchObject({
        message: 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST',
        evidence: {
          spawnObserved: true,
          exitedBeforeCleanup: false,
          cleanup: { processTree: 'stopped', port: 'released' },
        },
      });
      expect(calls).toEqual(['stop', 'release']);
      expect(lines.join('\n')).toContain('workloadObservationLost');
      expect(lines.join('\n')).not.toMatch(/healthReady|private|EADDRINUSE|12345/);
      expect(child.startup.readState().terminal).toBe('observationLost');
    });
  }

  test('does not infer workload spawn from health or a numeric PID', async () => {
    const child = createFakeChild();
    await expect(waitForManagedBackendHealth({
      startup: child.startup,
      observe: () => {},
      waitForHealth: async () => {},
    })).rejects.toThrow('E2E_BACKEND_WORKLOAD_OBSERVATION_LOST');
    child.emit('close', 0, null);
  });

  test('a failed fresh workload check stays distinct from a health timeout', async () => {
    const child = createFakeChild();
    child.emit('spawn');
    const progress: E2eBackendStartupProgress[] = [];
    await expect(waitForManagedBackendHealth({
      startup: child.startup,
      observe: event => progress.push(event),
      async waitForHealth() { throw new Error('E2E_BACKEND_WORKLOAD_OBSERVATION_LOST'); },
    })).rejects.toThrow('E2E_BACKEND_WORKLOAD_OBSERVATION_LOST');
    expect(progress.at(-1)?.phase).toBe('workloadObservationLost');
    child.emit('close', 0, null);
  });

  test('replays a latched spawn through the observation and releases consumer subscriptions', async () => {
    const child = createFakeChild();
    child.emit('spawn');
    const progress: E2eBackendStartupProgress[] = [];
    let subscriptions = 0;
    const startup: E2eProcessStartupObservation = {
      readState: child.startup.readState,
      subscribe(listener) {
        subscriptions++;
        const unsubscribe = child.startup.subscribe(listener);
        return () => { subscriptions--; unsubscribe(); };
      },
    };
    await waitForE2eBackendStartup({
      backendOrigin: 'http://127.0.0.1:12345',
      managedProcess: { startup, readStdout: () => '', readStderr: () => '' },
      observe: (event) => progress.push(event),
      async waitForHealth() {},
      async stopProcessTree() { throw new Error('must not stop a healthy workload'); },
      async releasePort() { throw new Error('must not release a healthy workload port'); },
    });
    expect(subscriptions).toBe(0);
    expect(progress.map(({ phase }) => phase)).toEqual([
      'processSpawned', 'healthWaitStarted', 'healthReady',
    ]);
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
    expect(progress).toHaveLength(3);
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

test.describe('dynamic HTTP health readiness', () => {
  test('returns immediately when the first health probe succeeds', async () => {
    let probeCount = 0;
    let retryWaitCount = 0;

    await expect(
      waitForHttpHealth('http://127.0.0.1:32001/health', {
        now: () => 0,
        probe: async () => {
          probeCount += 1;
          return true;
        },
        timeoutMilliseconds: 1_000,
        waitForRetry: async () => {
          retryWaitCount += 1;
        },
      }),
    ).resolves.toBeUndefined();

    expect(probeCount).toBe(1);
    expect(retryWaitCount).toBe(0);
  });

  test('accepts readiness after the former fixed threshold without sleeping', async () => {
    let now = 0;
    let probeCount = 0;
    const retryWaits: number[] = [];

    await expect(
      waitForHttpHealth('http://127.0.0.1:32002/health', {
        intervalMilliseconds: 10_000,
        now: () => now,
        probe: async () => {
          probeCount += 1;
          return probeCount === 3;
        },
        timeoutMilliseconds:
          E2E_BACKEND_STARTUP_SAFETY_TIMEOUT_MILLISECONDS,
        waitForRetry: async (milliseconds) => {
          retryWaits.push(milliseconds);
          now += milliseconds;
        },
      }),
    ).resolves.toBeUndefined();

    expect(probeCount).toBe(3);
    expect(retryWaits).toEqual([10_000, 10_000]);
    expect(now).toBe(20_000);
  });

  test('keeps the deadline as a fail-closed safety boundary', async () => {
    let now = 0;
    let probeCount = 0;

    await expect(
      waitForHttpHealth('http://127.0.0.1:32003/health', {
        intervalMilliseconds: 100,
        now: () => now,
        probe: async () => {
          probeCount += 1;
          return false;
        },
        timeoutMilliseconds: 250,
        waitForRetry: async (milliseconds) => {
          now += milliseconds;
        },
      }),
    ).rejects.toThrow('E2E_BACKEND_HEALTH_TIMEOUT');

    expect(probeCount).toBe(3);
    expect(now).toBe(250);
  });

  test('aborts an in-flight retry without leaving a background wait', async () => {
    const abort = new AbortController();
    const result = waitForHttpHealth(
      'http://127.0.0.1:32004/health',
      {
        intervalMilliseconds: 1_000,
        probe: async () => {
          queueMicrotask(() => abort.abort());
          return false;
        },
        signal: abort.signal,
        timeoutMilliseconds: 1_000,
      },
    );

    await expect(result).rejects.toThrow(
      'E2E_BACKEND_HEALTH_WAIT_ABORTED',
    );
  });
});

function createFakeChild() {
  const child = createUnobservedFakeChild();
  return Object.assign(child, { startup: observeChildProcessStartup(child) });
}

function createUnobservedFakeChild(
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

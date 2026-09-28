import { EventEmitter } from 'node:events';

import type { UtilityProcess } from 'electron';
import { expect, test } from '@playwright/test';

import { createElectronE2eBackendController } from '../../../desktop/e2e/electronE2eBackendProcess.js';
import {
  electronE2eBackendStartupStages,
  parseElectronE2eBackendProgress,
  parseElectronE2eBackendStatus,
  reportElectronE2eBackendProgress,
} from '../../../desktop/e2e/electronE2eBackendStatus.js';
import type { ElectronE2eConfig } from '../../../desktop/e2e/electronE2eConfig.js';
import {
  createElectronE2eStartupObservation,
  parseElectronE2eStartupObservation,
} from '../../../desktop/e2e/electronE2eStartupObservation.js';
import type { StartDesktopBackendOptions } from '../../../desktop/src/runtime/backendProcess.js';

const fixtureProcesses = new Set<EventEmitter>();
test.afterEach(() => {
  for (const child of fixtureProcesses) child.emit('exit', 1);
  fixtureProcesses.clear();
});

test.describe('SYS-ELECTRON-BACKEND-STARTUP-001 @critical @security', () => {
  test('distinguishes fork, spawn, start delivery and validated ready before resolving', async () => {
    const fixture = backendFixture();
    const started = fixture.start();
    let resolved = false;
    void started.then(() => { resolved = true; }, () => undefined);
    expect(fixture.duringFork).toEqual(['backendForkRequested']);
    expect(fixture.checkpoints()).toEqual([
      'backendForkRequested', 'backendForkReturned', 'backendReadinessWaitStarted',
    ]);
    expect(fixture.messages).toHaveLength(0);
    fixture.child.emit('spawn');
    expect(fixture.checkpoints()).toEqual([
      'backendForkRequested', 'backendForkReturned',
      'backendReadinessWaitStarted',
      'backendProcessSpawned', 'backendStartMessageSent',
    ]);
    expect(fixture.messages[0]).toEqual({
      message: { config: fixture.options.config, configPath: 'synthetic-config', type: 'start' },
      ports: [fixture.options.secretBrokerPort, fixture.options.invoicePdfArchiveBrokerPort,
        fixture.options.profileSnapshotBrokerPort],
    });
    fixture.child.emit('message', { type: 'ready', port: 43127, private: 'not accepted' });
    await Promise.resolve();
    expect(resolved).toBe(false);
    fixture.child.emit('message', { type: 'ready', port: 43127 });
    const handle = await started;
    expect(handle.port).toBe(43127);
    expect(fixture.checkpoints().at(-1)).toBe('backendReadyReceived');
    expect(parseElectronE2eStartupObservation(fixture.observation.snapshot()))
      .toEqual(fixture.observation.snapshot());
    expect(JSON.stringify(fixture.observation.snapshot())).not.toMatch(/synthetic|private|43127/);
    await handle.stopForUpdate();
    expect(fixture.kills()).toBe(0);
    expect(fixture.controller.isRunning()).toBe(false);
  });

  test('a returned handle without spawn is not readiness and early exit stays a failure', async () => {
    const fixture = backendFixture();
    const started = fixture.start();
    const rejected = expect(started).rejects.toThrow('E2E_BACKEND_EXITED_BEFORE_READY_FAILED');
    expect(fixture.controller.isRunning()).toBe(true);
    expect(fixture.checkpoints()).toEqual([
      'backendForkRequested', 'backendForkReturned', 'backendReadinessWaitStarted',
    ]);
    fixture.child.emit('exit', 1);
    await rejected;
    expect(fixture.messages).toHaveLength(0);
    expect(fixture.controller.isRunning()).toBe(false);
    expect(fixture.checkpoints()).not.toContain('backendReadyReceived');
  });

  test('fork failure preserves the original error without claiming a returned handle', async () => {
    const original = new Error('synthetic fork failure');
    const fixture = backendFixture({ forkFailure: original });
    await expect(fixture.start()).rejects.toBe(original);
    expect(fixture.checkpoints()).toEqual(['backendForkRequested']);
    expect(fixture.controller.isRunning()).toBe(false);
  });

  test('observation failure does not change success, startup failure or owned shutdown', async () => {
    for (const succeeds of [true, false]) {
      const fixture = backendFixture({ observerFails: true });
      const started = fixture.start();
      fixture.child.emit('spawn');
      fixture.child.emit('message', { type: 'progress', stage: 'moduleImport' });
      expect(fixture.observation.snapshot().backendStartup).toEqual({ status: 'unobserved' });
      if (succeeds) {
        fixture.child.emit('message', { type: 'ready', port: 43127 });
        const handle = await started;
        await handle.stopForUpdate();
        expect(fixture.kills()).toBe(0);
      } else {
        const rejected = expect(started).rejects.toThrow('E2E_BACKEND_MODULE_IMPORT_FAILED');
        fixture.child.emit('message', { type: 'failed', stage: 'moduleImport' });
        await rejected;
        expect(fixture.kills()).toBe(1);
      }
      expect(fixture.controller.isRunning()).toBe(false);
    }
  });

  test('wrong-port readiness remains rejected without a successful ready observation', async () => {
    const fixture = backendFixture();
    const started = fixture.start();
    const rejected = expect(started).rejects.toThrow('E2E_BACKEND_PORT_MISMATCH_FAILED');
    fixture.child.emit('spawn');
    fixture.child.emit('message', { type: 'ready', port: 43128 });
    await rejected;
    expect(fixture.kills()).toBe(1);
    expect(fixture.controller.isRunning()).toBe(false);
    expect(fixture.checkpoints()).not.toContain('backendReadyReceived');
  });

  test('progress accepts only the closed stage projection and never parses as readiness', () => {
    for (const stage of electronE2eBackendStartupStages) {
      const value = { type: 'progress', stage };
      expect(parseElectronE2eBackendProgress(value)).toEqual(value);
      expect(parseElectronE2eBackendStatus(value)).toBeUndefined();
    }
    for (const value of [
      null, [], 'moduleImport', {}, { type: 'progress' },
      { type: 'progress', stage: 'private' },
      { type: 'progress', stage: 'moduleImport', elapsedMs: 0 },
      { type: 'progress', stage: 'moduleImport', session: 'private' },
      { type: 'progress', stage: 'moduleImport', port: 43127 },
      { type: 'failed', stage: 'moduleImport' },
      { type: 'ready', port: 43127 },
    ]) expect(parseElectronE2eBackendProgress(value)).toBeUndefined();
  });

  test('progress observes the main clock but cannot resolve startup or accept unsafe fields', async () => {
    const fixture = backendFixture();
    const started = fixture.start();
    let resolved = false;
    void started.then(() => { resolved = true; }, () => undefined);
    fixture.child.emit('spawn');
    const checkpoints = fixture.checkpoints();
    fixture.setClock(125);
    fixture.child.emit('message', { type: 'progress', stage: 'moduleImport' });
    expect(fixture.observation.snapshot().backendStartup).toEqual({
      status: 'observed', stage: 'moduleImport', elapsedMs: 125,
    });
    fixture.child.emit('message', { type: 'progress', stage: 'backendStart', elapsedMs: 999 });
    fixture.child.emit('message', { type: 'progress', stage: 'private' });
    expect(fixture.observation.snapshot().backendStartup).toEqual({
      status: 'observed', stage: 'moduleImport', elapsedMs: 125,
    });
    fixture.setClock(250);
    fixture.child.emit('message', { type: 'progress', stage: 'readyNotification' });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(fixture.kills()).toBe(0);
    expect(fixture.checkpoints()).toEqual(checkpoints);
    fixture.child.emit('message', { type: 'ready', port: 43127 });
    const handle = await started;
    const completed = fixture.observation.snapshot();
    fixture.child.emit('message', { type: 'progress', stage: 'backendStart' });
    expect(fixture.observation.snapshot()).toEqual(completed);
    await handle.stopForUpdate();
  });

  test('the reporter sends only immutable progress and a send failure cannot replace startup work', () => {
    const sent: unknown[] = [];
    for (const stage of electronE2eBackendStartupStages) {
      reportElectronE2eBackendProgress(stage, (value) => { sent.push(value); });
    }
    expect(sent).toEqual(electronE2eBackendStartupStages.map((stage) => ({ type: 'progress', stage })));
    expect(sent.every(Object.isFrozen)).toBe(true);
    expect(() => reportElectronE2eBackendProgress('moduleImport', () => {
      throw new Error('private send failure');
    })).not.toThrow();
  });

  for (const terminal of ['failed', 'exit', 'wrongPort'] as const) {
    test(`late progress after ${terminal} preserves the last pre-terminal observation`, async () => {
      const fixture = backendFixture();
      const started = fixture.start();
      const failure = terminal === 'failed' ? 'E2E_BACKEND_MODULE_IMPORT_FAILED'
        : terminal === 'exit' ? 'E2E_BACKEND_EXITED_BEFORE_READY_FAILED'
          : 'E2E_BACKEND_PORT_MISMATCH_FAILED';
      const rejected = expect(started).rejects.toThrow(failure);
      fixture.child.emit('spawn');
      fixture.child.emit('message', { type: 'progress', stage: 'moduleImport' });
      if (terminal === 'exit') fixture.child.emit('exit', 1);
      else fixture.child.emit('message', terminal === 'failed'
        ? { type: 'failed', stage: 'moduleImport' } : { type: 'ready', port: 43128 });
      // Deliberately deliver before the synthetic kill's queued exit callback.
      fixture.child.emit('message', { type: 'progress', stage: 'backendStart' });
      await rejected;
      expect(fixture.observation.snapshot().backendStartup).toEqual({
        status: 'observed', stage: 'moduleImport', elapsedMs: 0,
      });
      expect(fixture.kills()).toBe(terminal === 'exit' ? 0 : 1);
      expect(fixture.controller.isRunning()).toBe(false);
    });
  }

  test('progress cannot renew the existing readiness budget or change timeout cleanup', async () => {
    const fixture = backendFixture();
    const originalSet = globalThis.setTimeout;
    const originalClear = globalThis.clearTimeout;
    const timers: { callback: () => void; milliseconds: number | undefined }[] = [];
    const cleared: unknown[] = [];
    const handle = {} as ReturnType<typeof setTimeout>;
    let started!: ReturnType<typeof fixture.start>;
    let rejected!: Promise<void>;
    // Capture only synchronous controller operations; restore globals before awaiting.
    globalThis.setTimeout = ((callback: () => void, milliseconds?: number) => {
      timers.push({ callback, milliseconds });
      return handle;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((value: unknown) => { cleared.push(value); }) as typeof clearTimeout;
    try {
      started = fixture.start();
      rejected = expect(started).rejects.toThrow('E2E_BACKEND_READY_TIMEOUT_FAILED');
      fixture.child.emit('spawn');
      for (const stage of electronE2eBackendStartupStages) {
        fixture.child.emit('message', { type: 'progress', stage });
      }
      expect(timers).toHaveLength(1);
      const timer = timers[0]!;
      expect(timer.milliseconds).toBe(30_000);
      expect(cleared).toEqual([]);
      timer.callback();
      fixture.child.emit('message', { type: 'progress', stage: 'moduleImport' });
      fixture.child.emit('exit', 1);
    } finally {
      globalThis.setTimeout = originalSet;
      globalThis.clearTimeout = originalClear;
    }
    await rejected;
    expect(fixture.observation.snapshot().backendStartup).toEqual({
      status: 'observed', stage: 'readyNotification', elapsedMs: 0,
    });
    expect(fixture.checkpoints()).toContain('backendReadinessTimedOut');
    expect(fixture.checkpoints()).not.toContain('backendReadyReceived');
    expect(fixture.kills()).toBe(1);
    expect(fixture.controller.isRunning()).toBe(false);
  });
});

function backendFixture(fault: { forkFailure?: Error; observerFails?: boolean } = {}) {
  const child = new EventEmitter();
  fixtureProcesses.add(child);
  let killCount = 0;
  const messages: { message: unknown; ports: unknown }[] = [];
  let elapsed = 0;
  const observation = createElectronE2eStartupObservation(() => elapsed);
  const checkpoints = () => observation.snapshot().checkpoints.map((entry) => entry.checkpoint);
  let duringFork: ReturnType<typeof checkpoints> = [];
  const config = {
    backend: { port: 43127, sessionSecret: 'synthetic-session', configPath: 'synthetic-config' },
  } as ElectronE2eConfig;
  const options = {
    config: { runtimeSessionSecret: config.backend.sessionSecret },
    secretBrokerPort: {}, invoicePdfArchiveBrokerPort: {}, profileSnapshotBrokerPort: {},
  } as StartDesktopBackendOptions;
  const controller = createElectronE2eBackendController(config, 'synthetic-runner', {
    fork() {
      duringFork = checkpoints();
      if (fault.forkFailure !== undefined) throw fault.forkFailure;
      return Object.assign(child, {
        postMessage(message: { type: string }, ports: unknown) {
          messages.push({ message, ports });
          if (message.type === 'shutdown') queueMicrotask(() => child.emit('exit', 0));
        },
        kill() {
          killCount += 1;
          queueMicrotask(() => child.emit('exit', 1));
          return true;
        },
      }) as unknown as UtilityProcess;
    },
    observeStartup(checkpoint) {
      if (fault.observerFails) throw new Error('synthetic observation failure');
      observation.record(checkpoint);
    },
    observeBackendStartupStage(stage) {
      if (fault.observerFails) throw new Error('synthetic observation failure');
      observation.recordBackendStartupStage(stage);
    },
  });
  return {
    child, controller, observation, options, messages, checkpoints,
    get duringFork() { return duringFork; },
    setClock: (value: number) => { elapsed = value; },
    kills: () => killCount,
    start: () => controller.startBackend(options),
  };
}

import { EventEmitter } from 'node:events';

import type { UtilityProcess } from 'electron';
import { expect, test } from '@playwright/test';

import { createElectronE2eBackendController } from '../../../desktop/e2e/electronE2eBackendProcess.js';
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
    expect(fixture.checkpoints()).toEqual(['backendForkRequested', 'backendForkReturned']);
    expect(fixture.messages).toHaveLength(0);
    fixture.child.emit('spawn');
    expect(fixture.checkpoints()).toEqual([
      'backendForkRequested', 'backendForkReturned',
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
    expect(fixture.checkpoints()).toEqual(['backendForkRequested', 'backendForkReturned']);
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
});

function backendFixture(fault: { forkFailure?: Error; observerFails?: boolean } = {}) {
  const child = new EventEmitter();
  fixtureProcesses.add(child);
  let killCount = 0;
  const messages: { message: unknown; ports: unknown }[] = [];
  const observation = createElectronE2eStartupObservation(() => 0);
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
  });
  return {
    child, controller, observation, options, messages, checkpoints,
    get duringFork() { return duringFork; },
    kills: () => killCount,
    start: () => controller.startBackend(options),
  };
}

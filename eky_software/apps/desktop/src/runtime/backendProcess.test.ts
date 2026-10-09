import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

import type { MessagePortMain } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startDesktopBackend, type StartDesktopBackendOptions } from './backendProcess.js';
import * as backendEnvironment from './backendEnvironment.js';
import { DesktopBackendStartupError, DesktopBackendStartupStoppedError } from './backendStartupFailure.js';

const boundary = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: boundary.fork } }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('backend process shutdown result', () => {
  it.each(['exited', 'forced'] as const)('preserves the observed %s outcome for its owner', async (outcome) => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    const stopped = fixture.backend.stop();
    expect(fixture.postMessage).toHaveBeenLastCalledWith({ type: 'shutdown' });
    if (outcome === 'forced') {
      await vi.advanceTimersByTimeAsync(3_000);
      expect(fixture.kill).toHaveBeenCalledOnce();
    }
    fixture.process.emit('exit', 0);

    await expect(stopped).resolves.toBe(outcome);
    expect(fixture.write.mock.calls.some(([event]) =>
      event.eventName === 'backendProcess.stopFailed',
    )).toBe(outcome === 'forced');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not acknowledge a forced stop without an observed exit', async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    const rejection = expect(fixture.backend.stop()).rejects.toThrow(
      'The backend did not exit after forced termination.',
    );
    await vi.advanceTimersByTimeAsync(6_000);
    await rejection;
    expect(fixture.kill).toHaveBeenCalledOnce();
  });

  it('keeps update shutdown strict without invoking the forced fallback', async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    const rejection = expect(fixture.backend.stopForUpdate(operationId)).rejects.toThrow(
      'The backend did not stop gracefully within the allowed time.',
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await rejection;
    expect(fixture.kill).not.toHaveBeenCalled();
  });

  it('keeps successful update shutdown compatible', async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    const stopped = fixture.backend.stopForUpdate(operationId);
    expect(fixture.postMessage).toHaveBeenCalledWith({ type: 'shutdownForUpdate', operationId });
    fixture.process.emit('exit', 0);
    await expect(stopped).resolves.toBeUndefined();
    expect(fixture.kill).not.toHaveBeenCalled();
  });

  it('rejects an invalid update operation before consuming the ordinary stop', async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    fixture.postMessage.mockClear();
    await expect(fixture.backend.stopForUpdate('invalid')).rejects.toThrow('BACKEND_STOP_OPERATION_INVALID');
    expect(fixture.postMessage).not.toHaveBeenCalled();
    const stopped = fixture.backend.stop();
    expect(fixture.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
    fixture.process.emit('exit', 0);
    await expect(stopped).resolves.toBe('exited');
  });

  it.each(['stop', 'stopForUpdate'] as const)(
    'rejects an unsuccessful process exit during %s',
    async (method) => {
      vi.useFakeTimers();
      const fixture = await createFixture();
      const rejection = expect((method === 'stop' ? fixture.backend.stop() : fixture.backend.stopForUpdate(operationId))).rejects.toThrow(
        'The backend exited unsuccessfully during shutdown.',
      );
      fixture.process.emit('exit', 1);
      await rejection;
      expect(fixture.kill).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe('backend migration gate private exception observation', () => {
  it.each([false, true])('preserves the original rejection before abort without leaking it (observer throws: %s)', async (observerThrows) => {
    vi.useFakeTimers();
    const original = new Error('synthetic private gate detail', { cause: new Error('synthetic inner cause') });
    const abortedAtObservation: boolean[] = [];
    const observeStartupException = vi.fn((_error: unknown) => {
      abortedAtObservation.push(fixture.postMessage.mock.calls.some(([message]) => message.type === 'abortStartup'));
      if (observerThrows) throw new Error('synthetic evidence failure');
    });
    const fixture = await createStartingFixture({
      beforeMigrations: async () => { throw original; }, observeStartupException,
    });
    const rejected = fixture.started.then(() => undefined, (error: unknown) => error);
    fixture.process.emit('message', { type: 'migrationGateReady', inspection: {
      appliedMigrationCount: 38, migrationChainIdentity: 'b'.repeat(64),
      pendingMigrationCount: 1, profileState: 'existing',
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(observeStartupException).toHaveBeenCalledExactlyOnceWith(original);
    expect(abortedAtObservation).toEqual([false]);
    expect(fixture.postMessage).toHaveBeenLastCalledWith({ type: 'abortStartup' });
    fixture.process.emit('message', { type: 'failed', code: 'BACKEND_MIGRATION_STARTUP_GATE_FAILED' });
    fixture.process.emit('exit', 1);
    const result = await rejected;
    expect(result).toMatchObject({ message: 'BACKEND_MIGRATION_STARTUP_GATE_FAILED',
      ownership: { processState: 'absent', migrationGateSettled: true } });
    expect(result).not.toHaveProperty('cause');
    expect(fixture.kill).toHaveBeenCalledOnce();
    expect(JSON.stringify(fixture.write.mock.calls)).not.toContain('synthetic private');
    expect(JSON.stringify(fixture.write.mock.calls)).not.toContain('synthetic inner');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('observes a rejection after the coordinator has already stopped the startup process', async () => {
    vi.useFakeTimers();
    const original = new Error('synthetic failure after requested shutdown');
    const observeStartupException = vi.fn();
    const fixture = await createStartingFixture({
      async beforeMigrations(_inspection, control) {
        await control.stopStartupRuntime();
        throw original;
      },
      observeStartupException,
    });
    const result = fixture.started.then(() => undefined, (error: unknown) => error);
    fixture.process.emit('message', { type: 'migrationGateReady', inspection: {
      appliedMigrationCount: 38, migrationChainIdentity: 'b'.repeat(64),
      pendingMigrationCount: 1, profileState: 'existing',
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.postMessage).toHaveBeenLastCalledWith({ type: 'shutdown' });
    fixture.process.emit('exit', 0);
    expect(await result).toMatchObject({ message: 'BACKEND_MIGRATION_STARTUP_GATE_FAILED',
      ownership: { processState: 'absent', migrationGateSettled: true } });
    expect(observeStartupException).toHaveBeenCalledExactlyOnceWith(original);
    expect(fixture.postMessage).not.toHaveBeenCalledWith({ type: 'abortStartup' });
    expect(fixture.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not invoke private observation on a successful migration decision', async () => {
    vi.useFakeTimers();
    const observeStartupException = vi.fn();
    const fixture = await createStartingFixture({ observeStartupException });
    fixture.process.emit('message', { type: 'migrationGateReady', inspection: {
      appliedMigrationCount: 38, migrationChainIdentity: 'b'.repeat(64),
      pendingMigrationCount: 1, profileState: 'existing',
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.postMessage).toHaveBeenLastCalledWith({ type: 'continueStartup' });
    fixture.process.emit('message', { type: 'ready', port: 12345,
      smokePdfCreated: false, smokeSecretBrokerVerified: false });
    const backend = await fixture.started;
    const stopped = backend.stop();
    fixture.process.emit('exit', 0);
    await expect(stopped).resolves.toBe('exited');
    expect(observeStartupException).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('backend startup ownership', () => {
  it('retains a spontaneous exit while the migration callback is still pending', async () => {
    vi.useFakeTimers();
    const gate = createGate();
    const fixture = await createStartingFixture({ beforeMigrations: () => gate.promise });
    const result = captureFailure(fixture.started);
    fixture.process.emit('message', migrationGateMessage);
    await vi.advanceTimersByTimeAsync(0);
    fixture.process.emit('exit', 1);
    const failure = await result;
    expect(failure).toMatchObject({ message: 'BACKEND_EXITED_BEFORE_READY',
      ownership: { processState: 'absent', migrationGateSettled: false } });
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.kill).not.toHaveBeenCalled();
    expect(fixture.postMessage).not.toHaveBeenCalledWith({ type: 'continueStartup' });
    expect(failure.ownership.migrationGateSettled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps ready closed while the gate is pending, then starts after the decision', async () => {
    vi.useFakeTimers();
    const gate = createGate();
    const fixture = await createStartingFixture({ beforeMigrations: () => gate.promise });
    fixture.process.emit('message', migrationGateMessage);
    await vi.advanceTimersByTimeAsync(0);
    fixture.process.emit('message', readyMessage);
    expect(fixture.write.mock.calls.some(([event]) => event.eventName === 'backendProcess.started')).toBe(false);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    fixture.process.emit('message', readyMessage);
    const handle = await fixture.started;
    const stopped = handle.stop();
    fixture.process.emit('exit', 0);
    await expect(stopped).resolves.toBe('exited');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not return controlled-stop permission after the migration deadline expires', async () => {
    vi.useFakeTimers();
    const beginStop = createGate();
    const afterStop = vi.fn();
    const fixture = await createStartingFixture({ async beforeMigrations(_inspection, control) {
      await beginStop.promise;
      await control.stopStartupRuntime();
      afterStop();
    } });
    fixture.kill.mockImplementation(() => { fixture.process.emit('exit', 0); return true; });
    const result = captureFailure(fixture.started);
    fixture.process.emit('message', migrationGateMessage);
    await vi.advanceTimersByTimeAsync(299_000);
    beginStop.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await result).message).toBe('BACKEND_READINESS_TIMEOUT');
    expect(afterStop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a failed controlled stop whose callback deliberately never settles', async () => {
    vi.useFakeTimers();
    const gate = createGate();
    const fixture = await createStartingFixture({ async beforeMigrations(_inspection, control) {
      try { await control.stopStartupRuntime(); }
      catch { await gate.promise; }
    } });
    const result = captureFailure(fixture.started);
    fixture.process.emit('message', migrationGateMessage);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await result).toMatchObject({ message: 'BACKEND_MIGRATION_STARTUP_GATE_FAILED',
      ownership: { processState: 'unknown', migrationGateSettled: false } });
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.postMessage).not.toHaveBeenCalledWith({ type: 'continueStartup' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['failed', 'timeout'] as const)(
    'locks the first %s cause before a synchronous failing exit', async (source) => {
      vi.useFakeTimers();
      const fixture = await createStartingFixture();
      const result = captureFailure(fixture.started);
      fixture.kill.mockImplementation(() => {
        fixture.process.emit('exit', 1);
        return true;
      });
      if (source === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
      else fixture.process.emit('message', { type: 'failed', code: 'BACKEND_MODULE_IMPORT_FAILED' });
      expect(await result).toMatchObject({
        message: source === 'timeout' ? 'BACKEND_READINESS_TIMEOUT' : 'BACKEND_MODULE_IMPORT_FAILED',
        ownership: { processState: 'absent', migrationGateSettled: true },
      });
      expect(fixture.write.mock.calls.filter(([event]) => event.eventName === 'backendProcess.healthFailed')).toHaveLength(1);
      expect(fixture.write.mock.calls.some(([event]) => event.eventName === 'backendProcess.unexpectedExit')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('waits for delayed exit and ignores late ready without losing the first reason', async () => {
    vi.useFakeTimers();
    const fixture = await createStartingFixture();
    const result = captureFailure(fixture.started);
    let settled = false;
    void result.then(() => { settled = true; });
    fixture.process.emit('message', { type: 'failed', code: 'BACKEND_MODULE_IMPORT_FAILED' });
    fixture.process.emit('message', readyMessage);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).toBe(false);
    fixture.process.emit('exit', 1);
    expect(await result).toMatchObject({ message: 'BACKEND_MODULE_IMPORT_FAILED',
      ownership: { processState: 'absent', migrationGateSettled: true } });
    expect(fixture.write.mock.calls.some(([event]) => event.eventName === 'backendProcess.started')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['true', 'false', 'throws'] as const)(
    'does not invent absence from kill returning %s without exit', async (behavior) => {
      vi.useFakeTimers();
      const fixture = await createStartingFixture();
      const result = captureFailure(fixture.started);
      fixture.kill.mockImplementation(() => {
        if (behavior === 'throws') throw new Error('synthetic private kill failure');
        return behavior === 'true';
      });
      fixture.process.emit('message', { type: 'failed', code: 'BACKEND_MODULE_IMPORT_FAILED' });
      await vi.advanceTimersByTimeAsync(3_000);
      const failure = await result;
      expect(failure).toMatchObject({ message: 'BACKEND_MODULE_IMPORT_FAILED',
        ownership: { processState: 'unknown', migrationGateSettled: true } });
      expect(Object.isFrozen(failure.ownership)).toBe(true);
      fixture.process.emit('exit', 0);
      fixture.process.emit('message', readyMessage);
      expect(failure.ownership.processState).toBe('unknown');
      expect(fixture.kill).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['completed', 'failed', 'pending'] as const)(
    'preserves callback settlement separately from exit (%s)', async (outcome) => {
      vi.useFakeTimers();
      const gate = createGate();
      const fixture = await createStartingFixture({ beforeMigrations: () => gate.promise });
      const result = captureFailure(fixture.started);
      fixture.process.emit('message', migrationGateMessage);
      await vi.advanceTimersByTimeAsync(0);
      fixture.process.emit('message', { type: 'failed', code: 'BACKEND_SERVER_START_FAILED' });
      if (outcome === 'completed') gate.resolve();
      if (outcome === 'failed') gate.reject(new Error('synthetic late gate failure'));
      await vi.advanceTimersByTimeAsync(0);
      fixture.process.emit('exit', 1);
      const failure = await result;
      expect(failure).toMatchObject({ message: 'BACKEND_SERVER_START_FAILED',
        ownership: { processState: 'absent', migrationGateSettled: outcome !== 'pending' } });
      if (outcome === 'pending') {
        gate.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(failure.ownership.migrationGateSettled).toBe(false);
      }
      expect(fixture.postMessage).not.toHaveBeenCalledWith({ type: 'continueStartup' });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not start a deferred gate after an immediate terminal failure', async () => {
    vi.useFakeTimers();
    const beforeMigrations = vi.fn(async () => undefined);
    const fixture = await createStartingFixture({ beforeMigrations });
    const result = captureFailure(fixture.started);
    fixture.process.emit('message', migrationGateMessage);
    fixture.process.emit('message', { type: 'failed', code: 'BACKEND_SERVER_START_FAILED' });
    await vi.advanceTimersByTimeAsync(0);
    fixture.process.emit('exit', 1);
    expect((await result).ownership.migrationGateSettled).toBe(true);
    expect(beforeMigrations).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('captures a synchronous gate throw and emits only its safe code', async () => {
    vi.useFakeTimers();
    const original = new Error('synthetic synchronous private detail');
    const observeStartupException = vi.fn();
    const fixture = await createStartingFixture({
      beforeMigrations() { throw original; }, observeStartupException,
    });
    fixture.kill.mockImplementation(() => { fixture.process.emit('exit', 1); return true; });
    const result = captureFailure(fixture.started);
    fixture.process.emit('message', migrationGateMessage);
    expect(await result).toMatchObject({ message: 'BACKEND_MIGRATION_STARTUP_GATE_FAILED',
      ownership: { processState: 'absent', migrationGateSettled: true } });
    expect(observeStartupException).toHaveBeenCalledWith(original);
    expect(JSON.stringify(fixture.write.mock.calls)).not.toContain('synthetic synchronous');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the original migration deadline after a successful controlled stop', async () => {
    vi.useFakeTimers();
    const gate = createGate();
    const fixture = await createStartingFixture({ async beforeMigrations(_inspection, control) {
      await control.stopStartupRuntime();
      await gate.promise;
    } });
    const result = captureFailure(fixture.started);
    let settled = false;
    void result.then(() => { settled = true; });
    fixture.process.emit('message', migrationGateMessage);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    fixture.process.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(298_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const failure = await result;
    expect(failure).not.toBeInstanceOf(DesktopBackendStartupStoppedError);
    expect(failure).toMatchObject({ message: 'BACKEND_READINESS_TIMEOUT',
      ownership: { processState: 'absent', migrationGateSettled: false } });
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.postMessage).not.toHaveBeenCalledWith({ type: 'continueStartup' });
    expect(fixture.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 1])('settles controlled stop after synchronous exit %s and the gate decision', async (exitCode) => {
    vi.useFakeTimers();
    const fixture = await createStartingFixture({ async beforeMigrations(_inspection, control) {
      await control.stopStartupRuntime();
    } });
    fixture.postMessage.mockImplementation(message => {
      if (message.type === 'shutdown') fixture.process.emit('exit', exitCode);
    });
    const result = captureFailure(fixture.started);
    fixture.process.emit('message', migrationGateMessage);
    const failure = await result;
    expect(failure.ownership.processState).toBe('absent');
    if (exitCode === 0) expect(failure).toBeInstanceOf(DesktopBackendStartupStoppedError);
    else {
      expect(failure).not.toBeInstanceOf(DesktopBackendStartupStoppedError);
      expect(failure.message).toBe('BACKEND_MIGRATION_STARTUP_GATE_FAILED');
    }
    expect(fixture.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not send start after readiness failure', async () => {
    vi.useFakeTimers();
    const fixture = await createStartingFixture({}, { deferSpawn: true });
    const result = captureFailure(fixture.started);
    await vi.advanceTimersByTimeAsync(33_000);
    fixture.process.emit('spawn');
    expect(fixture.postMessage).not.toHaveBeenCalled();
    expect((await result).ownership.processState).toBe('unknown');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not classify a thrown fork as proven process absence', async () => {
    vi.useFakeTimers();
    const fixture = await createStartingFixture({}, { forkThrows: true });
    const failure = await captureFailure(fixture.started);
    expect(failure).toMatchObject({ message: 'DESKTOP_START_FAILED',
      ownership: { processState: 'unknown', migrationGateSettled: true } });
    expect(failure).not.toHaveProperty('cause');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('distinguishes a proven failure before invoking fork', async () => {
    vi.useFakeTimers();
    vi.spyOn(backendEnvironment, 'createDesktopBackendEnvironment').mockImplementationOnce(() => {
      throw new Error('synthetic environment failure');
    });
    const fixture = await createStartingFixture();
    const failure = await captureFailure(fixture.started);
    expect(failure).toMatchObject({ message: 'DESKTOP_START_FAILED',
      ownership: { processState: 'absent', migrationGateSettled: true } });
    expect(boundary.fork).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('backend parent reservation transfer', () => {
  it('transfers broker ports only after preparation and a fresh synchronous grant check', async () => {
    vi.useFakeTimers();
    const fixture = await createStartingFixture({}, { deferSpawn: true });
    const prepared = createGate();
    const authorized = createGate();
    fixture.transfer.prepare.mockImplementationOnce(() => prepared.promise);
    fixture.transfer.assertGrant.mockImplementationOnce(() => authorized.promise);
    fixture.process.emit('spawn');
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.postMessage).not.toHaveBeenCalled();
    prepared.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.postMessage.mock.calls).toEqual([[{
      type: 'prepare', reservation: fixture.transfer.descriptor,
    }]]);
    expect(fixture.transfer.assertCurrent).not.toHaveBeenCalled();
    authorized.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.transfer.assertCurrent).toHaveBeenCalledTimes(1);
    expect(fixture.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'start', generationId: operationId }), [{}, {}, {}],
    );
    fixture.process.emit('message', readyMessage);
    const backend = await fixture.started;
    const stopped = backend.stop();
    expect(fixture.transfer.reclaimAfterExit).not.toHaveBeenCalled();
    fixture.process.emit('exit', 0);
    await expect(stopped).resolves.toBe('exited');
    expect(fixture.transfer.reclaimAfterExit).toHaveBeenCalledTimes(1);
    expect(fixture.transfer.invalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['generationId', 'identity', 'userDataRoot', 'extra'] as const)(
    'rejects a changed reservationReady %s before sending a grant', async (field) => {
      vi.useFakeTimers();
      const fixture = await createStartingFixture({}, { deferSpawn: true });
      const result = captureFailure(fixture.started);
      fixture.postMessage.mockImplementation(() => {});
      fixture.kill.mockImplementation(() => { fixture.process.emit('exit', 1); return true; });
      fixture.process.emit('spawn');
      await vi.advanceTimersByTimeAsync(0);
      const changed = {
        ...fixture.transfer.descriptor,
        [field]: field === 'generationId' ? '22222222-2222-4222-8222-222222222222'
          : field === 'identity' ? 'b'.repeat(64)
          : field === 'userDataRoot' ? resolve('other-synthetic-root') : true,
      };
      fixture.process.emit('message', { type: 'reservationReady', reservation: changed });
      expect(await result).toMatchObject({ message: 'BACKEND_PROCESS_RESERVATION_FAILED',
        ownership: { processState: 'absent', reservationReclaimed: false } });
      expect(fixture.transfer.assertGrant).not.toHaveBeenCalled();
      expect(fixture.postMessage.mock.calls.some(([message]) => message.type === 'start')).toBe(false);
      expect(fixture.transfer.invalidate).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('rejects ready before granting any work', async () => {
    vi.useFakeTimers();
    const fixture = await createStartingFixture({}, { deferSpawn: true });
    const result = captureFailure(fixture.started);
    fixture.kill.mockImplementation(() => { fixture.process.emit('exit', 1); return true; });
    fixture.process.emit('message', readyMessage);
    expect(await result).toMatchObject({ message: 'BACKEND_PROCESS_RESERVATION_FAILED',
      ownership: { processState: 'absent', reservationReclaimed: false } });
    expect(fixture.transfer.prepare).not.toHaveBeenCalled();
  });

  it('rechecks captured operation authority after the asynchronous grant check', async () => {
    vi.useFakeTimers();
    const fixture = await createStartingFixture({}, { deferSpawn: true });
    const result = captureFailure(fixture.started);
    fixture.transfer.assertCurrent.mockImplementationOnce(() => { throw new Error('synthetic expired owner'); });
    fixture.kill.mockImplementation(() => { fixture.process.emit('exit', 1); return true; });
    fixture.process.emit('spawn');
    expect(await result).toMatchObject({ message: 'BACKEND_PROCESS_RESERVATION_FAILED',
      ownership: { reservationReclaimed: false } });
    expect(fixture.transfer.assertGrant).toHaveBeenCalledTimes(1);
    expect(fixture.postMessage.mock.calls.some(([message]) => message.type === 'start')).toBe(false);
    expect(JSON.stringify(fixture.write.mock.calls)).not.toContain('synthetic expired');
  });

  it.each(['prepare', 'assertGrant'] as const)(
    'keeps a pending %s from outliving failed-start recovery admission', async (callback) => {
      vi.useFakeTimers();
      const fixture = await createStartingFixture({}, { deferSpawn: true });
      const pending = createGate();
      fixture.transfer[callback].mockImplementationOnce(() => pending.promise);
      const result = captureFailure(fixture.started);
      fixture.process.emit('spawn');
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.transfer[callback]).toHaveBeenCalledTimes(1);
      fixture.process.emit('exit', 1);
      await vi.advanceTimersByTimeAsync(3_000);
      const failure = await result;
      expect(failure).toMatchObject({ message: 'BACKEND_EXITED_BEFORE_READY',
        ownership: { processState: 'absent', migrationGateSettled: true, reservationReclaimed: false } });
      expect(fixture.transfer.reclaimAfterExit).not.toHaveBeenCalled();
      pending.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.transfer[callback].mock.calls[0]![0].aborted).toBe(true);
      expect(fixture.postMessage.mock.calls.some(([message]) => message.type === 'start')).toBe(false);
      expect(fixture.transfer.invalidate).toHaveBeenCalledTimes(1);
      expect(failure.ownership.reservationReclaimed).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('uses the original startup deadline while a grant is pending', async () => {
    vi.useFakeTimers();
    const fixture = await createStartingFixture({}, { deferSpawn: true });
    const grant = createGate();
    fixture.transfer.assertGrant.mockImplementationOnce(() => grant.promise);
    fixture.kill.mockImplementation(() => { fixture.process.emit('exit', 1); return true; });
    const result = captureFailure(fixture.started);
    await vi.advanceTimersByTimeAsync(29_000);
    fixture.process.emit('spawn');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.kill).toHaveBeenCalledTimes(1);
    grant.resolve();
    expect(await result).toMatchObject({ message: 'BACKEND_READINESS_TIMEOUT',
      ownership: { reservationReclaimed: true } });
    expect(fixture.postMessage.mock.calls.some(([message]) => message.type === 'start')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the original failure separately from a timed-out reservation reclaim', async () => {
    vi.useFakeTimers();
    const fixture = await createStartingFixture();
    const reclaimed = createGate();
    fixture.transfer.reclaimAfterExit.mockImplementationOnce(() => reclaimed.promise);
    fixture.kill.mockImplementation(() => { fixture.process.emit('exit', 1); return true; });
    const result = captureFailure(fixture.started);
    fixture.process.emit('message', { type: 'failed', code: 'BACKEND_MODULE_IMPORT_FAILED' });
    await vi.advanceTimersByTimeAsync(3_000);
    const failure = await result;
    expect(failure).toMatchObject({ message: 'BACKEND_MODULE_IMPORT_FAILED',
      ownership: { processState: 'absent', reservationReclaimed: false } });
    expect(fixture.transfer.reclaimAfterExit.mock.calls[0]![0].aborted).toBe(true);
    reclaimed.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(failure.ownership.reservationReclaimed).toBe(false);
    expect(fixture.transfer.invalidate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not acknowledge graceful stop until ownership is actually reclaimed', async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    const reclaimed = createGate();
    fixture.transfer.reclaimAfterExit.mockImplementationOnce(() => reclaimed.promise);
    const stopped = fixture.backend.stop();
    let completed = false;
    void stopped.then(() => { completed = true; });
    fixture.process.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(completed).toBe(false);
    reclaimed.resolve();
    await expect(stopped).resolves.toBe('exited');
    expect(fixture.transfer.invalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not add a new stop budget for a stuck reclaim after a delayed zero exit', async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    const reclaimed = createGate();
    fixture.transfer.reclaimAfterExit.mockImplementationOnce(() => reclaimed.promise);
    const rejected = expect(fixture.backend.stopForUpdate(operationId))
      .rejects.toThrow('BACKEND_PROCESS_RESERVATION_FAILED');
    await vi.advanceTimersByTimeAsync(2_999);
    fixture.process.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(fixture.transfer.invalidate).toHaveBeenCalledTimes(1);
    expect(fixture.transfer.reclaimAfterExit.mock.calls[0]![0].aborted).toBe(true);
    reclaimed.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('backend shutdown event ordering', () => {
  it.each([
    ['stop', 0], ['stop', 1], ['stopForUpdate', 0], ['stopForUpdate', 1],
  ] as const)('does not let %s claim an unsolicited exit %s as graceful', async (method, exitCode) => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    const unexpectedExit = vi.fn();
    fixture.backend.onUnexpectedExit(unexpectedExit);
    fixture.process.emit('exit', exitCode);
    await expect((method === 'stop' ? fixture.backend.stop() : fixture.backend.stopForUpdate(operationId))).rejects.toThrow('The backend exited unsuccessfully during shutdown.');
    expect(unexpectedExit).toHaveBeenCalledOnce();
    expect(fixture.postMessage).not.toHaveBeenCalledWith({ type: 'shutdown' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['stop', 'stopForUpdate'] as const)(
    'rejects %s when the request emits zero exit and then throws', async (method) => {
      vi.useFakeTimers();
      const fixture = await createFixture();
      fixture.postMessage.mockImplementation(() => {
        fixture.process.emit('exit', 0);
        throw new Error('synthetic private request failure');
      });
      await expect((method === 'stop' ? fixture.backend.stop() : fixture.backend.stopForUpdate(operationId))).rejects.toThrow('BACKEND_STOP_FAILED');
      expect(fixture.kill).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['stop', 'stopForUpdate'] as const)('observes synchronous exit from %s', async (method) => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    fixture.postMessage.mockImplementation(() => { fixture.process.emit('exit', 0); });
    await expect((method === 'stop' ? fixture.backend.stop() : fixture.backend.stopForUpdate(operationId))).resolves.toBe(method === 'stop' ? 'exited' : undefined);
    expect(fixture.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['stop', 'stopForUpdate'] as const)('keeps a throwing %s request bounded and unclean', async (method) => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    fixture.postMessage.mockImplementation(() => { throw new Error('synthetic private post failure'); });
    fixture.kill.mockImplementation(() => { fixture.process.emit('exit', 0); return true; });
    const rejection = expect((method === 'stop' ? fixture.backend.stop() : fixture.backend.stopForUpdate(operationId))).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3_000);
    await rejection;
    expect(fixture.kill).toHaveBeenCalledTimes(method === 'stop' ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

const operationId = '11111111-1111-4111-8111-111111111111';

const readyMessage = { type: 'ready', port: 12345, smokePdfCreated: false, smokeSecretBrokerVerified: false };
const migrationGateMessage = { type: 'migrationGateReady', inspection: {
  appliedMigrationCount: 38, migrationChainIdentity: 'b'.repeat(64), pendingMigrationCount: 1, profileState: 'existing',
} };

function captureFailure(started: ReturnType<typeof startDesktopBackend>): Promise<DesktopBackendStartupError> {
  return started.then(() => { throw new Error('Expected startup failure.'); }, (error: unknown) => {
    expect(error).toBeInstanceOf(DesktopBackendStartupError);
    return error as DesktopBackendStartupError;
  });
}

function createGate() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

async function createFixture() {
  const fixture = await createStartingFixture();
  fixture.process.emit('message', {
    type: 'ready', port: 12345, smokePdfCreated: false, smokeSecretBrokerVerified: false,
  });
  return { ...fixture, backend: await fixture.started };
}

async function createStartingFixture(options: Partial<Pick<StartDesktopBackendOptions,
  'beforeMigrations' | 'observeStartupException'>> = {}, behavior: {
    deferSpawn?: boolean; forkThrows?: boolean; deferHandoff?: boolean;
  } = {}) {
  const process = new EventEmitter();
  const granted = createGate();
  const postMessage = vi.fn((message: { type: string; reservation?: unknown }) => {
    if (message.type === 'prepare') process.emit('message', { type: 'reservationReady', reservation: message.reservation });
    if (message.type === 'start') granted.resolve();
  });
  const kill = vi.fn(() => true);
  boundary.fork.mockReturnValue(Object.assign(process, { kill, postMessage }));
  if (behavior.forkThrows) boundary.fork.mockImplementationOnce(() => { throw new Error('synthetic fork failure'); });
  const write = vi.fn();
  const root = resolve('synthetic-backend-process-test');
  const transfer = {
    descriptor: { generationId: operationId, identity: 'a'.repeat(64), userDataRoot: root },
    prepare: vi.fn(async (_signal: AbortSignal) => {}),
    assertGrant: vi.fn(async (_signal: AbortSignal) => {}),
    assertCurrent: vi.fn(),
    reclaimAfterExit: vi.fn(async (_signal: AbortSignal) => {}),
    invalidate: vi.fn(),
  };
  const started = startDesktopBackend({
    beforeMigrations: async () => undefined,
    ...options,
    config: {
      appVersion: '0.2.81', architecture: 'x64', backendRoot: root,
      buildCreatedAt: '2026-10-04T10:00:00.000Z', buildDirty: false,
      buildRevision: 'a'.repeat(40), createSmokePdf: false,
      databaseFilePath: resolve(root, 'test.sqlite'), electronVersion: '43.7.6',
      invoiceDocumentStorageRoot: resolve(root, 'invoices'),
      migrationsDirectory: resolve(root, 'migrations'),
      migrationStartupPolicy: 'exactCurrentManifest',
      operationalLogsRoot: resolve(root, 'logs'), platform: 'win32',
      profileSnapshotStagingRoot: resolve(root, 'staging'),
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      runtimeSessionSecret: 'a'.repeat(64),
      smokePdfPath: resolve(root, 'smoke.pdf'), verifySmokeSecretBroker: false,
    },
    invoicePdfArchiveBrokerPort: {} as MessagePortMain,
    operationalIdentity: {
      appVersion: '0.2.81', buildRevision: 'a'.repeat(40),
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    },
    operationalLogger: { write },
    profileSnapshotBrokerPort: {} as MessagePortMain,
    reservationTransfer: transfer,
    runnerPath: resolve(root, 'runner.js'),
    secretBrokerPort: {} as MessagePortMain,
  });
  if (!behavior.deferSpawn) process.emit('spawn');
  if (!behavior.deferSpawn && !behavior.deferHandoff &&
      boundary.fork.mock.results.at(-1)?.type === 'return') await granted.promise;
  return { started, process, kill, postMessage, write, transfer };
}

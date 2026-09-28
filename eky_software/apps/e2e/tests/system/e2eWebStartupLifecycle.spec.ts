import { expect, test } from '@playwright/test';

import type { E2eProcessStartupState } from '../../src/environment/e2eProcessStartupObservation.js';
import { E2eWebStartupFailure, waitForE2eWebStartup } from '../../src/environment/e2eWebStartupLifecycle.js';
import { OwnedWindowsViteStartupFailure } from '../../src/environment/startOwnedWindowsVite.js';

test.describe('WEB-STARTUP-LIFECYCLE-001 @critical @security', () => {
  test('successful health requires observed spawn and does not perform cleanup', async () => {
    const f = fixture();
    await expect(waitForE2eWebStartup(f.input)).resolves.toBeUndefined();
    expect(f.calls).toEqual(['health', 'unsubscribe']);
  });

  for (const [terminal, errorCode] of [
    ['exited', 'E2E_WEB_CHILD_EXITED_BEFORE_HEALTH'],
    ['spawnFailed', 'E2E_WEB_PROCESS_SPAWN_FAILED'],
    ['observationLost', 'E2E_WEB_WORKLOAD_OBSERVATION_LOST'],
  ] as const) {
    test(`${terminal} before subscription cannot be overruled by healthy HTTP`, async () => {
      const f = fixture();
      f.set({ spawnObserved: terminal !== 'spawnFailed', terminal });
      const error = await failure(waitForE2eWebStartup(f.input));
      expect(error.evidence).toEqual({ errorCode, spawnObserved: terminal !== 'spawnFailed',
        exitedBeforeCleanup: terminal === 'exited', cleanup: { processTree: 'stopped', port: 'released' } });
      expect(f.calls.slice(-2)).toEqual(['stop', 'port']);
    });
  }

  test('HTTP without observed spawn remains an observation failure', async () => {
    const f = fixture();
    f.set({ spawnObserved: false, terminal: undefined });
    expect((await failure(waitForE2eWebStartup(f.input))).evidence.errorCode)
      .toBe('E2E_WEB_WORKLOAD_OBSERVATION_LOST');
  });

  test('a terminal observation cancels a pending health request', async () => {
    const f = fixture();
    let aborted = false;
    f.input.waitForHealth = async signal => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('PRIVATE_ABORT')); }, { once: true });
      f.set({ spawnObserved: true, terminal: 'exited' });
    });
    const error = await failure(waitForE2eWebStartup(f.input));
    expect(error.evidence.errorCode).toBe('E2E_WEB_CHILD_EXITED_BEFORE_HEALTH');
    expect(aborted).toBe(true);
  });

  test('a terminal arriving during unsubscribe defeats successful health', async () => {
    const f = fixture();
    f.input.startup.subscribe = () => () => f.set({ spawnObserved: true, terminal: 'exited' });
    expect((await failure(waitForE2eWebStartup(f.input))).evidence.errorCode)
      .toBe('E2E_WEB_CHILD_EXITED_BEFORE_HEALTH');
  });

  for (const cleanupFailure of ['tree', 'port', 'both'] as const) {
    test(`health timeout stays first when ${cleanupFailure} cleanup fails`, async () => {
      const f = fixture();
      f.input.waitForHealth = async () => { throw new Error('PRIVATE_HEALTH_FAILURE'); };
      f.input.stopProcessTree = async () => {
        f.calls.push('stop');
        f.set({ spawnObserved: true, terminal: 'exited' });
        if (cleanupFailure !== 'port') throw new Error('PRIVATE_TREE_FAILURE');
      };
      f.input.releasePort = async () => {
        f.calls.push('port');
        if (cleanupFailure !== 'tree') throw new Error('PRIVATE_PORT_FAILURE');
      };
      const error = await failure(waitForE2eWebStartup(f.input));
      expect(error.evidence).toEqual({ errorCode: 'E2E_WEB_HEALTH_TIMEOUT', spawnObserved: true,
        exitedBeforeCleanup: false, cleanup: {
          processTree: cleanupFailure === 'port' ? 'stopped' : 'unverified',
          port: cleanupFailure === 'tree' ? 'released' : 'unverified',
        } });
      expect(f.calls.slice(-2)).toEqual(['stop', 'port']);
      expect(JSON.stringify(error.evidence)).not.toContain('PRIVATE');
      expect(Object.isFrozen(error.evidence.cleanup)).toBe(true);
    });
  }

  test('a retained owned stop receipt is not discarded because of an earlier operational failure', async () => {
    const f = fixture();
    f.input.waitForHealth = async () => { throw new Error('E2E_WEB_WORKLOAD_OBSERVATION_LOST'); };
    f.input.stopProcessTree = async () => {
      f.calls.push('stop');
      throw new OwnedWindowsViteStartupFailure({ startupFailure: 'observationLost',
        spawnObserved: true, exitedBeforeCleanup: false, processTree: 'stopped' },
      { readStdout: () => '', readStderr: () => '' });
    };
    expect((await failure(waitForE2eWebStartup(f.input))).evidence).toMatchObject({
      errorCode: 'E2E_WEB_WORKLOAD_OBSERVATION_LOST', cleanup: { processTree: 'stopped', port: 'released' },
    });
    expect(f.calls.filter(call => call === 'stop')).toHaveLength(1);
  });
});

async function failure(operation: Promise<void>): Promise<E2eWebStartupFailure> {
  try { await operation; }
  catch (error) {
    expect(error).toBeInstanceOf(E2eWebStartupFailure);
    if (error instanceof E2eWebStartupFailure) return error;
    throw error;
  }
  throw new Error('EXPECTED_WEB_STARTUP_FAILURE');
}

function fixture() {
  let state: E2eProcessStartupState = { spawnObserved: true, terminal: undefined };
  let listener: ((state: E2eProcessStartupState) => void) | undefined;
  const calls: string[] = [];
  return { calls, set(next: E2eProcessStartupState) { state = next; listener?.(next); },
    input: {
      startup: {
        readState: () => state,
        subscribe(next: (state: E2eProcessStartupState) => void) {
          listener = next;
          return () => { calls.push('unsubscribe'); listener = undefined; };
        },
      },
      waitForHealth: async (_signal: AbortSignal) => { calls.push('health'); },
      stopProcessTree: async () => { calls.push('stop'); },
      releasePort: async () => { calls.push('port'); },
    },
  };
}

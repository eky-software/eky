import { expect, test } from '@playwright/test';

import {
  readHttpHealthProbeOutcome,
  waitForHttpHealth,
  type HttpHealthProbeOutcome,
} from '../../src/environment/waitForHttpHealth.js';

const healthUrl = 'http://127.0.0.1:32001/health';

test.describe('HTTP health probe evidence', () => {
  test.describe.configure({ mode: 'default', timeout: 5_000 });

  test('normalizes only the closed classes without inspecting unknown values', () => {
    const outcomes: HttpHealthProbeOutcome[] = [
      'healthy', 'connectionRefused', 'requestTimedOut', 'responseNotOk', 'transportFailed',
    ];
    for (const outcome of outcomes) expect(readHttpHealthProbeOutcome(outcome)).toBe(outcome);

    let inspected = 0;
    const unknown = Object.defineProperties({}, {
      outcome: { get() { inspected++; throw new Error('unexpected property read'); } },
      toString: { get() { inspected++; throw new Error('unexpected coercion'); } },
      [Symbol.toPrimitive]: { get() { inspected++; throw new Error('unexpected coercion'); } },
    });
    for (const value of [undefined, null, false, 0, '', 'notObserved', 'ECONNREFUSED', unknown]) {
      expect(readHttpHealthProbeOutcome(value)).toBe('notObserved');
    }
    expect(inspected).toBe(0);
  });

  for (const { name, error, outcome } of [
    { name: 'direct refusal', error: { code: 'ECONNREFUSED' }, outcome: 'connectionRefused' },
    {
      name: 'fetch cause refusal',
      error: new TypeError('synthetic transport failure', { cause: { code: 'ECONNREFUSED' } }),
      outcome: 'connectionRefused',
    },
    { name: 'unknown value', error: null, outcome: 'transportFailed' },
    { name: 'message-only refusal', error: new Error('ECONNREFUSED'), outcome: 'transportFailed' },
    {
      name: 'untrusted timeout name',
      error: new DOMException('synthetic timeout', 'TimeoutError'),
      outcome: 'transportFailed',
    },
    {
      name: 'nested cause beyond the fetch wrapper',
      error: { cause: { cause: { code: 'ECONNREFUSED' } } },
      outcome: 'transportFailed',
    },
  ] as const) {
    test(`reports a closed failure class for ${name}`, async () => {
      let now = 0;
      const observed: HttpHealthProbeOutcome[] = [];
      const budgets: number[] = [];
      const retries: number[] = [];
      await expect(waitForHttpHealth(healthUrl, {
        now: () => now,
        timeoutMilliseconds: 25,
        probe: async (_url, budget) => {
          budgets.push(budget);
          now = 25;
          throw error;
        },
        onProbeCompleted: (value) => observed.push(value),
        waitForRetry: async (milliseconds) => { retries.push(milliseconds); now += milliseconds; },
      })).rejects.toThrow('E2E_BACKEND_HEALTH_TIMEOUT');
      expect(observed).toEqual([outcome]);
      expect(budgets).toEqual([25]);
      expect(retries).toEqual([]);
    });
  }

  for (const location of ['error', 'cause'] as const) {
    test(`does not invoke getters on the ${location}`, async () => {
      let getterReads = 0;
      let now = 0;
      const observed: HttpHealthProbeOutcome[] = [];
      const unreadable = Object.defineProperties({}, Object.fromEntries(
        ['code', 'cause', 'message', 'name', 'stack'].map((key) => [key, {
          get() { getterReads++; throw new Error('synthetic private error'); },
        }]),
      ));
      await expect(waitForHttpHealth(healthUrl, {
        now: () => now,
        timeoutMilliseconds: 1,
        probe: async () => {
          now = 1;
          throw location === 'error' ? unreadable : { cause: unreadable };
        },
        onProbeCompleted: (outcome) => observed.push(outcome),
      })).rejects.toThrow('E2E_BACKEND_HEALTH_TIMEOUT');
      expect(observed).toEqual(['transportFailed']);
      expect(getterReads).toBe(0);
    });
  }

  for (const terminal of ['ready', 'timeout'] as const) {
    for (const observerThrows of [false, true]) {
      test(`preserves budgets and retries through ${terminal}, observer throws: ${observerThrows}`, async () => {
        let now = 0;
        const controller = new AbortController();
        const budgets: number[] = [];
        const retries: number[] = [];
        const observed: HttpHealthProbeOutcome[] = [];
        const waiting = waitForHttpHealth(healthUrl, {
          now: () => now,
          signal: controller.signal,
          timeoutMilliseconds: 1_250,
          probe: async (_url, budget) => {
            budgets.push(budget);
            if (budgets.length > 4) controller.abort();
            now += Math.min(250, budget);
            return terminal === 'ready' && budgets.length === 3;
          },
          onProbeCompleted: (outcome) => {
            observed.push(outcome);
            if (observerThrows) throw new Error('synthetic observation failure');
          },
          waitForRetry: async (milliseconds) => { retries.push(milliseconds); now += milliseconds; },
        });
        if (terminal === 'ready') {
          await expect(waiting).resolves.toBeUndefined();
          expect(budgets).toEqual([1_000, 900, 550]);
          expect(retries).toEqual([100, 100]);
          expect(observed).toEqual(['responseNotOk', 'responseNotOk', 'healthy']);
          expect(now).toBe(950);
        } else {
          await expect(waiting).rejects.toThrow('E2E_BACKEND_HEALTH_TIMEOUT');
          expect(budgets).toEqual([1_000, 900, 550, 200]);
          expect(retries).toEqual([100, 100, 100]);
          expect(observed).toEqual(Array(4).fill('responseNotOk'));
          expect(now).toBe(1_250);
        }
      });
    }
  }

  test('does not await or assimilate an observer return value', async () => {
    let thenReads = 0;
    let observations = 0;
    await expect(waitForHttpHealth(healthUrl, {
      now: () => 0,
      timeoutMilliseconds: 1,
      probe: async () => true,
      onProbeCompleted: () => {
        observations++;
        return Object.defineProperty({}, 'then', {
          get() { thenReads++; throw new Error('must not await evidence'); },
        });
      },
    })).resolves.toBeUndefined();
    expect(observations).toBe(1);
    expect(thenReads).toBe(0);
  });

  test('does not probe or report when the caller already canceled', async () => {
    const controller = new AbortController();
    controller.abort();
    let probes = 0;
    let retries = 0;
    const observed: HttpHealthProbeOutcome[] = [];
    await expect(waitForHttpHealth(healthUrl, {
      now: () => 0,
      signal: controller.signal,
      timeoutMilliseconds: 10,
      probe: async () => { probes++; return true; },
      onProbeCompleted: (outcome) => observed.push(outcome),
      waitForRetry: async () => { retries++; },
    })).rejects.toThrow('E2E_BACKEND_HEALTH_WAIT_ABORTED');
    expect(probes).toBe(0);
    expect(retries).toBe(0);
    expect(observed).toEqual([]);
  });

  for (const completion of ['healthy', 'responseNotOk', 'rejected'] as const) {
    test(`does not report a ${completion} probe completed after caller cancellation`, async () => {
      const controller = new AbortController();
      const observed: HttpHealthProbeOutcome[] = [];
      let finish!: () => void;
      const waiting = waitForHttpHealth(healthUrl, {
        now: () => 0,
        signal: controller.signal,
        timeoutMilliseconds: 10,
        probe: () => new Promise<boolean>((resolve, reject) => {
          finish = () => completion === 'rejected'
            ? reject({ code: 'ECONNREFUSED' }) : resolve(completion === 'healthy');
        }),
        onProbeCompleted: (outcome) => observed.push(outcome),
      });
      controller.abort();
      finish();
      // Evidence must not change the existing late-success return behavior.
      if (completion === 'healthy') await expect(waiting).resolves.toBeUndefined();
      else await expect(waiting).rejects.toThrow('E2E_BACKEND_HEALTH_WAIT_ABORTED');
      expect(observed).toEqual([]);
    });
  }

  for (const status of [200, 503]) {
    test(`classifies the default fetch response with HTTP ${status}`, async () => {
      const originalFetch = globalThis.fetch;
      const controller = new AbortController();
      const observed: HttpHealthProbeOutcome[] = [];
      let now = 0;
      let calls = 0;
      globalThis.fetch = async () => { calls++; now = 1; return new Response(null, { status }); };
      try {
        const waiting = waitForHttpHealth(healthUrl, {
          now: () => now,
          signal: controller.signal,
          timeoutMilliseconds: 1,
          onProbeCompleted: (outcome) => observed.push(outcome),
        });
        if (status === 200) await expect(waiting).resolves.toBeUndefined();
        else await expect(waiting).rejects.toThrow('E2E_BACKEND_HEALTH_TIMEOUT');
        expect(calls).toBe(1);
        expect(observed).toEqual([status === 200 ? 'healthy' : 'responseNotOk']);
      } finally {
        controller.abort();
        globalThis.fetch = originalFetch;
      }
    });
  }

  for (const cancellation of ['requestTimeout', 'callerAbort'] as const) {
    test(`distinguishes default fetch ${cancellation} without new retry waits`, async () => {
      const originalFetch = globalThis.fetch;
      const controller = new AbortController();
      const observed: HttpHealthProbeOutcome[] = [];
      const retries: number[] = [];
      const requestSignals: AbortSignal[] = [];
      let now = 0;
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        const signal = init?.signal;
        if (!signal) throw new Error('missing request abort signal');
        requestSignals.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          const onAbort = () => { now = 25; reject(signal.reason); };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
          if (cancellation === 'callerAbort') {
            controller.abort(new DOMException('synthetic caller timeout', 'TimeoutError'));
          }
        });
      };
      try {
        await expect(waitForHttpHealth(healthUrl, {
          now: () => now,
          signal: controller.signal,
          timeoutMilliseconds: 25,
          onProbeCompleted: (outcome) => observed.push(outcome),
          waitForRetry: async (milliseconds) => { retries.push(milliseconds); now += milliseconds; },
        })).rejects.toThrow(cancellation === 'requestTimeout'
          ? 'E2E_BACKEND_HEALTH_TIMEOUT' : 'E2E_BACKEND_HEALTH_WAIT_ABORTED');
        expect(calls).toBe(1);
        expect(requestSignals).toHaveLength(1);
        expect(requestSignals[0]?.aborted).toBe(true);
        expect(controller.signal.aborted).toBe(cancellation === 'callerAbort');
        expect(observed).toEqual(cancellation === 'requestTimeout' ? ['requestTimedOut'] : []);
        expect(retries).toEqual([]);
      } finally {
        controller.abort();
        globalThis.fetch = originalFetch;
      }
    });
  }
});

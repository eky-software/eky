const loopbackHost = '127.0.0.1';

export type HttpHealthProbeOutcome =
  | 'healthy'
  | 'connectionRefused'
  | 'requestTimedOut'
  | 'responseNotOk'
  | 'transportFailed';

export function readHttpHealthProbeOutcome(value: unknown): HttpHealthProbeOutcome | 'notObserved' {
  switch (value) {
    case 'healthy':
    case 'connectionRefused':
    case 'requestTimedOut':
    case 'responseNotOk':
    case 'transportFailed':
      return value;
    default:
      return 'notObserved';
  }
}

class HttpHealthRequestTimeout extends Error {}

type HttpHealthProbe = (
  healthUrl: URL,
  requestTimeoutMilliseconds: number,
  signal: AbortSignal,
) => Promise<boolean>;

interface WaitForHttpHealthOptions {
  readonly intervalMilliseconds?: number;
  readonly now?: () => number;
  readonly onProbeCompleted?: (outcome: HttpHealthProbeOutcome) => void;
  readonly probe?: HttpHealthProbe;
  readonly signal?: AbortSignal;
  readonly timeoutMilliseconds: number;
  readonly waitForRetry?: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;
}

export async function waitForHttpHealth(
  url: string,
  options: WaitForHttpHealthOptions,
): Promise<void> {
  const healthUrl = new URL(url);
  if (
    healthUrl.protocol !== 'http:' ||
    healthUrl.hostname !== loopbackHost
  ) {
    throw new Error('Health URL must use loopback HTTP.');
  }

  const timeoutMilliseconds = options.timeoutMilliseconds;
  const intervalMilliseconds = options.intervalMilliseconds ?? 100;
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    !Number.isSafeInteger(intervalMilliseconds) ||
    intervalMilliseconds < 1
  ) {
    throw new Error('E2E_BACKEND_HEALTH_WAIT_CONFIGURATION_INVALID');
  }

  const now = options.now ?? Date.now;
  const probe = options.probe ?? probeHttpHealth;
  const signal = options.signal ?? new AbortController().signal;
  const waitForRetry = options.waitForRetry ?? waitWithAbort;
  const deadline = now() + timeoutMilliseconds;

  while (!signal.aborted) {
    const requestBudget = deadline - now();
    if (requestBudget <= 0) {
      break;
    }
    try {
      const healthy = await probe(
        healthUrl,
        Math.min(1_000, requestBudget),
        signal,
      );
      reportProbe(healthy ? 'healthy' : 'responseNotOk');
      if (healthy) {
        return;
      }
    } catch (error) {
      if (signal.aborted) {
        throw new Error('E2E_BACKEND_HEALTH_WAIT_ABORTED');
      }
      reportProbe(classifyProbeFailure(error));
      // The managed process may still be starting.
    }

    const retryBudget = deadline - now();
    if (retryBudget <= 0) {
      break;
    }
    await waitForRetry(
      Math.min(intervalMilliseconds, retryBudget),
      signal,
    );
  }

  if (signal.aborted) {
    throw new Error('E2E_BACKEND_HEALTH_WAIT_ABORTED');
  }
  throw new Error('E2E_BACKEND_HEALTH_TIMEOUT');

  function reportProbe(outcome: HttpHealthProbeOutcome): void {
    if (signal.aborted) return;
    // The owner only stores this closed value in memory; never await reporting.
    try { options.onProbeCompleted?.(outcome); } catch { /* Optional observation. */ }
  }
}

async function probeHttpHealth(
  healthUrl: URL,
  requestTimeoutMilliseconds: number,
  signal: AbortSignal,
): Promise<boolean> {
  const requestTimeout = AbortSignal.timeout(requestTimeoutMilliseconds);
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.any([signal, requestTimeout]),
    });
    return response.ok;
  } catch (error) {
    if (!signal.aborted && requestTimeout.aborted) throw new HttpHealthRequestTimeout();
    throw error;
  }
}

function classifyProbeFailure(error: unknown): HttpHealthProbeOutcome {
  // Node fetch wraps the socket error once. Do not read messages or invoke getters.
  try {
    if (error instanceof HttpHealthRequestTimeout) return 'requestTimedOut';
    const readOwnValue = (value: unknown, key: string): unknown =>
      typeof value === 'object' && value !== null
        ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
    if (readOwnValue(error, 'code') === 'ECONNREFUSED' ||
        readOwnValue(readOwnValue(error, 'cause'), 'code') === 'ECONNREFUSED') {
      return 'connectionRefused';
    }
  } catch { /* Unreadable transport failures stay unclassified. */ }
  return 'transportFailed';
}

function waitWithAbort(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new Error('E2E_BACKEND_HEALTH_WAIT_ABORTED'));
  }

  return new Promise((resolveDelay, rejectDelay) => {
    const onAbort = () => {
      clearTimeout(timer);
      rejectDelay(new Error('E2E_BACKEND_HEALTH_WAIT_ABORTED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolveDelay();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

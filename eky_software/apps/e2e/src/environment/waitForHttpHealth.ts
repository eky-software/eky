const loopbackHost = '127.0.0.1';

type HttpHealthProbe = (
  healthUrl: URL,
  requestTimeoutMilliseconds: number,
  signal: AbortSignal,
) => Promise<boolean>;

interface WaitForHttpHealthOptions {
  readonly intervalMilliseconds?: number;
  readonly now?: () => number;
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
      if (
        await probe(
          healthUrl,
          Math.min(1_000, requestBudget),
          signal,
        )
      ) {
        return;
      }
    } catch {
      if (signal.aborted) {
        throw new Error('E2E_BACKEND_HEALTH_WAIT_ABORTED');
      }
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
}

async function probeHttpHealth(
  healthUrl: URL,
  requestTimeoutMilliseconds: number,
  signal: AbortSignal,
): Promise<boolean> {
  const response = await fetch(healthUrl, {
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(requestTimeoutMilliseconds),
    ]),
  });
  return response.ok;
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

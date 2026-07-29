const loopbackHost = '127.0.0.1';

export async function waitForHttpHealth(
  url: string,
  options: {
    intervalMilliseconds?: number;
    timeoutMilliseconds?: number;
  } = {},
): Promise<void> {
  const healthUrl = new URL(url);
  if (
    healthUrl.protocol !== 'http:' ||
    healthUrl.hostname !== loopbackHost
  ) {
    throw new Error('Health URL must use loopback HTTP.');
  }

  const timeoutMilliseconds = options.timeoutMilliseconds ?? 15_000;
  const intervalMilliseconds = options.intervalMilliseconds ?? 100;
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(
          Math.min(1_000, Math.max(1, deadline - Date.now())),
        ),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The managed process may still be starting.
    }
    await delay(intervalMilliseconds);
  }

  throw new Error('Managed HTTP service did not become healthy.');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

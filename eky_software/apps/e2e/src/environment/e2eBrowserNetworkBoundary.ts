import type { BrowserContext } from '@playwright/test';

export interface E2eBrowserNetworkBoundary {
  assertNoBlockedRequests(): void;
}

export async function installE2eBrowserNetworkBoundary(
  context: BrowserContext,
  input: {
    backendOrigin: string;
    webOrigin: string;
  },
): Promise<E2eBrowserNetworkBoundary> {
  const allowedOrigins = new Set([
    requireLoopbackHttpOrigin(input.backendOrigin),
    requireLoopbackHttpOrigin(input.webOrigin),
  ]);
  const blockedDestinations: string[] = [];

  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (isAllowedE2eBrowserUrl(requestUrl, allowedOrigins)) {
      await route.continue();
      return;
    }

    blockedDestinations.push(describeDestination(requestUrl));
    await route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/, async (webSocketRoute) => {
    const requestUrl = webSocketRoute.url();
    if (isAllowedE2eBrowserUrl(requestUrl, allowedOrigins)) {
      webSocketRoute.connectToServer();
      return;
    }

    blockedDestinations.push(describeDestination(requestUrl));
    await webSocketRoute.close({
      code: 1008,
      reason: 'Blocked by E2E network policy.',
    });
  });

  return {
    assertNoBlockedRequests() {
      if (blockedDestinations.length > 0) {
        throw new Error(
          `E2E browser attempted blocked network access: ${[
            ...new Set(blockedDestinations),
          ].join(', ')}`,
        );
      }
    },
  };
}

export function isAllowedE2eBrowserUrl(
  rawUrl: string,
  allowedHttpOrigins: ReadonlySet<string>,
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol === 'about:') {
    return rawUrl === 'about:blank';
  }
  if (url.protocol === 'data:') {
    return true;
  }
  if (url.protocol === 'blob:') {
    return allowedHttpOrigins.has(url.origin);
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return allowedHttpOrigins.has(url.origin);
  }
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    const matchingHttpProtocol = url.protocol === 'ws:' ? 'http:' : 'https:';
    return allowedHttpOrigins.has(
      `${matchingHttpProtocol}//${url.host}`,
    );
  }

  return false;
}

function requireLoopbackHttpOrigin(rawOrigin: string): string {
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new Error('E2E browser origin is invalid.');
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.origin !== rawOrigin
  ) {
    throw new Error('E2E browser origin must use loopback HTTP.');
  }
  return url.origin;
}

function describeDestination(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'about:' || url.protocol === 'data:') {
      return url.protocol;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'invalid-url';
  }
}

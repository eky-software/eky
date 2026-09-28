export const chromiumWorkerProtocol: 'eky.e2e.chromium-service';
export const chromiumReadyName: 'chromium-ready.json';
export const chromiumServerEntrypoint: 'apps/e2e/src/environment/ownedChromiumServer.mjs';
export const chromiumControlMaximumBytes: 8192;
export function requireChromiumEndpoint(value: unknown): string;
export function requireChromiumReady(value: unknown, generation: string): string;

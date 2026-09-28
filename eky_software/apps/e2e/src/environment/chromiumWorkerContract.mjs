export const chromiumWorkerProtocol = 'eky.e2e.chromium-service';
export const chromiumReadyName = 'chromium-ready.json';
export const chromiumServerEntrypoint = 'apps/e2e/src/environment/ownedChromiumServer.mjs';
export const chromiumControlMaximumBytes = 8192;

export function requireChromiumEndpoint(value) {
  if (typeof value !== 'string' || value.length > 256 ||
      !/^ws:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new Error('E2E_CHROMIUM_ENDPOINT_INVALID');
  }
  try {
    const address = new URL(value);
    if (Number(address.port) > 65535) throw new Error('E2E_CHROMIUM_ENDPOINT_INVALID');
  } catch { throw new Error('E2E_CHROMIUM_ENDPOINT_INVALID'); }
  return value;
}

export function requireChromiumReady(value, generation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'endpoint,generation,protocol,schemaVersion' ||
      value.protocol !== chromiumWorkerProtocol || value.schemaVersion !== 1 ||
      !/^[0-9a-f]{64}$/.test(generation) || value.generation !== generation) {
    throw new Error('E2E_CHROMIUM_READY_INVALID');
  }
  return requireChromiumEndpoint(value.endpoint);
}

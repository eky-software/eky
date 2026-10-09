import { createBackendRequestHeaders } from './protocolPolicy.js';

export type PackagedUpdateWriteState = 'writable' | 'blocked';
const maximumResponseBytes = 1_024;
const failure = () => new Error('W6B2_PROOF_PREPARATION_CONCURRENCY_FAILED');

export async function assertW6b2PackagedUpdateWriteState(input: {
  backendPort: number;
  runtimeSessionSecret: string;
  state: PackagedUpdateWriteState;
  fetchImplementation(url: string, init: RequestInit): Promise<Response>;
}): Promise<void> {
  if (!Number.isInteger(input.backendPort) || input.backendPort < 1 || input.backendPort > 65535) {
    throw failure();
  }
  try {
    // Invalid JSON reaches write admission but cannot create a business entity.
    // The existing scenario supervisor owns the deadline for this proof too.
    const response = await input.fetchImplementation(`http://127.0.0.1:${input.backendPort}/customers`, {
      body: '{',
      headers: createBackendRequestHeaders(new Headers({ 'content-type': 'application/json' }), input.runtimeSessionSecret),
      method: 'POST',
      redirect: 'error',
    });
    const expectedStatus = input.state === 'blocked' ? 503 : 400;
    if (response.status !== expectedStatus) {
      await response.body?.cancel();
      throw failure();
    }
    const reader = response.body?.getReader();
    if (reader === undefined) throw failure();
    let completed = false;
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) { completed = true; break; }
        length += part.value.byteLength;
        if (length > maximumResponseBytes) throw failure();
        chunks.push(part.value);
      }
    } finally {
      try {
        if (!completed) await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (input.state === 'blocked' && (
      typeof value !== 'object' || value === null || Array.isArray(value) ||
      !('code' in value) || value.code !== 'PROFILE_MAINTENANCE_ACTIVE'
    )) throw failure();
  } catch {
    throw failure();
  }
}

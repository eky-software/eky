import { createConnection, type Socket } from 'node:net';

import {
  assertW6b2PackagedFaultSessionProbe,
  type W6b2PackagedProofConfiguration,
} from './w6b2PackagedProof.js';
import { createBackendRequestHeaders } from './protocolPolicy.js';

const failure = () => new Error('W6B2_PROOF_SESSION_VALIDATION_FAILED');
const maximumMessageBytes = 1024;
const noncePattern = /^[0-9a-f]{64}$/u;
const sessionPattern = /^[A-Za-z0-9_-]{43}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const packagedSessionProbeHeaders = (session: string) =>
  createBackendRequestHeaders(new Headers(), session);

export function packagedSessionProbePipe(nonce: string): string {
  if (!noncePattern.test(nonce)) throw failure();
  return `\\\\.\\pipe\\eky-v26-session-${nonce}`;
}

// One bounded newline-terminated message, never stdout/stderr or a disk file.
// The existing scenario Job owns the deadline; this channel owns only sockets.
export function readPackagedSessionProbeMessage(socket: Socket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const finish = (value: unknown, failed: boolean) => {
      socket.off('data', data); socket.off('error', closed); socket.off('end', closed); socket.off('close', closed);
      pending.fill(0);
      if (failed) reject(failure()); else resolve(value);
    };
    const closed = () => finish(undefined, true);
    const data = (chunk: Buffer) => {
      if (pending.length + chunk.length > maximumMessageBytes) { closed(); return; }
      const previous = pending;
      pending = Buffer.concat([pending, chunk]); previous.fill(0);
      const end = pending.indexOf(10);
      if (end === -1) return;
      try {
        if (end !== pending.length - 1) throw failure();
        finish(JSON.parse(pending.subarray(0, end).toString('utf8')) as unknown, false);
      } catch { closed(); }
    };
    socket.on('data', data); socket.once('error', closed); socket.once('end', closed); socket.once('close', closed);
  });
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parsePackagedSessionProbeRequest(value: unknown, nonce: string, phase: string) {
  if (!exactKeys(value, ['schemaVersion', 'nonce', 'phase', 'runtimeInstanceId', 'port', 'session']) ||
    value.schemaVersion !== 1 || value.nonce !== nonce || value.phase !== phase ||
    typeof value.runtimeInstanceId !== 'string' || !uuidPattern.test(value.runtimeInstanceId) ||
    typeof value.session !== 'string' || !sessionPattern.test(value.session) ||
    typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw failure();
  }
  return { runtimeInstanceId: value.runtimeInstanceId, port: value.port, session: value.session };
}

export async function runW6b2PackagedSessionProbe(input: {
  configuration: Readonly<W6b2PackagedProofConfiguration>;
  backendPort: number;
  runtimeInstanceId: string;
  runtimeSessionSecret: string;
}): Promise<void> {
  const nonce = input.configuration.sessionProbeNonce;
  if (nonce === undefined) return;
  if (input.configuration.controlFormatVersion === 2) {
    assertW6b2PackagedFaultSessionProbe(input.configuration);
  }
  const request = { schemaVersion: 1, nonce, phase: input.configuration.phase,
    runtimeInstanceId: input.runtimeInstanceId, port: input.backendPort, session: input.runtimeSessionSecret };
  parsePackagedSessionProbeRequest(request, nonce, input.configuration.phase);
  const socket = createConnection({ path: packagedSessionProbePipe(nonce), allowHalfOpen: true });
  try {
    const response = readPackagedSessionProbeMessage(socket);
    socket.write(`${JSON.stringify(request)}\n`);
    const value = await response;
    if (!exactKeys(value, ['schemaVersion', 'nonce', 'status']) || value.schemaVersion !== 1 ||
      value.nonce !== nonce || value.status !== 'validated') throw failure();
  } catch {
    throw failure();
  } finally {
    socket.destroy();
  }
}

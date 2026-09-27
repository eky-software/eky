export const backendServiceProtocol = 'eky.e2e.backend-service';
export const backendServiceSchemaVersion = 1;
export const backendServiceFrameBytes = 4096;
export const backendServiceCleanupMilliseconds = 3_000;

const operationalFailures = new Set([
  'launchRejected', 'processStartFailed', 'processIdentityFailed', 'jobMembershipFailed',
  'processResumeFailed', 'workDeadlineExceeded', 'callerLost', 'protocolInvalid',
  'observationLost', 'stdioFailed', 'ownerFailed',
]);
const cleanupFailures = new Set([
  'jobTerminateFailed', 'observationLost', 'stdioFailed', 'cleanupDeadlineExceeded',
  'evidenceWriteFailed', 'ownerFailed',
]);

export type BackendServiceRequestKind = 'launch' | 'status' | 'rss' | 'stop';
export interface BackendServiceIdentity {
  readonly pid: number;
  readonly creationTimeFileTimeHex: string;
}
export interface BackendServiceState {
  readonly created: boolean;
  readonly started: boolean;
  readonly creationCompleted: boolean;
  readonly launchClosed: boolean;
  readonly identity: BackendServiceIdentity | null;
  readonly workload: 'pending' | 'running' | 'exited' | 'unavailable';
  readonly exitCode: number | null;
  readonly assignedBeforeResume: boolean;
  readonly activeProcesses: number | null;
  readonly stdioSettled: boolean;
  readonly firstFailure: string | null;
  readonly cleanup: 'pending' | 'processTreeAbsent' | 'cleanupUnverified';
  readonly cleanupFailure: string | null;
}
export interface BackendServiceReply {
  readonly protocol: typeof backendServiceProtocol;
  readonly schemaVersion: typeof backendServiceSchemaVersion;
  readonly generation: string;
  readonly sequence: number;
  readonly replyTo: number | null;
  readonly kind: 'started' | 'status' | 'rss' | 'rootExit' | 'terminal';
  readonly state: BackendServiceState;
  readonly rssBytes: number | null;
  readonly elapsedMilliseconds: number;
  readonly cleanupStartedElapsedMilliseconds: number | null;
  readonly remainingCleanupMilliseconds: number | null;
}

export function requireBackendServiceToken(value: unknown): asserts value is string {
  requireCondition(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value));
}

export function encodeBackendServiceRequest(
  generation: string, sequence: number, kind: BackendServiceRequestKind, launchNonce?: string,
  workDeadlineElapsedMilliseconds?: number,
): Buffer {
  requireBackendServiceToken(generation);
  requireCondition(integer(sequence, 1, Number.MAX_SAFE_INTEGER));
  requireCondition(['launch', 'status', 'rss', 'stop'].includes(kind));
  if (kind === 'launch') {
    requireBackendServiceToken(launchNonce);
    requireCondition(integer(workDeadlineElapsedMilliseconds, 1, Number.MAX_SAFE_INTEGER));
  } else requireCondition(launchNonce === undefined && workDeadlineElapsedMilliseconds === undefined);
  return Buffer.from(JSON.stringify({
    protocol: backendServiceProtocol, schemaVersion: backendServiceSchemaVersion,
    generation, sequence, kind, ...(kind === 'launch' ? { launchNonce, workDeadlineElapsedMilliseconds } : {}),
  }) + '\n');
}

export function validateBackendServiceReply(
  value: unknown, generation: string, previousSequence: number,
): BackendServiceReply {
  const reply = record(value, ['protocol', 'schemaVersion', 'generation', 'sequence', 'replyTo',
    'kind', 'state', 'rssBytes', 'elapsedMilliseconds', 'cleanupStartedElapsedMilliseconds', 'remainingCleanupMilliseconds']);
  requireBackendServiceToken(generation);
  requireCondition(integer(previousSequence, 0, Number.MAX_SAFE_INTEGER - 1));
  requireCondition(reply.protocol === backendServiceProtocol && reply.schemaVersion === backendServiceSchemaVersion &&
    reply.generation === generation && integer(reply.sequence, 1, Number.MAX_SAFE_INTEGER) &&
    reply.sequence === previousSequence + 1);
  requireCondition(reply.replyTo === null || integer(reply.replyTo, 1, Number.MAX_SAFE_INTEGER));
  requireCondition(typeof reply.kind === 'string' && ['started', 'status', 'rss', 'rootExit', 'terminal'].includes(reply.kind));
  const state = validateState(reply.state);
  requireCondition(integer(reply.elapsedMilliseconds, 0, Number.MAX_SAFE_INTEGER - backendServiceCleanupMilliseconds));
  const stopping = reply.cleanupStartedElapsedMilliseconds !== null;
  requireCondition(stopping
    ? integer(reply.cleanupStartedElapsedMilliseconds, 0, Number.MAX_SAFE_INTEGER) &&
      integer(reply.remainingCleanupMilliseconds, 0, backendServiceCleanupMilliseconds) && state.launchClosed
    : reply.remainingCleanupMilliseconds === null && state.cleanup === 'pending');
  if (stopping) requireCondition((reply.cleanupStartedElapsedMilliseconds as number) <= (reply.elapsedMilliseconds as number) &&
    (reply.remainingCleanupMilliseconds as number) <= Math.max(0,
      (reply.cleanupStartedElapsedMilliseconds as number) + backendServiceCleanupMilliseconds - (reply.elapsedMilliseconds as number)));
  requireCondition(reply.kind === 'rss'
    ? reply.rssBytes === null || integer(reply.rssBytes, 1, Number.MAX_SAFE_INTEGER)
    : reply.rssBytes === null);
  if (reply.rssBytes !== null) requireCondition(state.workload === 'running');
  if (reply.kind === 'started') requireCondition(state.started && reply.replyTo !== null);
  if (reply.kind === 'rootExit') requireCondition(state.workload === 'exited' && reply.replyTo === null);
  if (reply.kind === 'status' || reply.kind === 'rss') requireCondition(reply.replyTo !== null);
  if (reply.kind === 'terminal') requireCondition(stopping && state.cleanup !== 'pending');
  else requireCondition(state.cleanup === 'pending');
  return Object.freeze({ ...reply, state }) as unknown as BackendServiceReply;
}

function validateState(value: unknown): BackendServiceState {
  const state = record(value, ['created', 'started', 'creationCompleted', 'launchClosed', 'identity',
    'workload', 'exitCode', 'assignedBeforeResume', 'activeProcesses', 'stdioSettled', 'firstFailure',
    'cleanup', 'cleanupFailure']);
  for (const key of ['created', 'started', 'creationCompleted', 'launchClosed', 'assignedBeforeResume', 'stdioSettled']) {
    requireCondition(typeof state[key] === 'boolean');
  }
  requireCondition(typeof state.workload === 'string' && ['pending', 'running', 'exited', 'unavailable'].includes(state.workload));
  requireCondition(typeof state.cleanup === 'string' && ['pending', 'processTreeAbsent', 'cleanupUnverified'].includes(state.cleanup));
  requireCondition(state.firstFailure === null || typeof state.firstFailure === 'string' && operationalFailures.has(state.firstFailure));
  requireCondition(state.cleanupFailure === null || typeof state.cleanupFailure === 'string' && cleanupFailures.has(state.cleanupFailure));
  requireCondition(state.activeProcesses === null || integer(state.activeProcesses, 0, 0xffffffff));
  requireCondition(state.exitCode === null || integer(state.exitCode, -0x80000000, 0x7fffffff));
  requireCondition((state.workload === 'exited') === (state.exitCode !== null));
  let identity: BackendServiceIdentity | null = null;
  if (state.identity !== null) {
    const fields = record(state.identity, ['pid', 'creationTimeFileTimeHex']);
    requireCondition(integer(fields.pid, 1, 0xffffffff) && typeof fields.creationTimeFileTimeHex === 'string' &&
      /^[0-9a-f]{16}$/.test(fields.creationTimeFileTimeHex) && fields.creationTimeFileTimeHex !== '0000000000000000');
    requireCondition(state.created === true);
    identity = Object.freeze({ ...fields }) as unknown as BackendServiceIdentity;
  }
  if (state.assignedBeforeResume) requireCondition(state.created === true);
  if (state.started) requireCondition(state.created === true && identity !== null && state.assignedBeforeResume === true &&
    state.creationCompleted === true && state.launchClosed === true);
  if (state.workload === 'running') requireCondition(state.started === true);
  if (state.workload === 'exited') requireCondition(state.created === true);
  if (state.cleanupFailure !== null) requireCondition(state.cleanup === 'cleanupUnverified');
  if (state.cleanup === 'processTreeAbsent') requireCondition(state.launchClosed === true && state.creationCompleted === true &&
    (!state.created || state.workload === 'exited') && state.activeProcesses === 0 && state.stdioSettled === true &&
    state.cleanupFailure === null);
  return Object.freeze({ ...state, identity }) as unknown as BackendServiceState;
}

// Compact canonical JSON makes duplicate keys and alternate encodings rejectable
// without introducing another JSON parser. The native DTO contains only ASCII fields.
export function createBackendServiceFrameReader(accept: (value: unknown) => void) {
  const bytes = Buffer.alloc(backendServiceFrameBytes);
  let length = 0;
  let failed = false;
  return {
    push(chunk: Buffer) {
      requireCondition(!failed);
      try {
        for (const byte of chunk) {
          if (byte !== 10) {
            requireCondition(length < backendServiceFrameBytes - 1);
            bytes[length++] = byte;
            continue;
          }
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
          const value: unknown = JSON.parse(text);
          requireCondition(JSON.stringify(value) === text);
          length = 0;
          accept(value);
        }
      } catch {
        failed = true;
        throw new Error('E2E_BACKEND_OWNER_PROTOCOL_INVALID');
      }
    },
    end() {
      requireCondition(!failed && length === 0);
    },
  };
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value));
  const result = value as Record<string, unknown>;
  const actual = Object.keys(result);
  requireCondition(actual.length === keys.length && actual.every(key => keys.includes(key)));
  return result;
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function requireCondition(valid: boolean): asserts valid {
  if (!valid) throw new Error('E2E_BACKEND_OWNER_PROTOCOL_INVALID');
}

import { performance } from 'node:perf_hooks';

import type { EncryptedSecretFileStore } from './encryptedSecretFile.js';
import { SecretBrokerError } from './secretBrokerErrors.js';
import {
  isCompanyId,
  isSecret,
  isSecretBrokerGenerationId,
  parseSecretBrokerRequest,
  readSecretBrokerBinding,
  secretBrokerDrainTimeoutMilliseconds,
  type SecretBrokerBinding,
  type SecretBrokerRequest,
  type SecretBrokerResponse,
  type SecretBrokerSuccessResult,
} from './secretBrokerProtocol.js';
import type { SecretBrokerTransport } from './secretBrokerTransport.js';
import type { StringProtector } from './safeStorageStringProtector.js';

const secretPayloadVersion = 1;

interface SecretPayload {
  companyId: string;
  formatVersion: typeof secretPayloadVersion;
  secret: string;
}

export interface SecretBrokerMainHandle {
  close(): Promise<void>;
  sealAndDrain(): Promise<void>;
  hasFailedMutation(): boolean;
}

export interface SecretBrokerObserver {
  // Private synthetic-test opt-in only. The receiver must sanitize and gate persistence;
  // never connect this to IPC, operational logging or an ordinary user profile.
  captureOriginalException?(error: unknown): void;
  drainFailed?(errorCode: SecretBrokerError['code']): void;
  operationFailed(
    operation: SecretBrokerRequest['operation'],
    errorCode: SecretBrokerError['code'],
  ): void;
}

export function startSecretBrokerMain(input: {
  encryptedSecretFile: EncryptedSecretFileStore;
  generationId: string;
  now?: () => number;
  observer?: SecretBrokerObserver;
  protector: StringProtector;
  transport: SecretBrokerTransport;
}): SecretBrokerMainHandle {
  if (!isSecretBrokerGenerationId(input.generationId)) {
    throw new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID', 'noEffect');
  }
  const now = input.now ?? (() => performance.now());
  const generationId = input.generationId;
  const queue: SecretBrokerRequest[] = [];
  let accepting = true;
  let active = false;
  let pumping = false;
  let transportEnded = false;
  let tearingDown = false;
  let sealing = false;
  let failedMutation = false;
  let failure: SecretBrokerError | undefined;
  let drainTask: Promise<void> | undefined;
  let closeTask: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finishDrain: (() => void) | undefined;

  function fail(error: SecretBrokerError): void {
    failure ??= error;
    accepting = false;
    rejectUnstarted();
    finishDrain?.();
  }

  function send(response: SecretBrokerResponse): void {
    if (
      response.generationId === generationId &&
      (response.operation === 'setCompanyEmailSecret' || response.operation === 'removeCompanyEmailSecret')
    ) {
      // A later explicit successful mutation supersedes a known-unaffected failure.
      // Reads and uncertain outcomes must never clear the outstanding notice.
      if (response.ok) failedMutation = false;
      else if (response.effect === 'noEffect') failedMutation = true;
    }
    if (transportEnded) return;
    try {
      input.transport.send(response);
    } catch {
      transportEnded = true;
      fail(new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED'));
    }
  }

  function rejectUnstarted(): void {
    for (const request of queue.splice(0)) {
      send(createErrorResponse(request, 'SECRET_BROKER_GENERATION_CLOSED', 'noEffect'));
    }
  }

  function pump(): void {
    if (active || !accepting) return;
    const request = queue.shift();
    if (request === undefined) return;
    active = true;
    void handleSecretBrokerMessage(request, { ...input, generationId }).then(
      (response) => {
        if (response === undefined) {
          fail(new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID'));
        } else {
          if (!response.ok && response.effect === 'unknown') {
            fail(new SecretBrokerError(response.errorCode));
          }
          send(response);
        }
        finishWork();
      },
      () => {
        fail(new SecretBrokerError('SECRET_STORAGE_UNAVAILABLE'));
        send(createErrorResponse(request, 'SECRET_STORAGE_UNAVAILABLE', 'unknown'));
        finishWork();
      },
    );
  }

  function finishWork(): void {
    active = false;
    finishDrain?.();
    pump();
  }

  let unsubscribe = () => {};
  let unsubscribeTerminal = () => {};
  try {
    unsubscribe = input.transport.subscribe((value) => {
      const binding = readSecretBrokerBinding(value);
      const request = parseSecretBrokerRequest(value);
      if (request === undefined || request.generationId !== generationId) {
        if (binding !== undefined) {
          send(createErrorResponse(binding, 'SECRET_BROKER_REQUEST_INVALID', 'noEffect'));
        }
        return;
      }
      if (!accepting) {
        send(createErrorResponse(request, 'SECRET_BROKER_GENERATION_CLOSED', 'noEffect'));
        return;
      }
      queue.push(request);
      if (!pumping) {
        pumping = true;
        queueMicrotask(() => {
          pumping = false;
          pump();
        });
      }
    });
    unsubscribeTerminal = input.transport.subscribeTerminal((reason) => {
      transportEnded = true;
      // The backend closes its port after audit settlement and a successful seal.
      if (tearingDown || (reason === 'closed' && drainTask !== undefined && !active && queue.length === 0)) return;
      fail(new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED'));
    });
  } catch {
    fail(new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED'));
  }

  function sealAndDrain(): Promise<void> {
    if (drainTask !== undefined) return drainTask;
    accepting = false;
    const deadline = now() + secretBrokerDrainTimeoutMilliseconds;
    let resolve!: () => void;
    let reject!: (error: SecretBrokerError) => void;
    drainTask = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    let settled = false;
    finishDrain = () => {
      if (settled || sealing) return;
      if (now() >= deadline) {
        failure ??= new SecretBrokerError('SECRET_BROKER_DRAIN_TIMEOUT');
      } else if (active) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (failure !== undefined) {
        reject(failure);
        try {
          // Observation never joins the drain deadline or replaces its first failure.
          void Promise.resolve(input.observer?.drainFailed?.(failure.code)).catch(() => undefined);
        } catch {
          // Synchronous observers are also best effort.
        }
      } else resolve();
    };
    // Publish the task before rejecting queued work: sends may re-enter close.
    const onDeadline = () => {
      const remaining = deadline - now();
      if (remaining > 0) timer = setTimeout(onDeadline, remaining);
      else finishDrain?.();
    };
    timer = setTimeout(onDeadline, Math.max(0, deadline - now()));
    sealing = true;
    rejectUnstarted();
    sealing = false;
    finishDrain();
    return drainTask;
  }

  function close(): Promise<void> {
    if (closeTask !== undefined) return closeTask;
    let resolve!: () => void;
    let reject!: (error: SecretBrokerError) => void;
    closeTask = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const teardown = () => {
      tearingDown = true;
      for (const dispose of [unsubscribe, unsubscribeTerminal, () => input.transport.close()]) {
        try {
          dispose();
        } catch {
          failure ??= new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED');
        }
      }
      transportEnded = true;
      if (failure !== undefined) reject(failure);
      else resolve();
    };
    void sealAndDrain().then(teardown, teardown);
    return closeTask;
  }

  return { close, sealAndDrain, hasFailedMutation: () => failedMutation };
}

export async function handleSecretBrokerMessage(
  value: unknown,
  dependencies: {
    encryptedSecretFile: EncryptedSecretFileStore;
    generationId?: string;
    observer?: SecretBrokerObserver;
    protector: StringProtector;
  },
): Promise<SecretBrokerResponse | undefined> {
  const binding = readSecretBrokerBinding(value);
  const request = parseSecretBrokerRequest(value);

  if (
    request === undefined ||
    (dependencies.generationId !== undefined && request.generationId !== dependencies.generationId)
  ) {
    return binding === undefined
      ? undefined
      : createErrorResponse(binding, 'SECRET_BROKER_REQUEST_INVALID', 'noEffect');
  }

  let mutationEntered = false;
  try {
    const result = await executeRequest(request, dependencies, () => {
      mutationEntered = true;
    });

    return {
      ...readSecretBrokerBinding(request)!,
      ok: true,
      result,
    };
  } catch (error) {
    try {
      dependencies.observer?.captureOriginalException?.(error);
    } catch {
      // Optional private observation must not replace the original outcome.
    }
    const code =
      error instanceof SecretBrokerError
        ? error.code
        : 'SECRET_STORAGE_UNAVAILABLE';
    try {
      dependencies.observer?.operationFailed(request.operation, code);
    } catch {
      // Diagnostics must not change the classified store outcome.
    }

    return createErrorResponse(request, code, mutationEntered ? 'unknown' : 'noEffect');
  }
}

async function executeRequest(
  request: SecretBrokerRequest,
  dependencies: {
    encryptedSecretFile: EncryptedSecretFileStore;
    protector: StringProtector;
  },
  enterMutation: () => void,
): Promise<SecretBrokerSuccessResult> {
  if (request.operation === 'setCompanyEmailSecret') {
    const payload = JSON.stringify({
      companyId: request.companyId,
      formatVersion: secretPayloadVersion,
      secret: request.secret,
    } satisfies SecretPayload);
    const ciphertext = await dependencies.protector.encrypt(payload);

    try {
      enterMutation();
      await dependencies.encryptedSecretFile.write(ciphertext);
    } finally {
      ciphertext.fill(0);
    }

    return { configured: true };
  }

  const storedPayload = await readStoredPayload(dependencies, enterMutation);
  const belongsToCompany = storedPayload?.companyId === request.companyId;

  if (request.operation === 'hasCompanyEmailSecret') {
    return { configured: belongsToCompany };
  }

  if (request.operation === 'removeCompanyEmailSecret') {
    if (belongsToCompany) {
      enterMutation();
      await dependencies.encryptedSecretFile.remove();
    }

    return { configured: false };
  }

  if (!belongsToCompany || storedPayload === null) {
    return { secret: null };
  }

  return { secret: storedPayload.secret };
}

async function readStoredPayload(
  dependencies: {
    encryptedSecretFile: EncryptedSecretFileStore;
    protector: StringProtector;
  },
  enterMutation: () => void,
): Promise<SecretPayload | null> {
  const candidate = await dependencies.encryptedSecretFile.readCandidate();

  if (candidate === null) {
    return null;
  }

  let decrypted;

  try {
    decrypted = await dependencies.protector.decrypt(candidate.ciphertext);
  } finally {
    candidate.ciphertext.fill(0);
  }
  const payload = parseSecretPayload(decrypted.value);

  enterMutation();
  await dependencies.encryptedSecretFile.confirm(candidate);

  if (decrypted.shouldReEncrypt) {
    const refreshedCiphertext = await dependencies.protector.encrypt(
      decrypted.value,
    );

    try {
      enterMutation();
      await dependencies.encryptedSecretFile.write(refreshedCiphertext);
    } finally {
      refreshedCiphertext.fill(0);
    }
  }

  return payload;
}

function parseSecretPayload(value: string): SecretPayload {
  let payload: unknown;

  try {
    payload = JSON.parse(value);
  } catch {
    throw new SecretBrokerError('SECRET_PAYLOAD_INVALID');
  }

  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, ['companyId', 'formatVersion', 'secret']) ||
    payload.formatVersion !== secretPayloadVersion ||
    !isCompanyId(payload.companyId) ||
    !isSecret(payload.secret)
  ) {
    throw new SecretBrokerError('SECRET_PAYLOAD_INVALID');
  }

  return {
    companyId: payload.companyId,
    formatVersion: secretPayloadVersion,
    secret: payload.secret,
  };
}

function createErrorResponse(
  binding: SecretBrokerBinding,
  errorCode: SecretBrokerError['code'],
  effect: SecretBrokerError['effect'],
): SecretBrokerResponse {
  return {
    ...readSecretBrokerBinding(binding)!,
    effect,
    errorCode,
    ok: false,
  };
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();

  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

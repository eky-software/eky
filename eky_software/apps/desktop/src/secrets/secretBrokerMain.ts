import type { EncryptedSecretFileStore } from './encryptedSecretFile.js';
import { SecretBrokerError } from './secretBrokerErrors.js';
import {
  isCompanyId,
  isSecret,
  parseSecretBrokerRequest,
  readValidRequestId,
  secretBrokerProtocolVersion,
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
  close(): void;
}

export interface SecretBrokerObserver {
  operationFailed(
    operation: SecretBrokerRequest['operation'],
    errorCode: SecretBrokerError['code'],
  ): void;
}

export function startSecretBrokerMain(input: {
  encryptedSecretFile: EncryptedSecretFileStore;
  observer?: SecretBrokerObserver;
  protector: StringProtector;
  transport: SecretBrokerTransport;
}): SecretBrokerMainHandle {
  let closed = false;
  let operationQueue = Promise.resolve();
  const unsubscribe = input.transport.subscribe((value) => {
    operationQueue = operationQueue
      .then(async () => {
        if (closed) {
          return;
        }

        const response = await handleSecretBrokerMessage(value, input);

        if (response !== undefined && !closed) {
          input.transport.send(response);
        }
      })
      .catch(() => undefined);
  });

  return {
    close() {
      if (closed) {
        return;
      }

      closed = true;
      unsubscribe();
      input.transport.close();
    },
  };
}

export async function handleSecretBrokerMessage(
  value: unknown,
  dependencies: {
    encryptedSecretFile: EncryptedSecretFileStore;
    observer?: SecretBrokerObserver;
    protector: StringProtector;
  },
): Promise<SecretBrokerResponse | undefined> {
  const requestId = readValidRequestId(value);
  const request = parseSecretBrokerRequest(value);

  if (request === undefined) {
    return requestId === undefined
      ? undefined
      : createErrorResponse(requestId, 'SECRET_BROKER_REQUEST_INVALID');
  }

  try {
    const result = await executeRequest(request, dependencies);

    return {
      ok: true,
      protocolVersion: secretBrokerProtocolVersion,
      requestId: request.requestId,
      result,
    };
  } catch (error) {
    const code =
      error instanceof SecretBrokerError
        ? error.code
        : 'SECRET_STORAGE_UNAVAILABLE';
    dependencies.observer?.operationFailed(request.operation, code);

    return createErrorResponse(request.requestId, code);
  }
}

async function executeRequest(
  request: SecretBrokerRequest,
  dependencies: {
    encryptedSecretFile: EncryptedSecretFileStore;
    protector: StringProtector;
  },
): Promise<SecretBrokerSuccessResult> {
  if (request.operation === 'setCompanyEmailSecret') {
    const payload = JSON.stringify({
      companyId: request.companyId,
      formatVersion: secretPayloadVersion,
      secret: request.secret,
    } satisfies SecretPayload);
    const ciphertext = await dependencies.protector.encrypt(payload);

    try {
      await dependencies.encryptedSecretFile.write(ciphertext);
    } finally {
      ciphertext.fill(0);
    }

    return { configured: true };
  }

  const storedPayload = await readStoredPayload(dependencies);
  const belongsToCompany = storedPayload?.companyId === request.companyId;

  if (request.operation === 'hasCompanyEmailSecret') {
    return { configured: belongsToCompany };
  }

  if (request.operation === 'removeCompanyEmailSecret') {
    if (belongsToCompany) {
      await dependencies.encryptedSecretFile.remove();
    }

    return { configured: false };
  }

  if (!belongsToCompany || storedPayload === null) {
    throw new SecretBrokerError('SECRET_NOT_CONFIGURED');
  }

  return { secret: storedPayload.secret };
}

async function readStoredPayload(dependencies: {
  encryptedSecretFile: EncryptedSecretFileStore;
  protector: StringProtector;
}): Promise<SecretPayload | null> {
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

  await dependencies.encryptedSecretFile.confirm(candidate);

  if (decrypted.shouldReEncrypt) {
    const refreshedCiphertext = await dependencies.protector.encrypt(
      decrypted.value,
    );

    try {
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
  requestId: string,
  errorCode: SecretBrokerError['code'],
): SecretBrokerResponse {
  return {
    errorCode,
    ok: false,
    protocolVersion: secretBrokerProtocolVersion,
    requestId,
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

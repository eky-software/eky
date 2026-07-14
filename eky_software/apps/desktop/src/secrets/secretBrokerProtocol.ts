import {
  isSecretBrokerErrorCode,
  type SecretBrokerErrorCode,
} from './secretBrokerErrors.js';

export const secretBrokerProtocolVersion = 1;
export const maximumSecretCharacters = 1_024;
export const maximumSecretBytes = 4_096;

const maximumCompanyIdCharacters = 200;
const maximumRequestBytes = 8_192;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/;
const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SecretBrokerOperation =
  | 'hasCompanyEmailSecret'
  | 'readCompanyEmailSecret'
  | 'removeCompanyEmailSecret'
  | 'setCompanyEmailSecret';

interface SecretBrokerRequestBase {
  companyId: string;
  operation: SecretBrokerOperation;
  protocolVersion: typeof secretBrokerProtocolVersion;
  requestId: string;
}

export interface SetCompanyEmailSecretBrokerRequest
  extends SecretBrokerRequestBase {
  operation: 'setCompanyEmailSecret';
  secret: string;
}

export type SecretBrokerRequest =
  | SetCompanyEmailSecretBrokerRequest
  | (SecretBrokerRequestBase & {
      operation:
        | 'hasCompanyEmailSecret'
        | 'readCompanyEmailSecret'
        | 'removeCompanyEmailSecret';
    });

export type SecretBrokerSuccessResult =
  | { configured: boolean }
  | { secret: string };

export type SecretBrokerResponse =
  | {
      errorCode: SecretBrokerErrorCode;
      ok: false;
      protocolVersion: typeof secretBrokerProtocolVersion;
      requestId: string;
    }
  | {
      ok: true;
      protocolVersion: typeof secretBrokerProtocolVersion;
      requestId: string;
      result: SecretBrokerSuccessResult;
    };

export function createSecretBrokerRequest(input: {
  companyId: string;
  operation: SecretBrokerOperation;
  requestId: string;
  secret?: string;
}): SecretBrokerRequest {
  const candidate = {
    companyId: input.companyId,
    operation: input.operation,
    protocolVersion: secretBrokerProtocolVersion,
    requestId: input.requestId,
    ...(input.operation === 'setCompanyEmailSecret'
      ? { secret: input.secret }
      : {}),
  };
  const request = parseSecretBrokerRequest(candidate);

  if (request === undefined) {
    throw new Error('Invalid secret broker request.');
  }

  return request;
}

export function parseSecretBrokerRequest(
  value: unknown,
): SecretBrokerRequest | undefined {
  if (!isRecord(value) || getSerializedByteLength(value) > maximumRequestBytes) {
    return undefined;
  }

  const operation = value.operation;

  if (
    value.protocolVersion !== secretBrokerProtocolVersion ||
    !isRequestId(value.requestId) ||
    !isCompanyId(value.companyId) ||
    !isSecretBrokerOperation(operation)
  ) {
    return undefined;
  }

  if (operation === 'setCompanyEmailSecret') {
    if (!hasExactKeys(value, ['companyId', 'operation', 'protocolVersion', 'requestId', 'secret'])) {
      return undefined;
    }

    if (!isSecret(value.secret)) {
      return undefined;
    }

    return {
      companyId: value.companyId,
      operation,
      protocolVersion: secretBrokerProtocolVersion,
      requestId: value.requestId,
      secret: value.secret,
    };
  }

  if (!hasExactKeys(value, ['companyId', 'operation', 'protocolVersion', 'requestId'])) {
    return undefined;
  }

  return {
    companyId: value.companyId,
    operation,
    protocolVersion: secretBrokerProtocolVersion,
    requestId: value.requestId,
  };
}

export function parseSecretBrokerResponse(
  value: unknown,
): SecretBrokerResponse | undefined {
  if (
    !isRecord(value) ||
    value.protocolVersion !== secretBrokerProtocolVersion ||
    !isRequestId(value.requestId) ||
    typeof value.ok !== 'boolean'
  ) {
    return undefined;
  }

  if (value.ok === false) {
    if (
      !hasExactKeys(value, ['errorCode', 'ok', 'protocolVersion', 'requestId']) ||
      !isSecretBrokerErrorCode(value.errorCode)
    ) {
      return undefined;
    }

    return {
      errorCode: value.errorCode,
      ok: false,
      protocolVersion: secretBrokerProtocolVersion,
      requestId: value.requestId,
    };
  }

  if (
    !hasExactKeys(value, ['ok', 'protocolVersion', 'requestId', 'result']) ||
    !isSecretBrokerSuccessResult(value.result)
  ) {
    return undefined;
  }

  return {
    ok: true,
    protocolVersion: secretBrokerProtocolVersion,
    requestId: value.requestId,
    result: value.result,
  };
}

export function readValidRequestId(value: unknown): string | undefined {
  return isRecord(value) && isRequestId(value.requestId)
    ? value.requestId
    : undefined;
}

export function isCompanyId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumCompanyIdCharacters &&
    value === value.trim() &&
    !controlCharacterPattern.test(value)
  );
}

export function isSecret(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumSecretCharacters &&
    Buffer.byteLength(value, 'utf8') <= maximumSecretBytes &&
    !controlCharacterPattern.test(value)
  );
}

function isSecretBrokerOperation(
  value: unknown,
): value is SecretBrokerOperation {
  return (
    value === 'hasCompanyEmailSecret' ||
    value === 'readCompanyEmailSecret' ||
    value === 'removeCompanyEmailSecret' ||
    value === 'setCompanyEmailSecret'
  );
}

function isSecretBrokerSuccessResult(
  value: unknown,
): value is SecretBrokerSuccessResult {
  if (!isRecord(value)) {
    return false;
  }

  if (hasExactKeys(value, ['configured'])) {
    return typeof value.configured === 'boolean';
  }

  return hasExactKeys(value, ['secret']) && isSecret(value.secret);
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && requestIdPattern.test(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();

  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}

function getSerializedByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import {
  isSecretBrokerErrorCode,
  SecretBrokerError,
  type SecretBrokerErrorCode,
  type SecretBrokerEffect,
} from './secretBrokerErrors.js';

export const secretBrokerProtocolVersion = 2;
export const secretBrokerRequestTimeoutMilliseconds = 10_000;
export const secretBrokerDrainTimeoutMilliseconds = 5_000;
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

export interface SecretBrokerBinding {
  companyId: string;
  generationId: string;
  operation: SecretBrokerOperation;
  protocolVersion: typeof secretBrokerProtocolVersion;
  requestId: string;
}

export interface SetCompanyEmailSecretBrokerRequest
  extends SecretBrokerBinding {
  operation: 'setCompanyEmailSecret';
  secret: string;
}

export type SecretBrokerRequest =
  | SetCompanyEmailSecretBrokerRequest
  | (SecretBrokerBinding & {
      operation:
        | 'hasCompanyEmailSecret'
        | 'readCompanyEmailSecret'
        | 'removeCompanyEmailSecret';
    });

export type SecretBrokerSuccessResult =
  | { configured: boolean }
  | { secret: string | null };

export type SecretBrokerResponse = SecretBrokerBinding & (
  | {
      effect: SecretBrokerEffect;
      errorCode: SecretBrokerErrorCode;
      ok: false;
    }
  | {
      ok: true;
      result: SecretBrokerSuccessResult;
    });

export function createSecretBrokerRequest(input: {
  companyId: string;
  generationId: string;
  operation: SecretBrokerOperation;
  requestId: string;
  secret?: string;
}): SecretBrokerRequest {
  const candidate = {
    companyId: input.companyId,
    generationId: input.generationId,
    operation: input.operation,
    protocolVersion: secretBrokerProtocolVersion,
    requestId: input.requestId,
    ...(input.operation === 'setCompanyEmailSecret'
      ? { secret: input.secret }
      : {}),
  };
  const request = parseSecretBrokerRequest(candidate);

  if (request === undefined) {
    throw new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID', 'noEffect');
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
    !isSecretBrokerGenerationId(value.generationId) ||
    !isCompanyId(value.companyId) ||
    !isSecretBrokerOperation(operation)
  ) {
    return undefined;
  }

  if (operation === 'setCompanyEmailSecret') {
    if (!hasExactKeys(value, [...bindingKeys, 'secret'])) {
      return undefined;
    }

    if (!isSecret(value.secret)) {
      return undefined;
    }

    return {
      companyId: value.companyId,
      generationId: value.generationId,
      operation,
      protocolVersion: secretBrokerProtocolVersion,
      requestId: value.requestId,
      secret: value.secret,
    };
  }

  if (!hasExactKeys(value, bindingKeys)) {
    return undefined;
  }

  return {
    companyId: value.companyId,
    generationId: value.generationId,
    operation,
    protocolVersion: secretBrokerProtocolVersion,
    requestId: value.requestId,
  };
}

export function parseSecretBrokerResponse(
  value: unknown,
): SecretBrokerResponse | undefined {
  const binding = readSecretBrokerBinding(value);
  if (
    binding === undefined || !isRecord(value) ||
    getSerializedByteLength(value) > maximumRequestBytes ||
    typeof value.ok !== 'boolean'
  ) {
    return undefined;
  }

  if (value.ok === false) {
    if (
      !hasExactKeys(value, [...bindingKeys, 'errorCode', 'effect', 'ok']) ||
      !isSecretBrokerErrorCode(value.errorCode) ||
      (value.effect !== 'noEffect' && value.effect !== 'unknown')
    ) {
      return undefined;
    }

    return {
      ...binding,
      effect: value.effect,
      errorCode: value.errorCode,
      ok: false,
    };
  }

  if (
    !hasExactKeys(value, [...bindingKeys, 'ok', 'result']) ||
    !isSecretBrokerSuccessResult(binding.operation, value.result)
  ) {
    return undefined;
  }

  return {
    ...binding,
    ok: true,
    result: 'secret' in value.result
      ? { secret: value.result.secret }
      : { configured: value.result.configured },
  };
}

const bindingKeys = ['companyId', 'generationId', 'operation', 'protocolVersion', 'requestId'] as const;

export function readSecretBrokerBinding(value: unknown): SecretBrokerBinding | undefined {
  if (!isRecord(value) || value.protocolVersion !== secretBrokerProtocolVersion ||
      !isCompanyId(value.companyId) || !isSecretBrokerGenerationId(value.generationId) ||
      !isRequestId(value.requestId) || !isSecretBrokerOperation(value.operation)) {
    return undefined;
  }
  return {
    companyId: value.companyId,
    generationId: value.generationId,
    operation: value.operation,
    protocolVersion: secretBrokerProtocolVersion,
    requestId: value.requestId,
  };
}

export function matchesSecretBrokerBinding(left: SecretBrokerBinding, right: SecretBrokerBinding): boolean {
  return bindingKeys.every(key => left[key] === right[key]);
}

export function isSecretBrokerGenerationId(value: unknown): value is string {
  return isRequestId(value);
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
  operation: SecretBrokerOperation,
  value: unknown,
): value is SecretBrokerSuccessResult {
  if (!isRecord(value)) {
    return false;
  }

  if (operation === 'readCompanyEmailSecret') {
    return hasExactKeys(value, ['secret']) && (value.secret === null || isSecret(value.secret));
  }
  return hasExactKeys(value, ['configured']) && typeof value.configured === 'boolean' &&
    (operation === 'hasCompanyEmailSecret' ||
      value.configured === (operation === 'setCompanyEmailSecret'));
}

export function isRequestId(value: unknown): value is string {
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

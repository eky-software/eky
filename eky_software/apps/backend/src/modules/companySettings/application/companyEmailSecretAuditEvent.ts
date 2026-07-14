import type {
  CompanyEmailSecretAuditAction,
  CompanyEmailSecretAuditCompletion,
  CompanyEmailSecretAuditOperation,
} from '../ports/companyEmailSecretAuditWriter.js';
import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failureCodePattern = /^[A-Z][A-Z0-9_]{0,99}$/;

export function createCompanyEmailSecretAuditOperation(input: {
  action: CompanyEmailSecretAuditAction;
  actorId: string;
  companyId: string;
  operationId: unknown;
  startedAt: unknown;
}): CompanyEmailSecretAuditOperation {
  assertOperationId(input.operationId);

  return Object.freeze({
    action: input.action,
    actorId: input.actorId,
    companyId: input.companyId,
    completedAt: null,
    failureCode: null,
    operationId: input.operationId,
    startedAt: normalizeTimestamp(input.startedAt),
    status: 'pending',
  });
}

export function createCompanyEmailSecretAuditCompletion(input: {
  completedAt: unknown;
  failureCode: unknown;
  operationId: unknown;
  status: 'failed' | 'succeeded';
}): CompanyEmailSecretAuditCompletion {
  assertOperationId(input.operationId);
  let failureCode: string | null;

  if (input.status === 'succeeded') {
    if (input.failureCode !== null) {
      throw new CompanySettingsValidationError(
        'Email secret audit completion is invalid.',
      );
    }

    failureCode = null;
  } else if (
    typeof input.failureCode !== 'string' ||
    !failureCodePattern.test(input.failureCode)
  ) {
    throw new CompanySettingsValidationError(
      'Email secret audit completion is invalid.',
    );
  } else {
    failureCode = input.failureCode;
  }

  return Object.freeze({
    completedAt: normalizeTimestamp(input.completedAt),
    failureCode,
    operationId: input.operationId,
    status: input.status,
  });
}

function assertOperationId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !operationIdPattern.test(value)) {
    throw new CompanySettingsValidationError(
      'Email secret audit operation is invalid.',
    );
  }
}

function normalizeTimestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new CompanySettingsValidationError(
      'Email secret audit timestamp is invalid.',
    );
  }

  return value;
}

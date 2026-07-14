import { randomUUID } from 'node:crypto';

import type { ActorContext } from '@eky/auth';

import type { CompanyEmailSecretAuditWriter } from '../ports/companyEmailSecretAuditWriter.js';
import {
  createCompanyEmailSecretAuditCompletion,
  createCompanyEmailSecretAuditOperation,
} from './companyEmailSecretAuditEvent.js';

const secretOperationFailureCode = 'SECRET_OPERATION_FAILED';

export class CompanyEmailSecretOperationError extends Error {
  readonly code:
    | 'COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE'
    | 'COMPANY_EMAIL_SECRET_OPERATION_FAILED';

  constructor(
    code:
      | 'COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE'
      | 'COMPANY_EMAIL_SECRET_OPERATION_FAILED',
  ) {
    super('Email secret operation could not be completed safely.');
    this.name = 'CompanyEmailSecretOperationError';
    this.code = code;
  }
}

export async function executeCompanyEmailSecretOperation<Result>(input: {
  action: 'set' | 'remove';
  actorContext: ActorContext;
  companyEmailSecretAuditWriter: CompanyEmailSecretAuditWriter;
  occurredAt: unknown;
  operation(): Promise<Result>;
}): Promise<Result> {
  const operationId = randomUUID();
  const pendingOperation = createCompanyEmailSecretAuditOperation({
    action: input.action,
    actorId: input.actorContext.actorId,
    companyId: input.actorContext.companyId,
    operationId,
    startedAt: input.occurredAt,
  });

  await input.companyEmailSecretAuditWriter.startCompanyEmailSecretAuditOperation(
    pendingOperation,
  );

  let result: Result;

  try {
    result = await input.operation();
  } catch {
    try {
      await input.companyEmailSecretAuditWriter.completeCompanyEmailSecretAuditOperation(
        createCompanyEmailSecretAuditCompletion({
          completedAt: input.occurredAt,
          failureCode: secretOperationFailureCode,
          operationId,
          status: 'failed',
        }),
      );
    } catch {
      // The pending row intentionally remains visible for later reconciliation.
    }

    throw new CompanyEmailSecretOperationError(
      'COMPANY_EMAIL_SECRET_OPERATION_FAILED',
    );
  }

  try {
    await input.companyEmailSecretAuditWriter.completeCompanyEmailSecretAuditOperation(
      createCompanyEmailSecretAuditCompletion({
        completedAt: input.occurredAt,
        failureCode: null,
        operationId,
        status: 'succeeded',
      }),
    );
  } catch {
    throw new CompanyEmailSecretOperationError(
      'COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE',
    );
  }

  return result;
}

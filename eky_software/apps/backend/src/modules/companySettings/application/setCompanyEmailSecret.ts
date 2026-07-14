import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import type { CompanyEmailSecretAuditWriter } from '../ports/companyEmailSecretAuditWriter.js';
import { createCompanyEmailSecretAuditEvent } from './companyEmailSecretAuditEvent.js';
import { normalizeCompanyEmailSecretInput } from './companyEmailSecretInput.js';
import {
  createCompanyEmailSecretStatus,
  type CompanyEmailSecretStatus,
} from './companyEmailSecretStatus.js';

export interface SetCompanyEmailSecretInput {
  actorContext: ActorContext;
  occurredAt: unknown;
  secret: unknown;
}

export interface SetCompanyEmailSecretDependencies {
  companyEmailSecretAuditWriter: CompanyEmailSecretAuditWriter;
  companyEmailSecretStore: CompanyEmailSecretStore;
}

export async function setCompanyEmailSecret(
  input: SetCompanyEmailSecretInput,
  dependencies: SetCompanyEmailSecretDependencies,
): Promise<CompanyEmailSecretStatus> {
  requirePermission(input.actorContext, 'manageCompanyEmailSecret');

  const secretInput = normalizeCompanyEmailSecretInput({
    companyId: input.actorContext.companyId,
    secret: input.secret,
  });
  const auditEvent = createCompanyEmailSecretAuditEvent({
    actorId: input.actorContext.actorId,
    companyId: secretInput.companyId,
    eventType: 'company_email_secret_set',
    occurredAt: input.occurredAt,
  });

  await dependencies.companyEmailSecretStore.setSecret(secretInput);
  await dependencies.companyEmailSecretAuditWriter.appendCompanyEmailSecretAuditEvent(
    auditEvent,
  );

  return createCompanyEmailSecretStatus(true);
}

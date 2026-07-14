import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import type { CompanyEmailSecretAuditWriter } from '../ports/companyEmailSecretAuditWriter.js';
import { createCompanyEmailSecretAuditEvent } from './companyEmailSecretAuditEvent.js';
import {
  createCompanyEmailSecretStatus,
  type CompanyEmailSecretStatus,
} from './companyEmailSecretStatus.js';

export interface RemoveCompanyEmailSecretInput {
  actorContext: ActorContext;
  occurredAt: unknown;
}

export interface RemoveCompanyEmailSecretDependencies {
  companyEmailSecretAuditWriter: CompanyEmailSecretAuditWriter;
  companyEmailSecretStore: CompanyEmailSecretStore;
}

export async function removeCompanyEmailSecret(
  input: RemoveCompanyEmailSecretInput,
  dependencies: RemoveCompanyEmailSecretDependencies,
): Promise<CompanyEmailSecretStatus> {
  requirePermission(input.actorContext, 'manageCompanyEmailSecret');

  const auditEvent = createCompanyEmailSecretAuditEvent({
    actorId: input.actorContext.actorId,
    companyId: input.actorContext.companyId,
    eventType: 'company_email_secret_removed',
    occurredAt: input.occurredAt,
  });

  await dependencies.companyEmailSecretStore.removeSecret(
    input.actorContext.companyId,
  );
  await dependencies.companyEmailSecretAuditWriter.appendCompanyEmailSecretAuditEvent(
    auditEvent,
  );

  return createCompanyEmailSecretStatus(false);
}

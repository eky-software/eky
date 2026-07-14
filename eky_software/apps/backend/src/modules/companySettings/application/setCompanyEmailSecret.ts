import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import type { CompanyEmailSecretAuditWriter } from '../ports/companyEmailSecretAuditWriter.js';
import { executeCompanyEmailSecretOperation } from './executeCompanyEmailSecretOperation.js';
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
  return executeCompanyEmailSecretOperation({
    action: 'set',
    actorContext: input.actorContext,
    companyEmailSecretAuditWriter:
      dependencies.companyEmailSecretAuditWriter,
    occurredAt: input.occurredAt,
    async operation() {
      await dependencies.companyEmailSecretStore.setSecret(secretInput);

      return createCompanyEmailSecretStatus(true);
    },
  });
}

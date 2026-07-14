import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import type { CompanyEmailSecretAuditWriter } from '../ports/companyEmailSecretAuditWriter.js';
import { executeCompanyEmailSecretOperation } from './executeCompanyEmailSecretOperation.js';
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

  return executeCompanyEmailSecretOperation({
    action: 'remove',
    actorContext: input.actorContext,
    companyEmailSecretAuditWriter:
      dependencies.companyEmailSecretAuditWriter,
    occurredAt: input.occurredAt,
    async operation() {
      await dependencies.companyEmailSecretStore.removeSecret(
        input.actorContext.companyId,
      );

      return createCompanyEmailSecretStatus(false);
    },
  });
}

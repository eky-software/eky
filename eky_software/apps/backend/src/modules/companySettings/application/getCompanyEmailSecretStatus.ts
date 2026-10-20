import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import { CompanyEmailSecretStoreError } from '../ports/companyEmailSecretStoreError.js';
import {
  createCompanyEmailSecretStatus,
  type CompanyEmailSecretStatus,
} from './companyEmailSecretStatus.js';
import { CompanyEmailSecretOperationError } from './executeCompanyEmailSecretOperation.js';

export interface GetCompanyEmailSecretStatusInput {
  actorContext: ActorContext;
}

export interface GetCompanyEmailSecretStatusDependencies {
  companyEmailSecretStore: CompanyEmailSecretStore;
}

export async function getCompanyEmailSecretStatus(
  input: GetCompanyEmailSecretStatusInput,
  dependencies: GetCompanyEmailSecretStatusDependencies,
): Promise<CompanyEmailSecretStatus> {
  requirePermission(input.actorContext, 'manageCompanyEmailSecret');

  let configured: boolean;

  try {
    configured = await dependencies.companyEmailSecretStore.hasSecret(
      input.actorContext.companyId,
    );
  } catch (error) {
    throw new CompanyEmailSecretOperationError(
      error instanceof CompanyEmailSecretStoreError && error.effect === 'noEffect'
        ? 'COMPANY_EMAIL_SECRET_OPERATION_FAILED'
        : 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN',
    );
  }

  return createCompanyEmailSecretStatus(configured);
}

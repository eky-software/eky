import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
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
  } catch {
    throw new CompanyEmailSecretOperationError(
      'COMPANY_EMAIL_SECRET_OPERATION_FAILED',
    );
  }

  return createCompanyEmailSecretStatus(configured);
}

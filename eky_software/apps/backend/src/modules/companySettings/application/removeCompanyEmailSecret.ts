import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import {
  createCompanyEmailSecretStatus,
  type CompanyEmailSecretStatus,
} from './companyEmailSecretStatus.js';

export interface RemoveCompanyEmailSecretInput {
  actorContext: ActorContext;
}

export interface RemoveCompanyEmailSecretDependencies {
  companyEmailSecretStore: CompanyEmailSecretStore;
}

export async function removeCompanyEmailSecret(
  input: RemoveCompanyEmailSecretInput,
  dependencies: RemoveCompanyEmailSecretDependencies,
): Promise<CompanyEmailSecretStatus> {
  requirePermission(input.actorContext, 'manageCompanyEmailSecret');

  await dependencies.companyEmailSecretStore.removeSecret(
    input.actorContext.companyId,
  );

  return createCompanyEmailSecretStatus(false);
}

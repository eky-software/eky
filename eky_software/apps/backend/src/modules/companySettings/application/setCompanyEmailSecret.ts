import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import { normalizeCompanyEmailSecretInput } from './companyEmailSecretInput.js';
import {
  createCompanyEmailSecretStatus,
  type CompanyEmailSecretStatus,
} from './companyEmailSecretStatus.js';

export interface SetCompanyEmailSecretInput {
  actorContext: ActorContext;
  secret: unknown;
}

export interface SetCompanyEmailSecretDependencies {
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

  await dependencies.companyEmailSecretStore.setSecret(secretInput);

  return createCompanyEmailSecretStatus(true);
}

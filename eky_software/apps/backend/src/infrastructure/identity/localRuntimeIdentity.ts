import { createActorContext, type ActorContext } from '@eky/auth';
import type { Permission } from '@eky/permissions';

const installationIdPattern = /^[a-f0-9]{32}$/;

export interface LocalRuntimeIdentity {
  readonly actorId: string;
  readonly companyId: string;
  readonly installationId: string;
}

export interface CreateLocalRuntimeIdentityInput {
  actorId: unknown;
  companyId: unknown;
  installationId: unknown;
}

export class LocalRuntimeIdentityValidationError extends Error {
  readonly code = 'invalid_local_runtime_identity';

  constructor() {
    super('Local runtime identity is invalid.');
    this.name = 'LocalRuntimeIdentityValidationError';
  }
}

export function createLocalRuntimeIdentity(
  input: CreateLocalRuntimeIdentityInput,
): LocalRuntimeIdentity {
  if (
    typeof input.installationId !== 'string' ||
    !installationIdPattern.test(input.installationId)
  ) {
    throw new LocalRuntimeIdentityValidationError();
  }

  const identityContext = createActorContext({
    actorId: input.actorId,
    authenticationMode: 'local',
    companyId: input.companyId,
    permissions: [],
  });

  return Object.freeze({
    actorId: identityContext.actorId,
    companyId: identityContext.companyId,
    installationId: input.installationId,
  });
}

export function createLocalActorContext(
  identity: LocalRuntimeIdentity,
  permissions: readonly Permission[],
): ActorContext {
  return createActorContext({
    actorId: identity.actorId,
    authenticationMode: 'local',
    companyId: identity.companyId,
    permissions,
  });
}

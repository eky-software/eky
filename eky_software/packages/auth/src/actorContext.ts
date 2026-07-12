import { isPermission, type Permission } from '@eky/permissions';

import {
  isAuthenticationMode,
  type AuthenticationMode,
} from './authenticationMode.js';

const maximumIdentifierLength = 200;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/;

export interface ActorContext {
  readonly actorId: string;
  readonly authenticationMode: AuthenticationMode;
  readonly companyId: string;
  readonly permissions: readonly Permission[];
}

export interface CreateActorContextInput {
  actorId: unknown;
  authenticationMode: unknown;
  companyId: unknown;
  permissions: unknown;
}

export class ActorContextValidationError extends Error {
  readonly code = 'invalid_actor_context';

  constructor(message: string) {
    super(message);
    this.name = 'ActorContextValidationError';
  }
}

export function createActorContext(
  input: CreateActorContextInput,
): ActorContext {
  const permissions = normalizePermissions(input.permissions);
  const context: ActorContext = {
    actorId: normalizeIdentifier(input.actorId, 'Actor id'),
    authenticationMode: normalizeAuthenticationMode(input.authenticationMode),
    companyId: normalizeIdentifier(input.companyId, 'Company id'),
    permissions,
  };

  return Object.freeze(context);
}

function normalizeIdentifier(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new ActorContextValidationError(`${fieldName} must be text.`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new ActorContextValidationError(`${fieldName} is required.`);
  }

  if (normalizedValue.length > maximumIdentifierLength) {
    throw new ActorContextValidationError(
      `${fieldName} must be ${maximumIdentifierLength} characters or less.`,
    );
  }

  if (controlCharacterPattern.test(normalizedValue)) {
    throw new ActorContextValidationError(
      `${fieldName} contains unsupported control characters.`,
    );
  }

  return normalizedValue;
}

function normalizeAuthenticationMode(value: unknown): AuthenticationMode {
  if (!isAuthenticationMode(value)) {
    throw new ActorContextValidationError(
      'Authentication mode is not supported.',
    );
  }

  return value;
}

function normalizePermissions(value: unknown): readonly Permission[] {
  if (!Array.isArray(value)) {
    throw new ActorContextValidationError('Permissions must be a list.');
  }

  const permissions = Array.from(value, (permission) => {
    if (!isPermission(permission)) {
      throw new ActorContextValidationError(
        'Permissions contain an unsupported value.',
      );
    }

    return permission;
  });

  return Object.freeze(permissions);
}

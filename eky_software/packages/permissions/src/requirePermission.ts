import { AuthorizationError } from './authorizationError.js';
import { isPermission, type Permission } from './permission.js';

export interface PermissionContext {
  readonly permissions: readonly Permission[];
}

export function requirePermission(
  context: PermissionContext,
  requiredPermission: Permission,
): void {
  if (
    !isPermission(requiredPermission) ||
    !context.permissions.includes(requiredPermission)
  ) {
    throw new AuthorizationError();
  }
}

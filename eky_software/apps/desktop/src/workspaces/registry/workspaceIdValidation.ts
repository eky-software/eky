import { workspaceRegistryInvalid } from './workspaceRegistryError.js';
import type { WorkspaceId } from './workspaceRegistryTypes.js';

const canonicalWorkspaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validateWorkspaceId(value: unknown): WorkspaceId {
  if (
    typeof value !== 'string' ||
    !canonicalWorkspaceIdPattern.test(value)
  ) {
    return workspaceRegistryInvalid();
  }
  return value as WorkspaceId;
}

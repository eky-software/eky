import {
  WorkspaceRegistryValidationError,
  workspaceRegistryInvalid,
} from './workspaceRegistryError.js';
import { assertNoDuplicateWorkspaceRegistryKeys } from './workspaceRegistryDuplicateKeys.js';
import type { LocalWorkspaceRegistryV1 } from './workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from './workspaceRegistryValidation.js';

export const WORKSPACE_REGISTRY_MAX_BYTES = 64 * 1024;

export function parseWorkspaceRegistryBytes(
  bytes: Uint8Array,
): Readonly<LocalWorkspaceRegistryV1> {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength < 1 ||
      bytes.byteLength > WORKSPACE_REGISTRY_MAX_BYTES
    ) {
      return workspaceRegistryInvalid();
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertNoDuplicateWorkspaceRegistryKeys(source);
    const value: unknown = JSON.parse(source);
    return validateWorkspaceRegistry(value);
  } catch (error) {
    if (error instanceof WorkspaceRegistryValidationError) {
      throw error;
    }
    return workspaceRegistryInvalid();
  }
}

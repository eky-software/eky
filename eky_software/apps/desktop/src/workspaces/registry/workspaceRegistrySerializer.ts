import { workspaceRegistryInvalid } from './workspaceRegistryError.js';
import {
  WORKSPACE_REGISTRY_MAX_BYTES,
  parseWorkspaceRegistryBytes,
} from './workspaceRegistryBytes.js';
import type { LocalWorkspaceRegistryV1 } from './workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from './workspaceRegistryValidation.js';

export function serializeWorkspaceRegistry(
  value: unknown,
): Uint8Array {
  const registry = validateWorkspaceRegistry(value);
  const canonical = {
    formatVersion: 1,
    activeWorkspaceId: registry.activeWorkspaceId,
    workspaces: registry.workspaces.map((entry) => ({
      workspaceId: entry.workspaceId,
      workspaceLabel: entry.workspaceLabel,
      lineageIdentity: {
        formatVersion: 1,
        profileId: entry.lineageIdentity.profileId,
      },
      layoutVersion: 1,
      lifecycleState: entry.lifecycleState,
      createdAt: entry.createdAt,
    })),
  } as const;
  const bytes = new TextEncoder().encode(`${JSON.stringify(canonical)}\n`);
  if (bytes.byteLength > WORKSPACE_REGISTRY_MAX_BYTES) {
    return workspaceRegistryInvalid();
  }
  return bytes;
}

export function assertCanonicalWorkspaceRegistryRoundTrip(
  bytes: Uint8Array,
): Readonly<LocalWorkspaceRegistryV1> {
  const parsed = parseWorkspaceRegistryBytes(bytes);
  const serialized = serializeWorkspaceRegistry(parsed);
  if (!bytesAreEqual(bytes, serialized)) {
    return workspaceRegistryInvalid();
  }
  return parsed;
}

function bytesAreEqual(first: Uint8Array, second: Uint8Array): boolean {
  if (first.byteLength !== second.byteLength) {
    return false;
  }
  return first.every((value, index) => value === second[index]);
}

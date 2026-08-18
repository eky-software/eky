import { workspaceRegistryInvalid } from './workspaceRegistryError.js';
import type { WorkspaceLineageIdentityV1 } from './workspaceRegistryTypes.js';
import { hasExactDataKeys, isPlainDataRecord } from './workspaceRegistryValueShape.js';

const profileIdPattern = /^[0-9a-f]{64}$/;
const lineageKeys = ['formatVersion', 'profileId'] as const;

export function validateWorkspaceLineage(
  value: unknown,
): Readonly<WorkspaceLineageIdentityV1> {
  if (
    !isPlainDataRecord(value) ||
    !hasExactDataKeys(value, lineageKeys) ||
    value.formatVersion !== 1 ||
    typeof value.profileId !== 'string' ||
    !profileIdPattern.test(value.profileId)
  ) {
    return workspaceRegistryInvalid();
  }
  return Object.freeze({
    formatVersion: 1,
    profileId: value.profileId,
  });
}

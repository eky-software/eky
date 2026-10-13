import { readPrimaryOperationFailureCause } from './operationFailureCause.js';

export const profileInspectionFailureCauses = [
  'PROFILE_SCHEMA_UNSUPPORTED',
  'PROFILE_INSPECTION_LIMIT_EXCEEDED',
  'PROFILE_INSPECTION_TIMEOUT',
  'PROFILE_INSPECTION_PROTOCOL_INVALID',
  'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
] as const;

export type ProfileInspectionFailureCause =
  typeof profileInspectionFailureCauses[number];

export function readProfileInspectionFailureCause(
  error: unknown,
): ProfileInspectionFailureCause | undefined {
  return readPrimaryOperationFailureCause(error, profileInspectionFailureCauses);
}

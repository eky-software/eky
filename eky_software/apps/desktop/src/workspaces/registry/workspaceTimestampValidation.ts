import { workspaceRegistryInvalid } from './workspaceRegistryError.js';

const canonicalUtcTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function validateWorkspaceTimestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !canonicalUtcTimestampPattern.test(value)
  ) {
    return workspaceRegistryInvalid();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    return workspaceRegistryInvalid();
  }
  return value;
}

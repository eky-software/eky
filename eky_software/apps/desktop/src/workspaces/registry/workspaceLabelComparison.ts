import { validateWorkspaceLabel } from './workspaceLabelValidation.js';
import type { LocalWorkspaceRegistryEntryV1, WorkspaceId } from './workspaceRegistryTypes.js';

export function createWorkspaceLabelComparisonKey(value: unknown): string {
  return validateWorkspaceLabel(value)
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .toLowerCase()
    .toUpperCase()
    .normalize('NFC');
}

export function hasWorkspaceLabelConflict(
  workspaces: readonly Readonly<LocalWorkspaceRegistryEntryV1>[],
  workspaceLabel: string,
  exceptWorkspaceId?: WorkspaceId,
): boolean {
  const key = createWorkspaceLabelComparisonKey(workspaceLabel);
  return workspaces.some((entry) =>
    entry.workspaceId !== exceptWorkspaceId &&
    createWorkspaceLabelComparisonKey(entry.workspaceLabel) === key,
  );
}

export function findDuplicateWorkspaceLabelIds(
  workspaces: readonly Readonly<LocalWorkspaceRegistryEntryV1>[],
): ReadonlySet<WorkspaceId> {
  const firstByKey = new Map<string, WorkspaceId>();
  const duplicates = new Set<WorkspaceId>();
  for (const entry of workspaces) {
    const key = createWorkspaceLabelComparisonKey(entry.workspaceLabel);
    const first = firstByKey.get(key);
    if (first !== undefined) {
      duplicates.add(first);
      duplicates.add(entry.workspaceId);
    } else {
      firstByKey.set(key, entry.workspaceId);
    }
  }
  return duplicates;
}

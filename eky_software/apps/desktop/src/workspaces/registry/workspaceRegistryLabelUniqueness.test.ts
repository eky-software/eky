import { expect, it } from 'vitest';

import { findDuplicateWorkspaceLabelIds } from './workspaceLabelComparison.js';
import { validateWorkspaceId } from './workspaceIdValidation.js';
import { parseWorkspaceRegistryBytes } from './workspaceRegistryBytes.js';
import { appendReadyWorkspaceEntry, appendRecoveredWorkspaceEntry, renameWorkspaceLabel, WorkspaceRegistryMutationError } from './workspaceRegistryMutations.js';
import { serializeWorkspaceRegistry } from './workspaceRegistrySerializer.js';
import type { LocalWorkspaceRegistryEntryV1, LocalWorkspaceRegistryV1 } from './workspaceRegistryTypes.js';
import { WORKSPACE_REGISTRY_MAX_ENTRIES } from './workspaceRegistryValidation.js';

function entry(index: number, workspaceLabel: string, lifecycleState: 'ready' | 'recoveryRequired' = 'ready'): LocalWorkspaceRegistryEntryV1 {
  return { workspaceId: validateWorkspaceId(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    workspaceLabel, lifecycleState, layoutVersion: 1,
    lineageIdentity: { formatVersion: 1, profileId: index.toString(16).padStart(64, '0') },
    createdAt: '2026-10-25T10:00:00.000Z' };
}
function registry(workspaces: readonly LocalWorkspaceRegistryEntryV1[]): LocalWorkspaceRegistryV1 {
  return { formatVersion: 1, activeWorkspaceId: workspaces[0]!.workspaceId, workspaces };
}
function expectConflict(operation: () => unknown): void {
  try {
    operation();
    throw new Error('Expected a label conflict');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceRegistryMutationError);
    expect((error as WorkspaceRegistryMutationError).failure).toBe('workspaceLabelExists');
  }
}

it.each(['ready', 'recoveryRequired'] as const)('rejects adding a name held by a %s entry without changing bytes', (state) => {
  const original = registry([entry(1, 'Other'), entry(2, 'Example  Oy', state)]);
  const before = serializeWorkspaceRegistry(original);
  expectConflict(() => appendReadyWorkspaceEntry(original, entry(3, 'example\u00a0Oy')));
  expect(Buffer.from(serializeWorkspaceRegistry(original)).equals(before)).toBe(true);
});

it('excludes only the renamed workspace and preserves its identity', () => {
  const original = registry([entry(1, 'Example'), entry(2, 'Other')]);
  const renamed = renameWorkspaceLabel(original, original.workspaces[0]!.workspaceId, 'EXAMPLE');
  expect(renamed.workspaces[0]).toEqual({ ...original.workspaces[0], workspaceLabel: 'EXAMPLE' });
  expect(renamed.activeWorkspaceId).toBe(original.activeWorkspaceId);
  expect(renamed.workspaces[1]).toBe(original.workspaces[1]);
  expectConflict(() => renameWorkspaceLabel(original, original.workspaces[0]!.workspaceId, 'other'));
});

it('reads historical duplicates, permits exact no-op and leaves original bytes unchanged', () => {
  const original = registry([entry(1, 'Example  Oy'), entry(2, 'EXAMPLE OY', 'recoveryRequired'), entry(3, 'Distinct')]);
  const bytes = serializeWorkspaceRegistry(original);
  const parsed = parseWorkspaceRegistryBytes(bytes);
  expect([...findDuplicateWorkspaceLabelIds(parsed.workspaces)]).toEqual([entry(1, '').workspaceId, entry(2, '').workspaceId]);
  expect(renameWorkspaceLabel(parsed, parsed.workspaces[0]!.workspaceId, 'Example  Oy')).toBe(parsed);
  expectConflict(() => renameWorkspaceLabel(parsed, parsed.workspaces[0]!.workspaceId, 'example oy'));
  expect(Buffer.from(serializeWorkspaceRegistry(parsed)).equals(bytes)).toBe(true);
  const renamed = renameWorkspaceLabel(parsed, parsed.workspaces[0]!.workspaceId, 'Different');
  expect(findDuplicateWorkspaceLabelIds(renamed.workspaces).size).toBe(0);
});

it('limits recovered publication to the identity-preserving append and keeps new publication strict', () => {
  const original = registry([entry(1, 'Example Oy')]);
  const before = serializeWorkspaceRegistry(original);
  const recovered = entry(2, 'EXAMPLE  OY');
  expect(appendRecoveredWorkspaceEntry(original, recovered)).toEqual({
    ...original, workspaces: [...original.workspaces, recovered],
  });
  expectConflict(() => appendReadyWorkspaceEntry(original, recovered));
  expect(Buffer.from(serializeWorkspaceRegistry(original)).equals(before)).toBe(true);
});

it.each(['workspaceIdExists', 'lineageExists', 'capacityExceeded'] as const)(
  'retains the %s guard during recovered publication', (failure) => {
    const original = registry(failure === 'capacityExceeded'
      ? Array.from({ length: WORKSPACE_REGISTRY_MAX_ENTRIES }, (_, index) => entry(index + 1, 'Same name'))
      : [entry(1, 'Same name')]);
    const next = { ...entry(WORKSPACE_REGISTRY_MAX_ENTRIES + 1, 'SAME NAME'),
      ...(failure === 'workspaceIdExists' ? { workspaceId: original.workspaces[0]!.workspaceId } : {}),
      ...(failure === 'lineageExists' ? { lineageIdentity: original.workspaces[0]!.lineageIdentity } : {}),
    };
    const before = serializeWorkspaceRegistry(original);
    expect(() => appendRecoveredWorkspaceEntry(original, next)).toThrow(WorkspaceRegistryMutationError);
    try { appendRecoveredWorkspaceEntry(original, next); } catch (error) {
      expect((error as WorkspaceRegistryMutationError).failure).toBe(failure);
    }
    expect(Buffer.from(serializeWorkspaceRegistry(original)).equals(before)).toBe(true);
  },
);

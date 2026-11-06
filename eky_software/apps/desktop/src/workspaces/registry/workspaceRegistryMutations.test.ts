import { describe, expect, it } from 'vitest';

import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from './workspaceRegistryTypes.js';
import {
  appendReadyWorkspaceEntry,
  assertActiveWorkspaceUnchanged,
  assertWorkspaceLineageAvailable,
  createReadyWorkspaceEntry,
  findWorkspaceEntry,
  readWorkspaceRegistry,
  removeWorkspaceEntry,
  selectActiveWorkspace,
  selectSourceAndRequireTargetRecovery,
  WorkspaceRegistryMutationError,
} from './workspaceRegistryMutations.js';
import { WORKSPACE_REGISTRY_MAX_ENTRIES } from './workspaceRegistryValidation.js';

const firstWorkspaceId =
  '11111111-1111-4111-8111-111111111111' as WorkspaceId;
const secondWorkspaceId =
  '22222222-2222-4222-8222-222222222222' as WorkspaceId;

describe('workspace registry mutations', () => {
  it.each([firstWorkspaceId, secondWorkspaceId, null])('removes only the selected entry and preserves the %s active pointer', activeWorkspaceId => {
    const first = createEntry(firstWorkspaceId, 'a'.repeat(64));
    const second = createEntry(secondWorkspaceId, 'b'.repeat(64));
    const before = Object.freeze({ formatVersion: 2 as const, activeWorkspaceId,
      workspaces: Object.freeze([first, second]) });
    const after = removeWorkspaceEntry({ registry: before, expectedActiveWorkspaceId: activeWorkspaceId,
      targetWorkspaceId: firstWorkspaceId });
    expect(after).toEqual({ formatVersion: 2, activeWorkspaceId: activeWorkspaceId === firstWorkspaceId ? null : activeWorkspaceId,
      workspaces: [second] });
    expect(after.workspaces[0]).toBe(second);
    expect(before.workspaces).toEqual([first, second]);
    expect(Object.isFrozen(after)).toBe(true);
    expect(Object.isFrozen(after.workspaces)).toBe(true);
  });

  it.each(['ready', 'recoveryRequired'] as const)('removes the last %s entry without selecting or creating another company', lifecycleState => {
    const first = Object.freeze({ ...createEntry(firstWorkspaceId, 'a'.repeat(64)), lifecycleState });
    const before = Object.freeze({ formatVersion: 2 as const, activeWorkspaceId: null, workspaces: Object.freeze([first]) });
    expect(removeWorkspaceEntry({ registry: before, expectedActiveWorkspaceId: null, targetWorkspaceId: firstWorkspaceId }))
      .toEqual({ formatVersion: 2, activeWorkspaceId: null, workspaces: [] });
    expect(before.workspaces).toEqual([first]);
  });

  it('rejects v1, a changed active pointer and a missing deletion target', () => {
    const first = createEntry(firstWorkspaceId, 'a'.repeat(64));
    const v1 = createRegistry(firstWorkspaceId, [first]);
    expect(() => removeWorkspaceEntry({ registry: v1, expectedActiveWorkspaceId: firstWorkspaceId, targetWorkspaceId: firstWorkspaceId }))
      .toThrow('WORKSPACE_REGISTRY_INVALID');
    const v2 = { ...v1, formatVersion: 2 as const };
    expectMutationFailure(() => removeWorkspaceEntry({ registry: v2, expectedActiveWorkspaceId: null,
      targetWorkspaceId: firstWorkspaceId }), 'activeWorkspaceChanged');
    expectMutationFailure(() => removeWorkspaceEntry({ registry: v2, expectedActiveWorkspaceId: firstWorkspaceId,
      targetWorkspaceId: secondWorkspaceId }), 'workspaceNotFound');
  });

  it('creates an empty registry and makes its first ready entry active', () => {
    const empty = readWorkspaceRegistry(undefined);
    const entry = createEntry(firstWorkspaceId, 'a'.repeat(64));
    const published = appendReadyWorkspaceEntry(empty, entry);

    expect(published.activeWorkspaceId).toBe(firstWorkspaceId);
    expect(published.workspaces).toEqual([entry]);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.workspaces)).toBe(true);
  });

  it('preserves an existing active workspace when adding another entry', () => {
    const first = createEntry(firstWorkspaceId, 'a'.repeat(64));
    const registry = createRegistry(firstWorkspaceId, [first]);
    const second = createEntry(secondWorkspaceId, 'b'.repeat(64));

    const published = appendReadyWorkspaceEntry(registry, second);

    expect(published.activeWorkspaceId).toBe(firstWorkspaceId);
    expect(published.workspaces).toEqual([first, second]);
  });

  it('rejects duplicate workspace and lineage identities', () => {
    const first = createEntry(firstWorkspaceId, 'a'.repeat(64));
    const registry = createRegistry(firstWorkspaceId, [first]);

    expectMutationFailure(
      () => appendReadyWorkspaceEntry(
        registry,
        createEntry(firstWorkspaceId, 'b'.repeat(64)),
      ),
      'workspaceIdExists',
    );
    expectMutationFailure(
      () => assertWorkspaceLineageAvailable(
        registry,
        { formatVersion: 1, profileId: 'a'.repeat(64) },
      ),
      'lineageExists',
    );
  });

  it('rejects capacity overflow without replacing the active pointer', () => {
    const workspaces = Array.from(
      { length: WORKSPACE_REGISTRY_MAX_ENTRIES },
      (_, index) => createEntry(
        `${index.toString(16).padStart(8, '0')}-1111-4111-8111-${index
          .toString(16)
          .padStart(12, '0')}` as WorkspaceId,
        index.toString(16).padStart(64, '0'),
      ),
    );
    const registry = createRegistry(workspaces[0]!.workspaceId, workspaces);

    expectMutationFailure(
      () => appendReadyWorkspaceEntry(
        registry,
        createEntry(secondWorkspaceId, 'f'.repeat(64)),
      ),
      'capacityExceeded',
    );
    expect(registry.activeWorkspaceId).toBe(workspaces[0]!.workspaceId);
  });

  it('finds entries and detects an unexpected active pointer change', () => {
    const first = createEntry(firstWorkspaceId, 'a'.repeat(64));
    const registry = createRegistry(firstWorkspaceId, [first]);

    expect(findWorkspaceEntry(registry, firstWorkspaceId)).toBe(first);
    expect(findWorkspaceEntry(registry, secondWorkspaceId)).toBeUndefined();
    expect(() =>
      assertActiveWorkspaceUnchanged(registry, firstWorkspaceId),
    ).not.toThrow();
    expectMutationFailure(
      () => assertActiveWorkspaceUnchanged(registry, secondWorkspaceId),
      'activeWorkspaceChanged',
    );
  });

  it('selects only an existing ready workspace from the expected active workspace', () => {
    const first = createEntry(firstWorkspaceId, 'a'.repeat(64));
    const second = createEntry(secondWorkspaceId, 'b'.repeat(64));
    const registry = createRegistry(firstWorkspaceId, [first, second]);

    expect(
      selectActiveWorkspace(registry, firstWorkspaceId, secondWorkspaceId),
    ).toEqual({
      ...registry,
      activeWorkspaceId: secondWorkspaceId,
    });
  });

  it('rejects stale, missing and recovery-required active workspace changes', () => {
    const first = createEntry(firstWorkspaceId, 'a'.repeat(64));
    const second = createEntry(secondWorkspaceId, 'b'.repeat(64));
    const recoveryRequired = Object.freeze({
      ...second,
      lifecycleState: 'recoveryRequired' as const,
    });

    expectMutationFailure(
      () =>
        selectActiveWorkspace(
          createRegistry(firstWorkspaceId, [first, second]),
          secondWorkspaceId,
          firstWorkspaceId,
        ),
      'activeWorkspaceChanged',
    );
    expectMutationFailure(
      () =>
        selectActiveWorkspace(
          createRegistry(firstWorkspaceId, [first]),
          firstWorkspaceId,
          secondWorkspaceId,
        ),
      'workspaceNotFound',
    );
    expectMutationFailure(
      () =>
        selectActiveWorkspace(
          createRegistry(firstWorkspaceId, [first, recoveryRequired]),
          firstWorkspaceId,
          secondWorkspaceId,
        ),
      'workspaceNotReady',
    );
  });

  it('restores the source pointer while isolating an invalid target', () => {
    const source = createEntry(firstWorkspaceId, 'a'.repeat(64));
    const target = createEntry(secondWorkspaceId, 'b'.repeat(64));

    const recovered = selectSourceAndRequireTargetRecovery({
      registry: createRegistry(secondWorkspaceId, [source, target]),
      sourceWorkspaceId: firstWorkspaceId,
      targetWorkspaceId: secondWorkspaceId,
    });

    expect(recovered.activeWorkspaceId).toBe(firstWorkspaceId);
    expect(recovered.workspaces).toEqual([
      source,
      { ...target, lifecycleState: 'recoveryRequired' },
    ]);
    expect(Object.isFrozen(recovered.workspaces)).toBe(true);
  });

  it('rejects stale and non-ready invalid-target recovery inputs', () => {
    const source = createEntry(firstWorkspaceId, 'a'.repeat(64));
    const target = createEntry(secondWorkspaceId, 'b'.repeat(64));

    expectMutationFailure(
      () => selectSourceAndRequireTargetRecovery({
        registry: createRegistry(firstWorkspaceId, [source, target]),
        sourceWorkspaceId: firstWorkspaceId,
        targetWorkspaceId: secondWorkspaceId,
      }),
      'activeWorkspaceChanged',
    );
    expectMutationFailure(
      () => selectSourceAndRequireTargetRecovery({
        registry: createRegistry(secondWorkspaceId, [
          source,
          { ...target, lifecycleState: 'recoveryRequired' },
        ]),
        sourceWorkspaceId: firstWorkspaceId,
        targetWorkspaceId: secondWorkspaceId,
      }),
      'workspaceNotReady',
    );
  });
});

function createEntry(
  workspaceId: WorkspaceId,
  profileId: string,
): Readonly<LocalWorkspaceRegistryEntryV1> {
  return createReadyWorkspaceEntry({
    workspaceId,
    workspaceLabel: `Yritys ${workspaceId}`,
    lineageIdentity: { formatVersion: 1, profileId },
    createdAt: '2026-08-18T10:00:00.000Z',
  });
}

function createRegistry(
  activeWorkspaceId: WorkspaceId,
  workspaces: readonly Readonly<LocalWorkspaceRegistryEntryV1>[],
): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId,
    workspaces: Object.freeze([...workspaces]),
  });
}

function expectMutationFailure(
  operation: () => unknown,
  failure: WorkspaceRegistryMutationError['failure'],
): void {
  try {
    operation();
    throw new Error('Expected workspace registry mutation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceRegistryMutationError);
    expect((error as WorkspaceRegistryMutationError).failure).toBe(failure);
    expect((error as Error).message).toBe(
      'WORKSPACE_REGISTRY_MUTATION_REJECTED',
    );
  }
}

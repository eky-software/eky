import { describe, expect, it } from 'vitest';

import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { WorkspaceFirstStartMigrationTransitionError } from './workspaceFirstStartMigrationJournalError.js';
import {
  calculateWorkspaceRegistrySha256,
  markPassiveWorkspacesRecoveryRequired,
  restoreJournaledPassiveWorkspacesReady,
} from './workspaceFirstStartMigrationRegistryTransitions.js';

const activeWorkspaceId = workspaceId('1');
const passiveWorkspaceId = workspaceId('2');
const anotherPassiveWorkspaceId = workspaceId('3');

describe('workspace first-start registry transitions', () => {
  it('marks one or many exact passive ready workspaces without changing other fields', () => {
    const source = registry();
    const transitioned = markPassiveWorkspacesRecoveryRequired(
      source,
      activeWorkspaceId,
      [passiveWorkspaceId, anotherPassiveWorkspaceId],
    );

    expect(transitioned.activeWorkspaceId).toBe(source.activeWorkspaceId);
    expect(transitioned.workspaces).toEqual([
      entry(activeWorkspaceId),
      entry(passiveWorkspaceId, 'recoveryRequired'),
      entry(anotherPassiveWorkspaceId, 'recoveryRequired'),
    ]);
    expect(transitioned.workspaces[0]).toEqual(source.workspaces[0]);
    expect(source.workspaces.every((item) => item.lifecycleState === 'ready'))
      .toBe(true);
  });

  it('returns the identical registry for an empty transition', () => {
    const source = registry();

    expect(
      markPassiveWorkspacesRecoveryRequired(
        source,
        activeWorkspaceId,
        [],
      ),
    ).toBe(source);
  });

  it.each([
    ['active target', [activeWorkspaceId]],
    ['unknown target', [workspaceId('4')]],
    ['duplicate target', [passiveWorkspaceId, passiveWorkspaceId]],
    [
      'unsorted targets',
      [anotherPassiveWorkspaceId, passiveWorkspaceId],
    ],
  ])('rejects %s', (_name, ids) => {
    expect(() =>
      markPassiveWorkspacesRecoveryRequired(
        registry(),
        activeWorkspaceId,
        ids,
      ),
    ).toThrow(WorkspaceFirstStartMigrationTransitionError);
  });

  it('rejects a target that was already recovery-required', () => {
    expect(() =>
      markPassiveWorkspacesRecoveryRequired(
        registry({ passiveLifecycle: 'recoveryRequired' }),
        activeWorkspaceId,
        [passiveWorkspaceId],
      ),
    ).toThrow(WorkspaceFirstStartMigrationTransitionError);
  });

  it('restores only journaled ids and proves exact source and transition hashes', () => {
    const source = registry();
    const transitioned = markPassiveWorkspacesRecoveryRequired(
      source,
      activeWorkspaceId,
      [passiveWorkspaceId, anotherPassiveWorkspaceId],
    );

    const restored = restoreJournaledPassiveWorkspacesReady({
      registry: transitioned,
      expectedActiveWorkspaceId: activeWorkspaceId,
      passiveRecoveryWorkspaceIds: [
        passiveWorkspaceId,
        anotherPassiveWorkspaceId,
      ],
      sourceRegistrySha256: calculateWorkspaceRegistrySha256(source),
      transitionedRegistrySha256:
        calculateWorkspaceRegistrySha256(transitioned),
    });

    expect(restored).toEqual(source);
    expect(calculateWorkspaceRegistrySha256(restored)).toBe(
      calculateWorkspaceRegistrySha256(source),
    );
  });

  it.each([
    {
      name: 'unrelated rename',
      mutate: (value: LocalWorkspaceRegistryV1) => ({
        ...value,
        workspaces: value.workspaces.map((item) =>
          item.workspaceId === anotherPassiveWorkspaceId
            ? { ...item, workspaceLabel: 'Changed label' }
            : item,
        ),
      }),
    },
    {
      name: 'active pointer change',
      mutate: (value: LocalWorkspaceRegistryV1) => ({
        ...value,
        activeWorkspaceId: anotherPassiveWorkspaceId,
        workspaces: value.workspaces.map((item) =>
          item.workspaceId === anotherPassiveWorkspaceId
            ? { ...item, lifecycleState: 'ready' as const }
            : item,
        ),
      }),
    },
  ])('fails closed after $name', ({ mutate }) => {
    const source = registry();
    const transitioned = markPassiveWorkspacesRecoveryRequired(
      source,
      activeWorkspaceId,
      [passiveWorkspaceId],
    );
    const changed = mutate(transitioned as LocalWorkspaceRegistryV1);

    expect(() =>
      restoreJournaledPassiveWorkspacesReady({
        registry: changed,
        expectedActiveWorkspaceId: activeWorkspaceId,
        passiveRecoveryWorkspaceIds: [passiveWorkspaceId],
        sourceRegistrySha256: calculateWorkspaceRegistrySha256(source),
        transitionedRegistrySha256:
          calculateWorkspaceRegistrySha256(transitioned),
      }),
    ).toThrow(WorkspaceFirstStartMigrationTransitionError);
  });
});

function registry(options: {
  passiveLifecycle?: 'ready' | 'recoveryRequired';
} = {}): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId,
    workspaces: Object.freeze([
      entry(activeWorkspaceId),
      entry(passiveWorkspaceId, options.passiveLifecycle),
      entry(anotherPassiveWorkspaceId),
    ]),
  });
}

function entry(
  id: WorkspaceId,
  lifecycleState: 'ready' | 'recoveryRequired' = 'ready',
): Readonly<LocalWorkspaceRegistryEntryV1> {
  return Object.freeze({
    workspaceId: id,
    workspaceLabel: `Workspace ${id.slice(0, 1)}`,
    lineageIdentity: Object.freeze({
      formatVersion: 1,
      profileId: id.slice(0, 1).repeat(64),
    }),
    layoutVersion: 1,
    lifecycleState,
    createdAt: '2026-08-21T00:00:00.000Z',
  });
}

function workspaceId(value: string): WorkspaceId {
  return validateWorkspaceId(
    `${value.repeat(8)}-${value.repeat(4)}-4${value.repeat(3)}-8${
      value.repeat(3)
    }-${value.repeat(12)}`,
  );
}

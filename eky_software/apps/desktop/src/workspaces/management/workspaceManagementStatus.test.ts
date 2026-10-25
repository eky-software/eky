import { describe, expect, it } from 'vitest';

import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import {
  createWorkspaceManagementStatus,
  parseWorkspaceManagementStatus,
} from './workspaceManagementStatus.js';

const activeId = '00000000-0000-4000-8000-000000000001' as WorkspaceId;
const inactiveId = '00000000-0000-4000-8000-000000000002' as WorkspaceId;

describe('workspace management status', () => {
  it('creates a bounded safe projection without registry-only data', () => {
    const status = createWorkspaceManagementStatus({
      maintenanceState: 'idle',
      operationRecoveryRequired: false,
      registry: createRegistry(),
    });

    expect(status).toEqual({
      activeWorkspaceId: activeId,
      formatVersion: 1,
      operationState: 'idle',
      workspaces: [
        {
          availability: 'ready',
          isActive: true,
          workspaceId: activeId,
          workspaceLabel: 'Yritys A',
        },
        {
          availability: 'recoveryRequired',
          isActive: false,
          workspaceId: inactiveId,
          workspaceLabel: 'Yritys B',
        },
      ],
    });
    expect(JSON.stringify(status)).not.toMatch(
      /companyId|profileId|lineage|createdAt|session|journal|operationId|path/i,
    );
    expect(Object.isFrozen(status)).toBe(true);
    expect(Object.isFrozen(status.workspaces)).toBe(true);
  });

  it('uses recoveryRequired ahead of the transient maintenance state', () => {
    expect(
      createWorkspaceManagementStatus({
        maintenanceState: 'busy',
        operationRecoveryRequired: true,
        registry: createRegistry(),
      }).operationState,
    ).toBe('recoveryRequired');
  });

  it('projects historical name conflicts across ready and recovery entries without changing labels', () => {
    const original = createRegistry();
    const labels = ['Yritys  A', 'yritys\u00a0a'];
    const registry = {
      ...original,
      workspaces: original.workspaces.map((entry, index) => ({
        ...entry,
        workspaceLabel: labels[index]!,
      })),
    };
    const before = JSON.stringify(registry);
    const status = createWorkspaceManagementStatus({
      maintenanceState: 'idle',
      operationRecoveryRequired: false,
      registry,
    });

    expect(status.duplicateWorkspaceLabelIds).toEqual([activeId, inactiveId]);
    expect(Object.isFrozen(status.duplicateWorkspaceLabelIds)).toBe(true);
    expect(status.workspaces.map((entry) => entry.workspaceLabel)).toEqual(labels);
    expect(status.workspaces.map((entry) => entry.availability)).toEqual([
      'ready', 'recoveryRequired',
    ]);
    expect(status.operationState).toBe('idle');
    expect(JSON.stringify(registry)).toBe(before);
  });

  it('keeps a historical status without duplicate metadata readable', () => {
    const value = createStatusInput();
    (value.workspaces as Record<string, unknown>[])[1]!.workspaceLabel = 'Yritys A';
    const status = parseWorkspaceManagementStatus(value);

    expect(status.workspaces).toHaveLength(2);
    expect(Object.hasOwn(status, 'duplicateWorkspaceLabelIds')).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['not an array', activeId],
    ['empty list', []],
    ['single entry', [activeId]],
    ['duplicate id', [activeId, activeId]],
    ['unknown id', [activeId, workspaceId(3)]],
    ['invalid id', [activeId, 'invalid']],
    ['sparse list', new Array(2)],
    ['over budget', new Array(65).fill(activeId)],
  ])('rejects duplicate metadata: %s', (_name, duplicateWorkspaceLabelIds) => {
    expectInvalid(() => parseWorkspaceManagementStatus({
      ...createStatusInput(), duplicateWorkspaceLabelIds,
    }));
  });

  it('accepts all 64 referenced ids and does not keep a mutable caller array', () => {
    const ids = Array.from({ length: 64 }, (_, index) => workspaceId(index + 1));
    const status = parseWorkspaceManagementStatus({
      activeWorkspaceId: ids[0],
      duplicateWorkspaceLabelIds: ids,
      formatVersion: 1,
      operationState: 'idle',
      workspaces: ids.map((id, index) => ({
        availability: 'ready',
        isActive: index === 0,
        workspaceId: id,
        workspaceLabel: 'Sama nimi',
      })),
    });
    expect(status.duplicateWorkspaceLabelIds).toEqual(ids);
    ids.pop();
    expect(status.duplicateWorkspaceLabelIds).toHaveLength(64);
  });

  it('accepts exactly 64 valid entries', () => {
    const workspaces = Array.from({ length: 64 }, (_, index) => ({
      availability: 'ready',
      isActive: index === 0,
      workspaceId: workspaceId(index + 1),
      workspaceLabel: `Workspace ${index + 1}`,
    }));
    expect(
      parseWorkspaceManagementStatus({
        activeWorkspaceId: workspaces[0]!.workspaceId,
        formatVersion: 1,
        operationState: 'busy',
        workspaces,
      }).workspaces,
    ).toHaveLength(64);
  });

  it.each([
    {
      name: 'unknown top-level key',
      mutate: (value: Record<string, unknown>) => {
        value.companyId = 'must-not-leak';
      },
    },
    {
      name: 'unknown entry key',
      mutate: (value: Record<string, unknown>) => {
        (value.workspaces as Record<string, unknown>[])[0]!.path = 'C:/secret';
      },
    },
    {
      name: 'duplicate workspace id',
      mutate: (value: Record<string, unknown>) => {
        (value.workspaces as Record<string, unknown>[])[1]!.workspaceId =
          activeId;
      },
    },
    {
      name: 'active recovery workspace',
      mutate: (value: Record<string, unknown>) => {
        (value.workspaces as Record<string, unknown>[])[0]!.availability =
          'recoveryRequired';
      },
    },
    {
      name: 'active pointer mismatch',
      mutate: (value: Record<string, unknown>) => {
        value.activeWorkspaceId = inactiveId;
      },
    },
  ])('rejects $name', ({ mutate }) => {
    const value = createStatusInput();
    mutate(value);
    expectInvalid(() => parseWorkspaceManagementStatus(value));
  });

  it('rejects more than 64 workspaces, null entries and custom prototypes', () => {
    const tooMany = createStatusInput();
    tooMany.workspaces = Array.from({ length: 65 }, (_, index) => ({
      availability: 'ready',
      isActive: index === 0,
      workspaceId: workspaceId(index + 1),
      workspaceLabel: `Workspace ${index + 1}`,
    }));
    tooMany.activeWorkspaceId = workspaceId(1);
    expectInvalid(() => parseWorkspaceManagementStatus(tooMany));

    const withNull = createStatusInput();
    withNull.workspaces = [null];
    expectInvalid(() => parseWorkspaceManagementStatus(withNull));

    const customPrototype = Object.create({ leaked: true }) as Record<
      string,
      unknown
    >;
    Object.assign(customPrototype, createStatusInput());
    expectInvalid(() => parseWorkspaceManagementStatus(customPrototype));
  });
});

function createRegistry(): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    activeWorkspaceId: activeId,
    formatVersion: 1,
    workspaces: Object.freeze([
      Object.freeze({
        createdAt: '2026-08-19T00:00:00.000Z',
        layoutVersion: 1 as const,
        lifecycleState: 'ready' as const,
        lineageIdentity: Object.freeze({
          formatVersion: 1 as const,
          profileId: 'profile-a',
        }),
        workspaceId: activeId,
        workspaceLabel: 'Yritys A',
      }),
      Object.freeze({
        createdAt: '2026-08-19T00:00:01.000Z',
        layoutVersion: 1 as const,
        lifecycleState: 'recoveryRequired' as const,
        lineageIdentity: Object.freeze({
          formatVersion: 1 as const,
          profileId: 'profile-b',
        }),
        workspaceId: inactiveId,
        workspaceLabel: 'Yritys B',
      }),
    ]),
  });
}

function createStatusInput(): Record<string, unknown> {
  return {
    activeWorkspaceId: activeId,
    formatVersion: 1,
    operationState: 'idle',
    workspaces: [
      {
        availability: 'ready',
        isActive: true,
        workspaceId: activeId,
        workspaceLabel: 'Yritys A',
      },
      {
        availability: 'recoveryRequired',
        isActive: false,
        workspaceId: inactiveId,
        workspaceLabel: 'Yritys B',
      },
    ],
  };
}

function workspaceId(index: number): WorkspaceId {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` as WorkspaceId;
}

function expectInvalid(operation: () => unknown): void {
  expect(operation).toThrowError(
    expect.objectContaining<Partial<WorkspaceManagementError>>({
      code: 'WORKSPACE_MANAGEMENT_INVALID',
    }),
  );
}

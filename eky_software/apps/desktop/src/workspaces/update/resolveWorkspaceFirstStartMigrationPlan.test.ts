import { describe, expect, it } from 'vitest';

import type { PreWorkspaceBuildAdmission } from '../../update/preWorkspaceBuildAdmission.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { resolveWorkspaceFirstStartMigrationPlan } from './resolveWorkspaceFirstStartMigrationPlan.js';
import {
  WorkspaceFirstStartMigrationPlanError,
  workspaceFirstStartMigrationPlanInvalidCode,
} from './workspaceFirstStartMigrationPlanError.js';
import type {
  WorkspaceFirstStartBuildIdentity,
  WorkspaceFirstStartMigrationPlanInput,
} from './workspaceFirstStartMigrationPlanTypes.js';
import type {
  WorkspaceMigrationInventory,
  WorkspaceMigrationInventoryEntry,
  WorkspaceMigrationInventoryStatus,
} from './workspaceMigrationInventoryTypes.js';

const activeWorkspaceId = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
const passiveWorkspaceId = validateWorkspaceId(
  '22222222-2222-4222-8222-222222222222',
);
const anotherPassiveWorkspaceId = validateWorkspaceId(
  '33333333-3333-4333-8333-333333333333',
);
const recoveryWorkspaceId = validateWorkspaceId(
  '44444444-4444-4444-8444-444444444444',
);
const sourceBuild = build('0.2.6', 'a'.repeat(40));
const targetBuild = build('0.2.7', 'b'.repeat(40));

describe('resolveWorkspaceFirstStartMigrationPlan', () => {
  it.each<{
    admission: PreWorkspaceBuildAdmission;
    sourceBuild: Readonly<WorkspaceFirstStartBuildIdentity> | null;
    targetBuild: Readonly<WorkspaceFirstStartBuildIdentity>;
  }>([
    {
      admission: 'development',
      sourceBuild: null,
      targetBuild: build('0.2.6', 'development'),
    },
    {
      admission: 'initialInstall',
      sourceBuild: null,
      targetBuild,
    },
    {
      admission: 'exactAcceptedBuild',
      sourceBuild,
      targetBuild: sourceBuild,
    },
  ])(
    'returns an empty frozen plan for $admission without requesting inventory',
    ({ admission, sourceBuild: admittedSource, targetBuild: admittedTarget }) => {
      const plan = resolveWorkspaceFirstStartMigrationPlan({
        admission,
        registry: registry(),
        sourceBuild: admittedSource,
        targetBuild: admittedTarget,
      });

      expect(plan).toEqual({
        activeWorkspace: null,
        kind: 'notRequired',
        passiveRecoveryWorkspaceIds: [],
      });
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.passiveRecoveryWorkspaceIds)).toBe(true);
    },
  );

  it('returns notRequired for a current active workspace and leaves passive compatible prefixes ready', () => {
    const plan = resolveWorkspaceFirstStartMigrationPlan(
      updateInput(
        inventory([
          entry(activeWorkspaceId, 'current', true, 40, 0),
          entry(passiveWorkspaceId, 'compatiblePending', false, 38, 2),
          entry(anotherPassiveWorkspaceId, 'current', false, 40, 0),
        ]),
      ),
    );

    expect(plan).toEqual({
      activeWorkspace: {
        appliedMigrationCount: 40,
        pendingMigrationCount: 0,
        status: 'current',
        workspaceId: activeWorkspaceId,
      },
      kind: 'notRequired',
      passiveRecoveryWorkspaceIds: [],
    });
  });

  it('requires first-start work for a compatible active workspace without mutating the input', () => {
    const input = updateInput(
      inventory([
        entry(activeWorkspaceId, 'compatiblePending', true, 38, 2),
        entry(passiveWorkspaceId, 'current', false, 40, 0),
        entry(anotherPassiveWorkspaceId, 'current', false, 40, 0),
      ]),
    );
    const registryBefore = JSON.stringify(input.registry);
    const inventoryBefore = JSON.stringify(input.inventory);

    const plan = resolveWorkspaceFirstStartMigrationPlan(input);

    expect(plan.kind).toBe('required');
    expect(plan.activeWorkspace).toMatchObject({
      status: 'compatiblePending',
      workspaceId: activeWorkspaceId,
    });
    expect(JSON.stringify(input.registry)).toBe(registryBefore);
    expect(JSON.stringify(input.inventory)).toBe(inventoryBefore);
  });

  it('sorts only passive invalid-history targets into the recovery transition', () => {
    const plan = resolveWorkspaceFirstStartMigrationPlan(
      updateInput(
        inventory([
          entry(activeWorkspaceId, 'current', true, 40, 0),
          entry(anotherPassiveWorkspaceId, 'invalidHistory', false, 0, 0),
          entry(passiveWorkspaceId, 'invalidHistory', false, 0, 0),
        ]),
      ),
    );

    expect(plan.kind).toBe('required');
    expect(plan.passiveRecoveryWorkspaceIds).toEqual([
      passiveWorkspaceId,
      anotherPassiveWorkspaceId,
    ]);
    expect(Object.isFrozen(plan.activeWorkspace)).toBe(true);
    expect(Object.isFrozen(plan.passiveRecoveryWorkspaceIds)).toBe(true);
  });

  it('returns an empty plan when the registry has no ready workspace', () => {
    const plan = resolveWorkspaceFirstStartMigrationPlan(
      updateInput(
        { activeWorkspaceId: null, entries: [] },
        registry({ noReadyWorkspaces: true }),
      ),
    );

    expect(plan).toEqual({
      activeWorkspace: null,
      kind: 'notRequired',
      passiveRecoveryWorkspaceIds: [],
    });
  });

  it('is deterministic when inventory entry order changes', () => {
    const first = resolveWorkspaceFirstStartMigrationPlan(
      updateInput(
        inventory([
          entry(activeWorkspaceId, 'current', true, 40, 0),
          entry(passiveWorkspaceId, 'invalidHistory', false, 0, 0),
          entry(anotherPassiveWorkspaceId, 'invalidHistory', false, 0, 0),
        ]),
      ),
    );
    const second = resolveWorkspaceFirstStartMigrationPlan(
      updateInput(
        inventory([
          entry(anotherPassiveWorkspaceId, 'invalidHistory', false, 0, 0),
          entry(activeWorkspaceId, 'current', true, 40, 0),
          entry(passiveWorkspaceId, 'invalidHistory', false, 0, 0),
        ]),
      ),
    );

    expect(second).toEqual(first);
  });

  it.each([
    {
      name: 'active invalid history',
      inventory: inventory([
        entry(activeWorkspaceId, 'invalidHistory', true, 0, 0),
        entry(passiveWorkspaceId, 'current', false, 40, 0),
        entry(anotherPassiveWorkspaceId, 'current', false, 40, 0),
      ]),
    },
    {
      name: 'missing ready workspace',
      inventory: inventory([
        entry(activeWorkspaceId, 'current', true, 40, 0),
        entry(passiveWorkspaceId, 'current', false, 40, 0),
      ]),
    },
    {
      name: 'duplicate ready workspace',
      inventory: inventory([
        entry(activeWorkspaceId, 'current', true, 40, 0),
        entry(passiveWorkspaceId, 'current', false, 40, 0),
        entry(passiveWorkspaceId, 'current', false, 40, 0),
      ]),
    },
    {
      name: 'wrong active flag',
      inventory: inventory([
        entry(activeWorkspaceId, 'current', false, 40, 0),
        entry(passiveWorkspaceId, 'current', true, 40, 0),
        entry(anotherPassiveWorkspaceId, 'current', false, 40, 0),
      ]),
    },
    {
      name: 'recovery-required workspace included',
      inventory: {
        activeWorkspaceId,
        entries: [
          entry(activeWorkspaceId, 'current', true, 40, 0),
          entry(passiveWorkspaceId, 'current', false, 40, 0),
          entry(anotherPassiveWorkspaceId, 'current', false, 40, 0),
          entry(recoveryWorkspaceId, 'current', false, 40, 0),
        ],
      },
    },
  ])('rejects $name without returning a partial plan', ({ inventory }) => {
    expectInvalid(() =>
      resolveWorkspaceFirstStartMigrationPlan(updateInput(inventory)),
    );
  });

  it.each([
    {
      name: 'inventory on a non-update admission',
      input: {
        admission: 'initialInstall',
        inventory: inventory(),
        registry: registry(),
        sourceBuild: null,
        targetBuild,
      },
    },
    {
      name: 'missing source build on an update admission',
      input: {
        ...updateInput(inventory()),
        sourceBuild: null,
      },
    },
    {
      name: 'non-increasing target version',
      input: {
        ...updateInput(inventory()),
        targetBuild: sourceBuild,
      },
    },
    {
      name: 'source build on initial install',
      input: {
        admission: 'initialInstall',
        registry: registry(),
        sourceBuild,
        targetBuild,
      },
    },
    {
      name: 'development revision on a packaged update',
      input: {
        ...updateInput(inventory()),
        targetBuild: build('0.2.7', 'development'),
      },
    },
  ])('rejects $name', ({ input }) => {
    expectInvalid(() =>
      resolveWorkspaceFirstStartMigrationPlan(
        input as WorkspaceFirstStartMigrationPlanInput,
      ),
    );
  });

  it.each([
    {
      name: 'unknown top-level key',
      mutate: (input: Record<string, unknown>) => {
        input.unexpected = true;
      },
    },
    {
      name: 'unknown inventory key',
      mutate: (input: Record<string, unknown>) => {
        (input.inventory as Record<string, unknown>).unexpected = true;
      },
    },
    {
      name: 'unknown inventory entry key',
      mutate: (input: Record<string, unknown>) => {
        const inventoryValue = input.inventory as { entries: Record<string, unknown>[] };
        inventoryValue.entries[0]!.unexpected = true;
      },
    },
    {
      name: 'inconsistent current counts',
      mutate: (input: Record<string, unknown>) => {
        const inventoryValue = input.inventory as { entries: Record<string, unknown>[] };
        inventoryValue.entries[0]!.pendingMigrationCount = 1;
      },
    },
  ])('rejects strict shape violation: $name', ({ mutate }) => {
    const input = structuredClone(updateInput(inventory())) as unknown as Record<
      string,
      unknown
    >;
    mutate(input);
    expectInvalid(() =>
      resolveWorkspaceFirstStartMigrationPlan(
        input as unknown as WorkspaceFirstStartMigrationPlanInput,
      ),
    );
  });
});

function updateInput(
  migrationInventory: Readonly<WorkspaceMigrationInventory>,
  workspaceRegistry: Readonly<LocalWorkspaceRegistryV1> = registry(),
): WorkspaceFirstStartMigrationPlanInput {
  return {
    admission: 'authorizedNewerBuild',
    inventory: migrationInventory,
    registry: workspaceRegistry,
    sourceBuild,
    targetBuild,
  };
}

function inventory(
  entries: readonly Readonly<WorkspaceMigrationInventoryEntry>[] = [
    entry(activeWorkspaceId, 'current', true, 40, 0),
    entry(passiveWorkspaceId, 'current', false, 40, 0),
    entry(anotherPassiveWorkspaceId, 'current', false, 40, 0),
  ],
): Readonly<WorkspaceMigrationInventory> {
  return { activeWorkspaceId, entries };
}

function entry(
  workspaceId: WorkspaceId,
  status: WorkspaceMigrationInventoryStatus,
  isActive: boolean,
  appliedMigrationCount: number,
  pendingMigrationCount: number,
): Readonly<WorkspaceMigrationInventoryEntry> {
  return {
    appliedMigrationCount,
    isActive,
    pendingMigrationCount,
    status,
    workspaceId,
  };
}

function registry(
  options: { noReadyWorkspaces?: boolean } = {},
): Readonly<LocalWorkspaceRegistryV1> {
  if (options.noReadyWorkspaces) {
    return {
      activeWorkspaceId: null,
      formatVersion: 1,
      workspaces: [registryEntry(recoveryWorkspaceId, 'recoveryRequired', 'd')],
    };
  }
  return {
    activeWorkspaceId,
    formatVersion: 1,
    workspaces: [
      registryEntry(activeWorkspaceId, 'ready', 'a'),
      registryEntry(passiveWorkspaceId, 'ready', 'b'),
      registryEntry(anotherPassiveWorkspaceId, 'ready', 'c'),
      registryEntry(recoveryWorkspaceId, 'recoveryRequired', 'd'),
    ],
  };
}

function registryEntry(
  workspaceId: WorkspaceId,
  lifecycleState: 'ready' | 'recoveryRequired',
  profileCharacter: string,
): Readonly<LocalWorkspaceRegistryEntryV1> {
  return {
    createdAt: '2026-08-21T00:00:00.000Z',
    layoutVersion: 1,
    lifecycleState,
    lineageIdentity: {
      formatVersion: 1,
      profileId: profileCharacter.repeat(64),
    },
    workspaceId,
    workspaceLabel: `Workspace ${profileCharacter.toUpperCase()}`,
  };
}

function build(
  appVersion: string,
  buildRevision: string,
): Readonly<WorkspaceFirstStartBuildIdentity> {
  return { appVersion, buildRevision };
}

function expectInvalid(operation: () => unknown): void {
  expect(operation).toThrowError(
    new WorkspaceFirstStartMigrationPlanError(),
  );
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({
      errorCode: workspaceFirstStartMigrationPlanInvalidCode,
      message: workspaceFirstStartMigrationPlanInvalidCode,
    });
  }
}

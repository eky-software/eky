import { describe, expect, it, vi } from 'vitest';

import type { AcceptedBuildMetadata } from '../../update/acceptedBuildMetadata.js';
import type {
  PreBackendFirstStartFailureResult,
} from '../../update/preBackendFirstStartFailureAuthority.js';
import type { PreWorkspaceBuildAdmission } from '../../update/preWorkspaceBuildAdmission.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import { resolveWorkspaceFirstStartMigrationPlan } from './resolveWorkspaceFirstStartMigrationPlan.js';
import { validateWorkspaceFirstStartMigrationJournal } from './workspaceFirstStartMigrationJournalCodec.js';
import type { WorkspaceFirstStartMigrationJournalV1 } from './workspaceFirstStartMigrationJournalTypes.js';
import { WorkspaceFirstStartMigrationOrchestrator } from './workspaceFirstStartMigrationOrchestrator.js';
import { WorkspaceFirstStartMigrationOrchestratorError } from './workspaceFirstStartMigrationOrchestratorError.js';
import type { WorkspaceFirstStartBuildIdentity } from './workspaceFirstStartMigrationPlanTypes.js';
import { WorkspaceFirstStartMigrationTransitionCoordinator } from './workspaceFirstStartMigrationTransitionCoordinator.js';
import type {
  WorkspaceMigrationInventory,
  WorkspaceMigrationInventoryStatus,
} from './workspaceMigrationInventoryTypes.js';

const activeWorkspaceId = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
const passiveWorkspaceId = validateWorkspaceId(
  '22222222-2222-4222-8222-222222222222',
);
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceBuild = build('0.2.6', 'a'.repeat(40));
const targetBuild = build('0.2.7', 'b'.repeat(40));
const developmentBuild = build('0.2.6', 'development');

describe('WorkspaceFirstStartMigrationOrchestrator', () => {
  it.each([
    {
      admission: 'development' as const,
      acceptedBuild: undefined,
      runningBuild: developmentBuild,
    },
    {
      admission: 'initialInstall' as const,
      acceptedBuild: undefined,
      runningBuild: targetBuild,
    },
    {
      admission: 'exactAcceptedBuild' as const,
      acceptedBuild: accepted(sourceBuild),
      runningBuild: sourceBuild,
    },
  ])(
    'does not inspect workspace databases for $admission',
    async ({ acceptedBuild, admission, runningBuild }) => {
      const fixture = createFixture({
        ...(acceptedBuild === undefined ? {} : { acceptedBuild }),
        admission,
        registryMissing: true,
        runningBuild,
      });

      await expect(
        fixture.subject.recoverBeforeWorkspaceResolution(),
      ).resolves.toBe('noJournal');
      await expect(fixture.subject.prepareBeforeBackend()).resolves.toBe(
        'notRequired',
      );

      expect(fixture.inspect).not.toHaveBeenCalled();
      expect(fixture.readRegistry).not.toHaveBeenCalled();
      expect(fixture.journal.value).toBeUndefined();
    },
  );

  it('inspects an all-current update without creating a W6 journal', async () => {
    const fixture = createFixture({ inventory: inventory() });

    await fixture.subject.recoverBeforeWorkspaceResolution();
    await expect(fixture.subject.prepareBeforeBackend()).resolves.toBe(
      'notRequired',
    );

    expect(fixture.inspect).toHaveBeenCalledOnce();
    expect(fixture.journal.value).toBeUndefined();
    expect(fixture.registry.writes).toHaveLength(0);
  });

  it('keeps a passive compatible prefix byte-neutral and journal-free', async () => {
    const fixture = createFixture({
      inventory: inventory('current', 'compatiblePending'),
    });

    await fixture.subject.recoverBeforeWorkspaceResolution();
    await fixture.subject.prepareBeforeBackend();

    expect(fixture.journal.value).toBeUndefined();
    expect(fixture.registry.writes).toHaveLength(0);
  });

  it('prepares active migration work even without a passive registry transition', async () => {
    const fixture = createFixture({
      inventory: inventory('compatiblePending', 'current'),
    });

    await fixture.subject.recoverBeforeWorkspaceResolution();
    await expect(fixture.subject.prepareBeforeBackend()).resolves.toBe(
      'prepared',
    );

    expect(fixture.journal.value).toMatchObject({
      activeWorkspaceId,
      operationId,
      passiveRecoveryWorkspaceIds: [],
      state: 'prepared',
    });
  });

  it('transitions passive invalid history before target acceptance and cleans up last', async () => {
    const fixture = createFixture({
      inventory: inventory('current', 'invalidHistory'),
    });

    await fixture.subject.recoverBeforeWorkspaceResolution();
    await fixture.subject.prepareBeforeBackend();
    await fixture.subject.transitionRegistryAfterActiveWorkspaceAcceptance();
    fixture.events.push('accepted.target');
    fixture.acceptedBuild.value = accepted(targetBuild);
    await fixture.subject.completeAfterTargetAcceptance();

    expect(fixture.events).toEqual([
      'journal.prepared',
      'registry.write',
      'journal.registryTransitioned',
      'accepted.target',
      'journal.removeTransitioned',
    ]);
    expect(fixture.registry.value.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lifecycleState: 'recoveryRequired',
          workspaceId: passiveWorkspaceId,
        }),
      ]),
    );
    expect(fixture.journal.value).toBeUndefined();
  });

  it('resumes the exact prepared target operation without replacing its operation id', async () => {
    const fixture = createFixture({
      inventory: inventory('compatiblePending', 'current'),
    });
    await fixture.seedPrepared(inventory('compatiblePending', 'current'));
    fixture.events.length = 0;

    await expect(
      fixture.subject.recoverBeforeWorkspaceResolution(),
    ).resolves.toBe('resumable');
    await expect(fixture.subject.prepareBeforeBackend()).resolves.toBe(
      'resumed',
    );

    expect(fixture.journal.value?.operationId).toBe(operationId);
    expect(fixture.events).toEqual([]);
  });

  it('cancels a target prepared operation when the exact accepted source runs', async () => {
    const fixture = createFixture({
      acceptedBuild: accepted(sourceBuild),
      admission: 'exactAcceptedBuild',
      runningBuild: sourceBuild,
    });
    await fixture.seedPrepared(inventory('compatiblePending', 'current'));
    fixture.events.length = 0;

    await expect(
      fixture.subject.recoverBeforeWorkspaceResolution(),
    ).resolves.toBe('preparedCancelled');
    await expect(fixture.subject.prepareBeforeBackend()).resolves.toBe(
      'notRequired',
    );

    expect(fixture.journal.value).toBeUndefined();
    expect(fixture.inspect).not.toHaveBeenCalled();
    expect(fixture.events).toEqual(['journal.discardPrepared']);
  });

  it('fails closed before inventory for a mixed running build', async () => {
    const fixture = createFixture({
      runningBuild: build('0.2.8', 'c'.repeat(40)),
    });
    await fixture.seedPrepared(inventory('compatiblePending', 'current'));

    await expect(
      fixture.subject.recoverBeforeWorkspaceResolution(),
    ).rejects.toMatchObject({ failure: 'recoveryRequired' });
    expect(fixture.inspect).not.toHaveBeenCalled();
  });

  it('uses update-owned pre-backend failure authority for active invalid history', async () => {
    const fixture = createFixture({
      failureResult: { kind: 'failedSafeWithoutRecovery' },
      inventory: inventory('invalidHistory', 'current'),
    });

    await fixture.subject.recoverBeforeWorkspaceResolution();
    await expect(fixture.subject.prepareBeforeBackend()).rejects.toEqual(
      new WorkspaceFirstStartMigrationOrchestratorError('failed'),
    );

    expect(fixture.recordFailure).toHaveBeenCalledWith(
      'authorizedNewerBuild',
    );
    expect(fixture.journal.value).toBeUndefined();
  });

  it('requests relaunch only after coordinated pre-backend rollback authority succeeds', async () => {
    const fixture = createFixture({
      admission: 'coordinatedUpdateTarget',
      failureResult: { kind: 'rollbackRequired' },
      inventory: inventory('invalidHistory', 'current'),
    });

    await fixture.subject.recoverBeforeWorkspaceResolution();
    const error = await fixture.subject.prepareBeforeBackend().catch(
      (failure: unknown) => failure,
    );

    expect(error).toMatchObject({
      failure: 'rollbackRequired',
      relaunchRequired: true,
    });
    expect(fixture.recordFailure).toHaveBeenCalledWith(
      'coordinatedUpdateTarget',
    );
  });

  it('keeps accepted-target cleanup bound to the target running build', async () => {
    const fixture = createFixture();
    await fixture.seedPrepared(inventory('current', 'invalidHistory'));
    await fixture.transitions.transitionRegistry({
      operationId,
      sourceBuild,
      targetBuild,
      updatedAt: '2026-08-21T00:01:00.000Z',
    });
    fixture.acceptedBuild.value = accepted(targetBuild);
    fixture.events.length = 0;

    await expect(
      fixture.subject.recoverBeforeWorkspaceResolution(),
    ).resolves.toBe('acceptedTarget');

    expect(fixture.journal.value).toBeUndefined();
    expect(fixture.events).toEqual(['journal.removeTransitioned']);
  });
});

function createFixture(
  options: {
    readonly acceptedBuild?: Readonly<AcceptedBuildMetadata>;
    readonly admission?: PreWorkspaceBuildAdmission;
    readonly failureResult?: PreBackendFirstStartFailureResult;
    readonly inventory?: Readonly<WorkspaceMigrationInventory>;
    readonly registryMissing?: boolean;
    readonly runningBuild?: Readonly<WorkspaceFirstStartBuildIdentity>;
  } = {},
) {
  const events: string[] = [];
  let registryValue = workspaceRegistry();
  const readRegistry = vi.fn(async () =>
    options.registryMissing === true ? undefined : registryValue,
  );
  const registry = {
    get value() {
      return registryValue;
    },
    writes: [] as Readonly<LocalWorkspaceRegistryV1>[],
    read: readRegistry,
    async write(value: unknown) {
      registryValue = validateWorkspaceRegistry(value);
      this.writes.push(registryValue);
      events.push('registry.write');
    },
  };
  const journal = {
    value: undefined as
      | Readonly<WorkspaceFirstStartMigrationJournalV1>
      | undefined,
    async read() {
      return this.value;
    },
    async write(value: unknown) {
      this.value = validateWorkspaceFirstStartMigrationJournal(value);
      events.push(`journal.${this.value.state}`);
    },
    async discardPrepared(expectedOperationId: string) {
      expect(this.value).toMatchObject({
        operationId: expectedOperationId,
        state: 'prepared',
      });
      this.value = undefined;
      events.push('journal.discardPrepared');
    },
    async removeTransitioned(expectedOperationId: string) {
      expect(this.value).toMatchObject({
        operationId: expectedOperationId,
        state: 'registryTransitioned',
      });
      this.value = undefined;
      events.push('journal.removeTransitioned');
    },
  };
  const acceptedBuild = {
    value: options.acceptedBuild ?? accepted(sourceBuild),
    async read() {
      return this.value;
    },
  };
  const transitions = new WorkspaceFirstStartMigrationTransitionCoordinator({
    acceptedBuild,
    journal,
    registry,
  });
  const inspect = vi.fn(async () => options.inventory ?? inventory());
  const recordFailure = vi.fn(
    async () =>
      options.failureResult ??
      ({ kind: 'failedSafeWithoutRecovery' } as const),
  );
  const subject = new WorkspaceFirstStartMigrationOrchestrator({
    acceptedBuild,
    admission: options.admission ?? 'authorizedNewerBuild',
    failureAuthority: { recordFailure },
    inventory: { inspect },
    journal,
    now: () => new Date('2026-08-21T00:00:00.000Z'),
    operationIdFactory: () => operationId,
    registry,
    runningBuild: options.runningBuild ?? targetBuild,
    transitions,
  });

  return {
    acceptedBuild,
    events,
    inspect,
    journal,
    readRegistry,
    recordFailure,
    registry,
    subject,
    transitions,
    async seedPrepared(seedInventory: Readonly<WorkspaceMigrationInventory>) {
      const plan = resolveWorkspaceFirstStartMigrationPlan({
        admission: 'authorizedNewerBuild',
        inventory: seedInventory,
        registry: registry.value,
        sourceBuild,
        targetBuild,
      });
      await transitions.prepare({
        createdAt: '2026-08-21T00:00:00.000Z',
        operationId,
        plan,
        sourceBuild,
        targetBuild,
      });
    },
  };
}

function inventory(
  activeStatus: WorkspaceMigrationInventoryStatus = 'current',
  passiveStatus: WorkspaceMigrationInventoryStatus = 'current',
): Readonly<WorkspaceMigrationInventory> {
  return {
    activeWorkspaceId,
    entries: [
      inventoryEntry(activeWorkspaceId, activeStatus, true),
      inventoryEntry(passiveWorkspaceId, passiveStatus, false),
    ],
  };
}

function inventoryEntry(
  workspaceId: WorkspaceId,
  status: WorkspaceMigrationInventoryStatus,
  isActive: boolean,
) {
  return {
    appliedMigrationCount:
      status === 'current' ? 40 : status === 'compatiblePending' ? 38 : 0,
    isActive,
    pendingMigrationCount: status === 'compatiblePending' ? 2 : 0,
    status,
    workspaceId,
  };
}

function workspaceRegistry(): Readonly<LocalWorkspaceRegistryV1> {
  return {
    activeWorkspaceId,
    formatVersion: 1,
    workspaces: [
      registryEntry(activeWorkspaceId, 'a'),
      registryEntry(passiveWorkspaceId, 'b'),
    ],
  };
}

function registryEntry(
  workspaceId: WorkspaceId,
  profileCharacter: string,
): Readonly<LocalWorkspaceRegistryEntryV1> {
  return {
    createdAt: '2026-08-21T00:00:00.000Z',
    layoutVersion: 1,
    lifecycleState: 'ready',
    lineageIdentity: {
      formatVersion: 1,
      profileId: profileCharacter.repeat(64),
    },
    workspaceId,
    workspaceLabel: `Workspace ${profileCharacter.toUpperCase()}`,
  };
}

function accepted(
  identity: Readonly<WorkspaceFirstStartBuildIdentity>,
): Readonly<AcceptedBuildMetadata> {
  return {
    acceptedAt: '2026-08-21T00:00:00.000Z',
    appVersion: identity.appVersion,
    buildRevision: identity.buildRevision,
    formatVersion: 1,
    releaseChannel: 'pilot',
  };
}

function build(
  appVersion: string,
  buildRevision: string,
): Readonly<WorkspaceFirstStartBuildIdentity> {
  return { appVersion, buildRevision };
}

import { describe, expect, it } from 'vitest';

import { WorkspaceSwitchCoordinator } from './workspaceSwitchCoordinator.js';
import { resolveWorkspaceSwitchStartup } from './workspaceSwitchStartup.js';
import {
  createSwitchJournal,
  createSwitchRegistry,
  MemorySwitchJournal,
  MemorySwitchRegistry,
  RecordingSwitchLease,
  RecordingSwitchLifecycle,
  TEST_SOURCE_WORKSPACE_ID,
  TEST_SWITCH_CREATED_AT,
  TEST_SWITCH_OPERATION_ID,
  TEST_TARGET_WORKSPACE_ID,
} from './workspaceSwitchTestSupport.js';

interface SwitchFixture {
  readonly coordinator: WorkspaceSwitchCoordinator;
  readonly events: string[];
  readonly journal: MemorySwitchJournal;
  readonly lease: RecordingSwitchLease;
  readonly lifecycle: RecordingSwitchLifecycle;
  readonly registry: MemorySwitchRegistry;
}

function createFixture(): SwitchFixture {
  const events: string[] = [];
  const journal = new MemorySwitchJournal(events);
  const lease = new RecordingSwitchLease(events);
  const lifecycle = new RecordingSwitchLifecycle(events);
  const registry = new MemorySwitchRegistry(events, createSwitchRegistry());
  return {
    events,
    journal,
    lease,
    lifecycle,
    registry,
    coordinator: new WorkspaceSwitchCoordinator({
      activeWorkspaceLifecycle: lifecycle,
      generateOperationId: () => TEST_SWITCH_OPERATION_ID,
      journal,
      maintenanceLease: lease,
      now: () => new Date(TEST_SWITCH_CREATED_AT),
      registry,
      relaunchApplication: () => events.push('application.relaunch'),
    }),
  };
}

describe('workspace switch coordinator', () => {
  it('stops the source before selecting the target and schedules one relaunch', async () => {
    const fixture = createFixture();

    await expect(
      fixture.coordinator.switchTo(TEST_TARGET_WORKSPACE_ID),
    ).resolves.toBeUndefined();

    expect(fixture.events).toEqual([
      'lease.acquire.switch',
      'journal.read',
      'registry.read',
      `lifecycle.quiesce.${TEST_SOURCE_WORKSPACE_ID}`,
      `lifecycle.stop.${TEST_SOURCE_WORKSPACE_ID}`,
      'journal.write.prepared',
      'registry.write',
      'journal.write.targetSelected',
      'application.relaunch',
      'lease.release',
    ]);
    expect(fixture.registry.value?.activeWorkspaceId)
      .toBe(TEST_TARGET_WORKSPACE_ID);
    expect(fixture.journal.current?.state).toBe('targetSelected');
    expect(fixture.lifecycle.runningRuntimeOwners).toBe(0);
    expect(fixture.lifecycle.openDatabaseHandleOwners).toBe(0);
    expect(fixture.lease.held).toBe(false);
  });

  it('rejects a pending switch and an unavailable target before quiescing', async () => {
    const pending = createFixture();
    pending.journal.current = createSwitchJournal('targetSelected');
    await expect(
      pending.coordinator.switchTo(TEST_TARGET_WORKSPACE_ID),
    ).rejects.toMatchObject({ code: 'WORKSPACE_SWITCH_RECOVERY_REQUIRED' });
    expect(pending.events.some((event) => event.startsWith('lifecycle.')))
      .toBe(false);

    const unknown = createFixture();
    await expect(
      unknown.coordinator.switchTo(
        '33333333-3333-4333-8333-333333333333' as typeof TEST_TARGET_WORKSPACE_ID,
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_SWITCH_STORAGE_FAILED' });
    expect(unknown.events.some((event) => event.startsWith('lifecycle.')))
      .toBe(false);
  });

  it('restores the source runtime when stop fails after closing handles', async () => {
    const fixture = createFixture();
    fixture.lifecycle.failure = 'stopAfterSideEffect';

    await expect(
      fixture.coordinator.switchTo(TEST_TARGET_WORKSPACE_ID),
    ).rejects.toMatchObject({ code: 'WORKSPACE_SWITCH_STORAGE_FAILED' });

    expect(fixture.registry.value?.activeWorkspaceId)
      .toBe(TEST_SOURCE_WORKSPACE_ID);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
    expect(fixture.lifecycle.openDatabaseHandleOwners).toBe(1);
    expect(fixture.events).toContain(
      `lifecycle.ensure.${TEST_SOURCE_WORKSPACE_ID}`,
    );
  });

  it.each(['registry', 'targetJournal'] as const)(
    'rolls a partially published %s switch back to the source',
    async (failure) => {
      const fixture = createFixture();
      if (failure === 'registry') fixture.registry.failWriteAfter = true;
      else fixture.journal.failAfterState = 'targetSelected';

      await expect(
        fixture.coordinator.switchTo(TEST_TARGET_WORKSPACE_ID),
      ).rejects.toMatchObject({ code: 'WORKSPACE_SWITCH_STORAGE_FAILED' });

      expect(fixture.registry.value?.activeWorkspaceId)
        .toBe(TEST_SOURCE_WORKSPACE_ID);
      expect(fixture.journal.current?.state).toBe('rollbackSelected');
      expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
      expect(fixture.lifecycle.openDatabaseHandleOwners).toBe(1);
      expect(fixture.events).not.toContain('application.relaunch');
    },
  );

  it('returns recoveryRequired when source runtime recovery fails', async () => {
    const fixture = createFixture();
    fixture.registry.failWriteAfter = true;
    fixture.lifecycle.failure = 'ensure';

    await expect(
      fixture.coordinator.switchTo(TEST_TARGET_WORKSPACE_ID),
    ).rejects.toMatchObject({ code: 'WORKSPACE_SWITCH_RECOVERY_REQUIRED' });

    expect(fixture.journal.current?.state).toBe('recoveryRequired');
    expect(fixture.lease.held).toBe(false);
  });

  it('fails without side effects when the maintenance lease is busy', async () => {
    const fixture = createFixture();
    fixture.lease.held = true;

    await expect(
      fixture.coordinator.switchTo(TEST_TARGET_WORKSPACE_ID),
    ).rejects.toMatchObject({ code: 'WORKSPACE_SWITCH_STORAGE_FAILED' });

    expect(fixture.events).toEqual(['lease.acquire.switch']);
  });

  it('completes A to B to A with one runtime and database owner at each boundary', async () => {
    const first = createFixture();

    await first.coordinator.switchTo(TEST_TARGET_WORKSPACE_ID);
    const targetStartup = await resolveWorkspaceSwitchStartup(
      first.registry,
      first.journal,
    );
    expect(targetStartup.mode).toBe('targetValidation');
    await targetStartup.accept('b'.repeat(64));

    const secondEvents: string[] = [];
    const secondLifecycle = new RecordingSwitchLifecycle(secondEvents);
    const secondLease = new RecordingSwitchLease(secondEvents);
    const secondCoordinator = new WorkspaceSwitchCoordinator({
      activeWorkspaceLifecycle: secondLifecycle,
      generateOperationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      journal: first.journal,
      maintenanceLease: secondLease,
      now: () => new Date(TEST_SWITCH_CREATED_AT),
      registry: first.registry,
      relaunchApplication: () => secondEvents.push('application.relaunch'),
    });

    await secondCoordinator.switchTo(TEST_SOURCE_WORKSPACE_ID);
    const sourceStartup = await resolveWorkspaceSwitchStartup(
      first.registry,
      first.journal,
    );
    expect(sourceStartup.mode).toBe('targetValidation');
    await sourceStartup.accept('a'.repeat(64));

    expect(first.registry.value?.activeWorkspaceId)
      .toBe(TEST_SOURCE_WORKSPACE_ID);
    expect(first.journal.current).toBeUndefined();
    expect(first.lifecycle.runningRuntimeOwners).toBe(0);
    expect(first.lifecycle.openDatabaseHandleOwners).toBe(0);
    expect(secondLifecycle.runningRuntimeOwners).toBe(0);
    expect(secondLifecycle.openDatabaseHandleOwners).toBe(0);
    expect(first.lease.held).toBe(false);
    expect(secondLease.held).toBe(false);
  });
});

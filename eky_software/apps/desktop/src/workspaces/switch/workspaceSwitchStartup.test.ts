import { describe, expect, it } from 'vitest';

import { resolveWorkspaceSwitchStartup } from './workspaceSwitchStartup.js';
import {
  createSwitchJournal,
  createSwitchRegistry,
  MemorySwitchJournal,
  MemorySwitchRegistry,
  TEST_SOURCE_WORKSPACE_ID,
  TEST_TARGET_WORKSPACE_ID,
} from './workspaceSwitchTestSupport.js';

describe('workspace switch startup recovery', () => {
  it('starts the active workspace normally when no switch is pending', async () => {
    const events: string[] = [];
    const registry = new MemorySwitchRegistry(events, createSwitchRegistry());
    const journal = new MemorySwitchJournal(events);

    const selection = await resolveWorkspaceSwitchStartup(registry, journal);

    expect(selection.mode).toBe('normal');
    expect(selection.workspace.workspaceId).toBe(TEST_SOURCE_WORKSPACE_ID);
    await expect(selection.accept('a'.repeat(64))).resolves.toBeUndefined();
    await expect(selection.recoverFromFailure()).resolves.toBe('notRecovered');
  });

  it('clears an uncommitted prepared switch while the source is active', async () => {
    const events: string[] = [];
    const registry = new MemorySwitchRegistry(events, createSwitchRegistry());
    const journal = new MemorySwitchJournal(
      events,
      createSwitchJournal('prepared'),
    );

    const selection = await resolveWorkspaceSwitchStartup(registry, journal);

    expect(selection.mode).toBe('normal');
    expect(selection.workspace.workspaceId).toBe(TEST_SOURCE_WORKSPACE_ID);
    expect(journal.current).toBeUndefined();
  });

  it('validates and accepts a selected target only against its lineage', async () => {
    const events: string[] = [];
    const registry = new MemorySwitchRegistry(
      events,
      createSwitchRegistry(TEST_TARGET_WORKSPACE_ID),
    );
    const journal = new MemorySwitchJournal(
      events,
      createSwitchJournal('targetSelected'),
    );

    const selection = await resolveWorkspaceSwitchStartup(registry, journal);

    expect(selection.mode).toBe('targetValidation');
    expect(selection.workspace.workspaceId).toBe(TEST_TARGET_WORKSPACE_ID);
    await expect(selection.accept('a'.repeat(64))).rejects.toMatchObject({
      code: 'WORKSPACE_SWITCH_INVALID',
    });
    expect(journal.current?.state).toBe('targetSelected');
    await expect(selection.accept('b'.repeat(64))).resolves.toBeUndefined();
    expect(journal.current).toBeUndefined();
  });

  it('repairs a crash between target pointer and targetSelected journal writes', async () => {
    const events: string[] = [];
    const registry = new MemorySwitchRegistry(
      events,
      createSwitchRegistry(TEST_TARGET_WORKSPACE_ID),
    );
    const journal = new MemorySwitchJournal(
      events,
      createSwitchJournal('prepared'),
    );

    const selection = await resolveWorkspaceSwitchStartup(registry, journal);

    expect(selection.mode).toBe('targetValidation');
    expect(journal.current?.state).toBe('targetSelected');
  });

  it('rolls target validation failure back for a source validation restart', async () => {
    const events: string[] = [];
    const registry = new MemorySwitchRegistry(
      events,
      createSwitchRegistry(TEST_TARGET_WORKSPACE_ID),
    );
    const journal = new MemorySwitchJournal(
      events,
      createSwitchJournal('targetSelected'),
    );
    const targetSelection = await resolveWorkspaceSwitchStartup(
      registry,
      journal,
    );

    await expect(targetSelection.recoverFromFailure())
      .resolves.toBe('relaunchRequired');
    expect(registry.value?.activeWorkspaceId).toBe(TEST_SOURCE_WORKSPACE_ID);
    expect(journal.current?.state).toBe('rollbackSelected');

    const sourceSelection = await resolveWorkspaceSwitchStartup(
      registry,
      journal,
    );
    expect(sourceSelection.mode).toBe('rollbackValidation');
    await expect(sourceSelection.accept('a'.repeat(64))).resolves.toBeUndefined();
    expect(journal.current).toBeUndefined();
  });

  it('persists recoveryRequired if rollback validation also fails', async () => {
    const events: string[] = [];
    const registry = new MemorySwitchRegistry(events, createSwitchRegistry());
    const journal = new MemorySwitchJournal(
      events,
      createSwitchJournal('rollbackSelected'),
    );
    const selection = await resolveWorkspaceSwitchStartup(registry, journal);

    await expect(selection.recoverFromFailure())
      .resolves.toBe('recoveryRequired');
    expect(journal.current?.state).toBe('recoveryRequired');
    await expect(resolveWorkspaceSwitchStartup(registry, journal))
      .rejects.toMatchObject({ code: 'WORKSPACE_SWITCH_RECOVERY_REQUIRED' });
  });

  it('marks recovery required when target rollback cannot change the active pointer', async () => {
    const events: string[] = [];
    const registry = new MemorySwitchRegistry(
      events,
      createSwitchRegistry(TEST_TARGET_WORKSPACE_ID),
    );
    registry.failWriteBefore = true;
    const journal = new MemorySwitchJournal(
      events,
      createSwitchJournal('targetSelected'),
    );
    const selection = await resolveWorkspaceSwitchStartup(registry, journal);

    await expect(selection.recoverFromFailure())
      .resolves.toBe('recoveryRequired');
    expect(registry.value?.activeWorkspaceId).toBe(TEST_TARGET_WORKSPACE_ID);
    expect(journal.current?.state).toBe('recoveryRequired');
  });

  it('continues rollback when a registry write failed after selecting the source', async () => {
    const events: string[] = [];
    const registry = new MemorySwitchRegistry(
      events,
      createSwitchRegistry(TEST_TARGET_WORKSPACE_ID),
    );
    registry.failWriteAfter = true;
    const journal = new MemorySwitchJournal(
      events,
      createSwitchJournal('targetSelected'),
    );
    const selection = await resolveWorkspaceSwitchStartup(registry, journal);

    await expect(selection.recoverFromFailure())
      .resolves.toBe('relaunchRequired');
    expect(registry.value?.activeWorkspaceId).toBe(TEST_SOURCE_WORKSPACE_ID);
    expect(journal.current?.state).toBe('rollbackSelected');
  });

  it('marks recovery required when rollback journal persistence fails', async () => {
    const events: string[] = [];
    const registry = new MemorySwitchRegistry(
      events,
      createSwitchRegistry(TEST_TARGET_WORKSPACE_ID),
    );
    const journal = new MemorySwitchJournal(
      events,
      createSwitchJournal('targetSelected'),
    );
    journal.failBeforeState = 'rollbackSelected';
    const selection = await resolveWorkspaceSwitchStartup(registry, journal);

    await expect(selection.recoverFromFailure())
      .resolves.toBe('recoveryRequired');
    expect(registry.value?.activeWorkspaceId).toBe(TEST_SOURCE_WORKSPACE_ID);
    expect(journal.current?.state).toBe('recoveryRequired');
  });

  it('reconciles a rollback journal write that failed after its side effect', async () => {
    const events: string[] = [];
    const registry = new MemorySwitchRegistry(
      events,
      createSwitchRegistry(TEST_TARGET_WORKSPACE_ID),
    );
    const journal = new MemorySwitchJournal(
      events,
      createSwitchJournal('targetSelected'),
    );
    journal.failAfterState = 'rollbackSelected';
    const selection = await resolveWorkspaceSwitchStartup(registry, journal);

    await expect(selection.recoverFromFailure())
      .resolves.toBe('recoveryRequired');
    expect(registry.value?.activeWorkspaceId).toBe(TEST_SOURCE_WORKSPACE_ID);
    expect(journal.current?.state).toBe('recoveryRequired');
  });

  it('fails closed with an allowlisted code when recoveryRequired cannot be persisted', async () => {
    const events: string[] = [];
    const registry = new MemorySwitchRegistry(
      events,
      createSwitchRegistry(TEST_TARGET_WORKSPACE_ID),
    );
    registry.failWriteBefore = true;
    const journal = new MemorySwitchJournal(
      events,
      createSwitchJournal('targetSelected'),
    );
    journal.failBeforeState = 'recoveryRequired';
    const selection = await resolveWorkspaceSwitchStartup(registry, journal);

    await expect(selection.recoverFromFailure()).rejects.toMatchObject({
      code: 'WORKSPACE_SWITCH_RECOVERY_REQUIRED',
      message: 'WORKSPACE_SWITCH_RECOVERY_REQUIRED',
    });
    expect(JSON.stringify(events)).not.toContain('Error');
  });

  it('fails closed for a journal and active pointer mismatch', async () => {
    const events: string[] = [];
    const invalidActive =
      '33333333-3333-4333-8333-333333333333' as typeof TEST_SOURCE_WORKSPACE_ID;
    const registryValue = {
      ...createSwitchRegistry(),
      activeWorkspaceId: invalidActive,
    };
    const registry = new MemorySwitchRegistry(events, registryValue);
    const journal = new MemorySwitchJournal(
      events,
      createSwitchJournal('targetSelected'),
    );

    await expect(resolveWorkspaceSwitchStartup(registry, journal))
      .rejects.toMatchObject({ code: 'WORKSPACE_SWITCH_RECOVERY_REQUIRED' });
  });
});

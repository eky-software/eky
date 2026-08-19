import { describe, expect, it, vi } from 'vitest';

import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import { WorkspaceManagementRecoveryRequiredError } from './workspaceManagementOperationGuard.js';
import { WorkspaceManagementService } from './workspaceManagementService.js';

const activeId = '00000000-0000-4000-8000-000000000001' as WorkspaceId;

describe('workspace management service', () => {
  it('returns the safe registry status and delegates each command', async () => {
    const create = vi.fn(async () => ({
      workspaceId: activeId,
      workspaceLabel: 'Luotu',
    }));
    const importBackup = vi.fn(async () => ({
      workspaceId: activeId,
      workspaceLabel: 'Tuotu',
    }));
    const replace = vi.fn(async () => ({
      migrationChainIdentity: 'chain',
      profileId: 'profile',
      workspaceId: activeId,
    }));
    const switchTo = vi.fn(async () => undefined);
    const rename = vi.fn(async () => ({
      changed: true,
      workspaceId: activeId,
      workspaceLabel: 'Nimetty',
    }));
    const events: unknown[] = [];
    const service = createService({
      create,
      events,
      importBackup,
      rename,
      replace,
      switchTo,
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      activeWorkspaceId: activeId,
      operationState: 'idle',
    });
    await service.createEmpty('Luotu');
    await service.importBackupAsNew({
      containerPath: 'private-path',
      password: 'private-password',
      workspaceLabel: 'Tuotu',
    });
    await service.replaceActiveFromBackup({
      containerPath: 'private-path',
      password: 'private-password',
      targetWorkspaceId: activeId,
    });
    await service.switchTo(activeId);
    await service.rename(activeId, 'Nimetty');

    expect(create).toHaveBeenCalledWith('Luotu');
    expect(importBackup).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(switchTo).toHaveBeenCalledWith(activeId);
    expect(rename).toHaveBeenCalledWith(activeId, 'Nimetty');
    expect(JSON.stringify(events)).not.toContain('private-path');
    expect(JSON.stringify(events)).not.toContain('private-password');
    expect(JSON.stringify(events)).not.toContain(activeId);
  });

  it('serializes management commands without acquiring the shared lease twice', async () => {
    let finish!: () => void;
    const events: unknown[] = [];
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const service = createService({
      create: async () => {
        await pending;
        return { workspaceId: activeId, workspaceLabel: 'Luotu' };
      },
      events,
    });

    const first = service.createEmpty('Luotu');
    await expect(service.switchTo(activeId)).rejects.toMatchObject({
      code: 'WORKSPACE_MANAGEMENT_BUSY',
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        errorCode: 'WORKSPACE_MANAGEMENT_BUSY',
        operationKind: 'switch',
        outcome: 'failed',
        sideEffectState: 'none',
        stage: 'admission',
      }),
    );
    finish();
    await expect(first).resolves.toMatchObject({ workspaceId: activeId });
  });

  it('maps raw failures to a closed code and ignores observer failure', async () => {
    const service = createService({
      create: async () => {
        throw new Error('C:/private/path and stack detail');
      },
      observer: {
        record() {
          throw new Error('observer failure');
        },
      },
    });

    await expect(service.createEmpty('Luotu')).rejects.toEqual(
      new WorkspaceManagementError(
        'WORKSPACE_MANAGEMENT_CREATE_FAILED',
        'create',
      ),
    );
  });

  it('reports recoveryRequired without exposing operation details', async () => {
    const service = createService({ recoveryState: 'recoveryRequired' });
    await expect(service.getStatus()).resolves.toMatchObject({
      operationState: 'recoveryRequired',
    });
  });

  it('blocks every mutation before its command when recovery is unresolved', async () => {
    const create = vi.fn(async () => ({
      workspaceId: activeId,
      workspaceLabel: 'Luotu',
    }));
    const service = createService({
      assertNoUnresolvedOperations: async () => {
        throw new WorkspaceManagementRecoveryRequiredError();
      },
      create,
    });

    await expect(service.createEmpty('Luotu')).rejects.toMatchObject({
      code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('completes a deferred runtime relaunch after the command settles', async () => {
    const order: string[] = [];
    const service = createService({
      create: async () => {
        order.push('operation');
        return { workspaceId: activeId, workspaceLabel: 'Luotu' };
      },
      runtimeRelaunchCompletion: {
        complete() {
          order.push('relaunch.complete');
        },
      },
    });

    await service.createEmpty('Luotu');

    expect(order).toEqual(['operation', 'relaunch.complete']);
  });

  it('completes a deferred recovery relaunch after a failed command', async () => {
    const complete = vi.fn();
    const service = createService({
      create: async () => {
        throw new Error('private failure');
      },
      runtimeRelaunchCompletion: { complete },
    });

    await expect(service.createEmpty('Luotu')).rejects.toMatchObject({
      code: 'WORKSPACE_MANAGEMENT_CREATE_FAILED',
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

function createService(overrides: {
  assertNoUnresolvedOperations?: () => Promise<void>;
  create?: (label: unknown) => Promise<{
    workspaceId: WorkspaceId;
    workspaceLabel: string;
  }>;
  events?: unknown[];
  importBackup?: (input: unknown) => Promise<{
    workspaceId: WorkspaceId;
    workspaceLabel: string;
  }>;
  observer?: { record(event: unknown): void };
  recoveryState?: 'clear' | 'recoveryRequired';
  rename?: (workspaceId: unknown, label: unknown) => Promise<{
    changed: boolean;
    workspaceId: WorkspaceId;
    workspaceLabel: string;
  }>;
  replace?: (input: unknown) => Promise<{
    migrationChainIdentity: string;
    profileId: string;
    workspaceId: WorkspaceId;
  }>;
  switchTo?: (workspaceId: WorkspaceId) => Promise<void>;
  runtimeRelaunchCompletion?: { complete(): void };
} = {}): WorkspaceManagementService {
  const maintenance = new InMemoryWorkspaceMaintenanceLease();
  const observer =
    overrides.observer ??
    (overrides.events === undefined
      ? undefined
      : { record: (event: unknown) => overrides.events!.push(event) });
  return new WorkspaceManagementService({
    createEmpty: {
      create:
        overrides.create ??
        (async () => ({ workspaceId: activeId, workspaceLabel: 'Luotu' })),
    },
    importBackup: {
      import:
        overrides.importBackup ??
        (async () => ({ workspaceId: activeId, workspaceLabel: 'Tuotu' })),
    },
    maintenanceState: maintenance,
    ...(observer === undefined ? {} : { observer }),
    operationGuard: {
      assertNoUnresolvedOperations:
        overrides.assertNoUnresolvedOperations ??
        (async () => undefined),
      readRecoveryState: async () => overrides.recoveryState ?? 'clear',
    },
    registry: {
      read: async () => ({
        activeWorkspaceId: activeId,
        formatVersion: 1,
        workspaces: [
          {
            createdAt: '2026-08-19T00:00:00.000Z',
            layoutVersion: 1,
            lifecycleState: 'ready',
            lineageIdentity: { formatVersion: 1, profileId: 'private-profile' },
            workspaceId: activeId,
            workspaceLabel: 'Yritys A',
          },
        ],
      }),
    },
    renameWorkspace: {
      rename:
        overrides.rename ??
        (async () => ({
          changed: true,
          workspaceId: activeId,
          workspaceLabel: 'Nimetty',
        })),
    },
    replaceActive: {
      replace:
        overrides.replace ??
        (async () => ({
          migrationChainIdentity: 'chain',
          profileId: 'profile',
          workspaceId: activeId,
        })),
    },
    ...(overrides.runtimeRelaunchCompletion === undefined
      ? {}
      : {
          runtimeRelaunchCompletion:
            overrides.runtimeRelaunchCompletion,
        }),
    switchWorkspace: {
      switchTo: overrides.switchTo ?? (async () => undefined),
    },
  });
}

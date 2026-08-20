import { describe, expect, it, vi } from 'vitest';

import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import {
  type WorkspaceManagementOperationGuard,
  WorkspaceManagementRecoveryRequiredError,
} from './workspaceManagementOperationGuard.js';
import { WorkspaceLabelRename } from './workspaceLabelRename.js';

const activeId = '00000000-0000-4000-8000-000000000001' as WorkspaceId;
const inactiveId = '00000000-0000-4000-8000-000000000002' as WorkspaceId;

describe('workspace label rename', () => {
  it.each([
    ['active', activeId],
    ['inactive', inactiveId],
  ])('renames an %s workspace without changing registry identity fields', async (_, workspaceId) => {
    const original = createRegistry();
    const writes: unknown[] = [];
    const rename = createRename(original, writes);

    await expect(rename.rename(workspaceId, 'Uusi nimi')).resolves.toEqual({
      changed: true,
      workspaceId,
      workspaceLabel: 'Uusi nimi',
    });

    const written = writes[0] as LocalWorkspaceRegistryV1;
    expect(written.activeWorkspaceId).toBe(original.activeWorkspaceId);
    expect(
      written.workspaces.map(({ workspaceLabel: _label, ...entry }) => entry),
    ).toEqual(
      original.workspaces.map(({ workspaceLabel: _label, ...entry }) => entry),
    );
  });

  it('allows duplicate labels and treats the same label as a no-op', async () => {
    const original = createRegistry();
    const duplicateWrites: unknown[] = [];
    await createRename(original, duplicateWrites).rename(
      inactiveId,
      'Yritys A',
    );
    expect(duplicateWrites).toHaveLength(1);

    const noOpWrites: unknown[] = [];
    await expect(
      createRename(original, noOpWrites).rename(activeId, 'Yritys A'),
    ).resolves.toEqual({
      changed: false,
      workspaceId: activeId,
      workspaceLabel: 'Yritys A',
    });
    expect(noOpWrites).toHaveLength(0);
  });

  it.each([
    ['invalid label', activeId, '  '],
    ['invalid workspace id', 'not-an-id', 'Nimi'],
    ['unknown workspace', '00000000-0000-4000-8000-000000000099', 'Nimi'],
  ])('rejects %s without writes', async (_, workspaceId, label) => {
    const writes: unknown[] = [];
    await expect(
      createRename(createRegistry(), writes).rename(workspaceId, label),
    ).rejects.toBeInstanceOf(WorkspaceManagementError);
    expect(writes).toHaveLength(0);
  });

  it('rejects an unresolved operation before reading or writing registry', async () => {
    const registry = {
      read: vi.fn(),
      write: vi.fn(),
    } satisfies WorkspaceRegistryPort;
    const rename = new WorkspaceLabelRename({
      maintenanceLease: new InMemoryWorkspaceMaintenanceLease(),
      operationGuard: {
        assertNoUnresolvedOperations: async () => {
          throw new WorkspaceManagementRecoveryRequiredError();
        },
        readRecoveryState: async () => 'recoveryRequired',
      },
      registry,
    });

    await expect(rename.rename(activeId, 'Uusi nimi')).rejects.toMatchObject({
      code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED',
    });
    expect(registry.read).not.toHaveBeenCalled();
    expect(registry.write).not.toHaveBeenCalled();
  });

  it('fails closed on registry write failure and releases the lease', async () => {
    const lease = new InMemoryWorkspaceMaintenanceLease();
    const rename = new WorkspaceLabelRename({
      maintenanceLease: lease,
      operationGuard: clearGuard(),
      registry: {
        read: async () => createRegistry(),
        write: async () => {
          throw new Error('private storage detail');
        },
      },
    });

    await expect(rename.rename(activeId, 'Uusi nimi')).rejects.toMatchObject({
      code: 'WORKSPACE_MANAGEMENT_RENAME_FAILED',
    });
    expect(lease.readState()).toBe('idle');
  });
});

function createRename(
  registryValue: Readonly<LocalWorkspaceRegistryV1>,
  writes: unknown[],
): WorkspaceLabelRename {
  return new WorkspaceLabelRename({
    maintenanceLease: new InMemoryWorkspaceMaintenanceLease(),
    operationGuard: clearGuard(),
    registry: {
      read: async () => registryValue,
      write: async (value) => {
        writes.push(value);
      },
    },
  });
}

function clearGuard(): WorkspaceManagementOperationGuard {
  return {
    assertNoUnresolvedOperations: async () => undefined,
    readRecoveryState: async () => 'clear',
  };
}

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
        lifecycleState: 'ready' as const,
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

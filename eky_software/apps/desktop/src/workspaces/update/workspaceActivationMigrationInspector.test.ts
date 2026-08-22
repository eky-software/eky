import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { PrivateWorkspaceMigrationInspectionRuntimeFactory } from './workspaceMigrationInventoryTypes.js';
import { WorkspaceActivationMigrationInspector } from './workspaceActivationMigrationInspector.js';

const roots: string[] = [];
const workspaceId =
  '11111111-1111-4111-8111-111111111111' as WorkspaceId;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('WorkspaceActivationMigrationInspector', () => {
  it('inspects one published target and proves private handles closed', async () => {
    const { userDataRoot, workspaceRoot } = await createWorkspaceRoot();
    const stopAndProveHandlesClosed = vi.fn().mockResolvedValue(true);
    const startMigrationInspection = vi.fn().mockResolvedValue({
      inspectStoppedMigrationInspection: vi.fn().mockResolvedValue({
        appliedMigrationCount: 38,
        pendingMigrationCount: 2,
        status: 'compatiblePending',
      }),
      stopAndProveHandlesClosed,
    });
    const inspector = new WorkspaceActivationMigrationInspector({
      startMigrationInspection,
    } satisfies PrivateWorkspaceMigrationInspectionRuntimeFactory);

    await expect(
      inspector.inspect({
        expectedProfileId: 'a'.repeat(64),
        operationId: '22222222-2222-4222-8222-222222222222',
        userDataRoot,
        workspaceId,
      }),
    ).resolves.toEqual({
      appliedMigrationCount: 38,
      pendingMigrationCount: 2,
      status: 'compatiblePending',
    });
    expect(startMigrationInspection).toHaveBeenCalledWith({
      databaseFilePath: join(workspaceRoot, 'runtime', 'data', 'eky.sqlite'),
      expectedProfileId: 'a'.repeat(64),
      operationId: '22222222-2222-4222-8222-222222222222',
      publishedRoot: workspaceRoot,
    });
    expect(stopAndProveHandlesClosed).toHaveBeenCalled();
  });

  it('fails closed when the private runtime cannot prove handle closure', async () => {
    const { userDataRoot } = await createWorkspaceRoot();
    const inspector = new WorkspaceActivationMigrationInspector({
      async startMigrationInspection() {
        return {
          async inspectStoppedMigrationInspection() {
            throw new Error('must-not-read');
          },
          async stopAndProveHandlesClosed() {
            return false;
          },
        };
      },
    });

    await expect(
      inspector.inspect({
        expectedProfileId: 'a'.repeat(64),
        operationId: '22222222-2222-4222-8222-222222222222',
        userDataRoot,
        workspaceId,
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      message: 'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
    });
  });
});

async function createWorkspaceRoot(): Promise<{
  userDataRoot: string;
  workspaceRoot: string;
}> {
  const userDataRoot = await mkdtemp(join(tmpdir(), 'eky-w6a3-inspection-'));
  roots.push(userDataRoot);
  const workspaceRoot = join(userDataRoot, 'workspaces', workspaceId);
  await mkdir(join(workspaceRoot, 'runtime', 'data'), {
    mode: 0o700,
    recursive: true,
  });
  await mkdir(join(workspaceRoot, 'runtime', 'storage', 'invoices'), {
    mode: 0o700,
    recursive: true,
  });
  await writeFile(
    join(workspaceRoot, 'runtime', 'data', 'eky.sqlite'),
    'synthetic',
  );
  return { userDataRoot, workspaceRoot };
}

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { NodeWorkspaceActivationMigrationStaging } from './nodeWorkspaceActivationMigrationStaging.js';
import { WorkspaceActivationMigrationRecoveryPoint } from './workspaceActivationMigrationRecoveryPoint.js';
import { RecoveryPointCleanupError } from '../../profileBackup/recoveryPoint/recoveryPointOperationError.js';

const operationId = validateWorkspaceBackupImportOperationId(
  '10000000-0000-4000-8000-000000000001',
);
const profileId = '1'.repeat(64);
const chain = '2'.repeat(64);
const createdRoots: string[] = [];

afterEach(async ({ task }) => {
  if (task.result?.state !== 'pass') { createdRoots.splice(0); return; }
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    createdRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('WorkspaceActivationMigrationRecoveryPoint', () => {
  it('preserves a first failure without attempting cleanup already reported as uncertain', async () => {
    const primary = new Error('SYNTHETIC_SNAPSHOT_FAILED');
    const uncertain = new RecoveryPointCleanupError(primary);
    const removeOperationRoot = vi.fn(async () => {});
    const stageForRestore = vi.fn(async () => createStaged('/unused'));
    const point = new WorkspaceActivationMigrationRecoveryPoint(
      { createPreMigration: async () => { throw uncertain; } }, { stageForRestore },
      { assertOperationRoot: async () => {}, removeOperationRoot });
    await expect(point.createAndStage({ expectedMigrationChainIdentity: chain, expectedProfileId: profileId, operationId }))
      .rejects.toMatchObject({ cause: uncertain });
    expect(removeOperationRoot).not.toHaveBeenCalled();
    expect(stageForRestore).not.toHaveBeenCalled();
  });

  it('joins staging before reporting authority loss and never deletes its bytes', async () => {
    const root = await createRoot();
    const operationRoot = join(root, operationId);
    await mkdir(operationRoot);
    await writeFile(join(operationRoot, 'profile.sqlite'), 'snapshot');
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let current = true;
    const first = new Error('SYNTHETIC_OWNER_LOST');
    const assertCurrent = () => { if (!current) throw first; };
    const stageForRestore = vi.fn(async () => { entered(); await pending; return createStaged(operationRoot); });
    const point = new WorkspaceActivationMigrationRecoveryPoint(
      { createPreMigration: async () => createRecoveryPoint() }, { stageForRestore }, createStaging(root));
    let settled = false;
    const task = point.createAndStage({ expectedMigrationChainIdentity: chain, expectedProfileId: profileId, operationId,
      cleanupAuthority: { assertOwned: async () => assertCurrent(), assertCurrent } })
      .catch(error => error).finally(() => { settled = true; });
    try {
      await Promise.race([started, task.then(() => { throw new Error('STAGING_DID_NOT_START'); })]);
      current = false;
      expect(settled).toBe(false);
    } finally { release(); await task; }
    const error = await task;
    expect(error.cause).toBeInstanceOf(AggregateError);
    expect(error.cause.errors[0]).toBe(first);
    expect(await readFile(join(operationRoot, 'profile.sqlite'), 'utf8')).toBe('snapshot');
  });

  it('retains files if the synchronous authority expires after the asynchronous cleanup proof', async () => {
    const root = await createRoot();
    const operationRoot = join(root, operationId);
    await mkdir(operationRoot);
    await writeFile(join(operationRoot, 'profile.sqlite'), 'snapshot');
    let current = true;
    const point = createService(root, operationRoot);
    await expect(point.removeStaging(operationId, {
      assertOwned: async () => { current = false; },
      assertCurrent: () => { if (!current) throw new Error('SYNTHETIC_OWNER_LOST'); },
    })).rejects.toThrow('WORKSPACE_ACTIVATION_MIGRATION_FAILED');
    expect(await readFile(join(operationRoot, 'profile.sqlite'), 'utf8')).toBe('snapshot');
  });

  it('creates a historical preMigration point and stages its exact bytes', async () => {
    const root = await createRoot();
    const operationRoot = join(root, operationId);
    await mkdir(operationRoot);
    await writeFile(join(operationRoot, 'profile.sqlite'), 'snapshot');
    const createPreMigration = vi.fn(async () => createRecoveryPoint());
    const stageForRestore = vi.fn(async () =>
      createStaged(operationRoot),
    );
    const recoveryPoint = new WorkspaceActivationMigrationRecoveryPoint(
      { createPreMigration },
      { stageForRestore },
      createStaging(root),
    );

    const staged = await recoveryPoint.createAndStage({
      expectedMigrationChainIdentity: chain,
      expectedProfileId: profileId,
      operationId,
    });

    expect(createPreMigration).toHaveBeenCalledOnce();
    expect(stageForRestore).toHaveBeenCalledWith({
      artifactId: '20000000-0000-4000-8000-000000000001',
      expectedMigrationChainIdentity: chain,
      operationId,
    });
    expect(staged.operationRoot).toBe(operationRoot);
    expect(await readFile(join(operationRoot, 'profile.sqlite'), 'utf8')).toBe(
      'snapshot',
    );
  });

  it('removes only the exact operation staging root', async () => {
    const root = await createRoot();
    const operationRoot = join(root, operationId);
    await mkdir(operationRoot);
    await writeFile(join(operationRoot, 'profile.sqlite'), 'snapshot');
    const sibling = join(root, 'keep.txt');
    await writeFile(sibling, 'keep');
    const recoveryPoint = createService(root, operationRoot);

    await recoveryPoint.removeStaging(operationId);

    await expect(readFile(join(operationRoot, 'profile.sqlite'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(sibling, 'utf8')).toBe('keep');
  });

  it('rejects a staged root outside the private staging directory', async () => {
    const root = await createRoot();
    const outside = await createRoot();
    await writeFile(join(outside, 'profile.sqlite'), 'private');
    const recoveryPoint = createService(root, outside);

    await expect(
      recoveryPoint.createAndStage({
        expectedMigrationChainIdentity: chain,
        expectedProfileId: profileId,
        operationId,
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
    });
    expect(await readFile(join(outside, 'profile.sqlite'), 'utf8')).toBe(
      'private',
    );
  });

  it('cleans staging and rejects a profile or chain mismatch', async () => {
    const root = await createRoot();
    const operationRoot = join(root, operationId);
    await mkdir(operationRoot);
    await writeFile(join(operationRoot, 'profile.sqlite'), 'snapshot');
    const recoveryPoint = new WorkspaceActivationMigrationRecoveryPoint(
      {
        createPreMigration: vi.fn(async () => createRecoveryPoint()),
      },
      {
        stageForRestore: vi.fn(async () => ({
          ...createStaged(operationRoot),
          profileId: '3'.repeat(64),
        })),
      },
      createStaging(root),
    );

    await expect(
      recoveryPoint.createAndStage({
        expectedMigrationChainIdentity: chain,
        expectedProfileId: profileId,
        operationId,
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
    });
    await expect(readFile(join(operationRoot, 'profile.sqlite'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6a3-stage-'));
  createdRoots.push(root);
  return root;
}

function createService(root: string, operationRoot: string) {
  return new WorkspaceActivationMigrationRecoveryPoint(
    {
      createPreMigration: vi.fn(async () => createRecoveryPoint()),
    },
    {
      stageForRestore: vi.fn(async () => createStaged(operationRoot)),
    },
    createStaging(root),
  );
}

function createStaging(root: string) {
  return new NodeWorkspaceActivationMigrationStaging(root, {
    removeProfileSnapshot: async (id) => { await rm(join(root, id), { recursive: true, force: true }); },
  });
}

function createStaged(operationRoot: string) {
  return {
    appVersion: '0.2.6',
    artifactTotalByteSize: 0,
    createdAt: '2026-08-22T00:00:00.000Z',
    documentCount: 0,
    migrationChainIdentity: chain,
    operationRoot,
    profileId,
  } as const;
}

function createRecoveryPoint() {
  return {
    artifactId: '20000000-0000-4000-8000-000000000001',
    byteSize: 1,
    createdAt: '2026-08-22T00:00:00.000Z',
    kind: 'preUpdate' as const,
    state: 'validatedGood' as const,
    validatedAt: '2026-08-22T00:00:00.000Z',
  };
}

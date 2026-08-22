import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { NodeWorkspaceActivationMigrationStaging } from './nodeWorkspaceActivationMigrationStaging.js';
import { WorkspaceActivationMigrationRecoveryPoint } from './workspaceActivationMigrationRecoveryPoint.js';

const operationId = validateWorkspaceBackupImportOperationId(
  '10000000-0000-4000-8000-000000000001',
);
const profileId = '1'.repeat(64);
const chain = '2'.repeat(64);
const createdRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    createdRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('WorkspaceActivationMigrationRecoveryPoint', () => {
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
      new NodeWorkspaceActivationMigrationStaging(root),
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
      new NodeWorkspaceActivationMigrationStaging(root),
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
    new NodeWorkspaceActivationMigrationStaging(root),
  );
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

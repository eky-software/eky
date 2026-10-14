import { describe, expect, it, vi } from 'vitest';

import { RecoveryPointRestoreStagingService } from './recoveryPointRestoreStagingService.js';
import { RecoveryPointCleanupError } from '../recoveryPoint/recoveryPointOperationError.js';
import type { ProfileInspectionReceipt } from '../../runtime/profileInspectionMessages.js';

const artifactId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const migrationChainIdentity = 'a'.repeat(64);

describe('RecoveryPointRestoreStagingService', () => {
  it('does not call the Store after inspection admission closes', async () => {
    const profileSnapshotClient = createSnapshotOwner();
    profileSnapshotClient.withInspectionOperation = async () => { throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'); };
    const stageForRestore = vi.fn(async () => createStaged());
    const service = new RecoveryPointRestoreStagingService({ profileSnapshotClient, store: { stageForRestore } });
    await expect(service.stage({ artifactId, expectedMigrationChainIdentity: migrationChainIdentity, operationId }))
      .rejects.toThrow('UPDATE_RECOVERY_POINT_STAGING_FAILED');
    expect(stageForRestore).not.toHaveBeenCalled();
    expect(service.getPreparedRestore(operationId)).toBeUndefined();
  });

  it('never publishes a prepared slot after the final owner assertion fails', async () => {
    const original = new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    const profileSnapshotClient = createSnapshotOwner(original);
    const service = new RecoveryPointRestoreStagingService({ profileSnapshotClient, store: { stageForRestore: async () => createStaged() } });
    const failure = await service.stage({ artifactId, expectedMigrationChainIdentity: migrationChainIdentity, operationId })
      .catch(error => error as Error);
    expect((failure as Error).cause).toBe(original);
    expect(profileSnapshotClient.removeProfileSnapshot).toHaveBeenCalledExactlyOnceWith(operationId);
    expect(service.getPreparedRestore(operationId)).toBeUndefined();
  });

  it('keeps the first rejected receipt separate from cleanup uncertainty and refuses another staging', async () => {
    const original = new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    const profileSnapshotClient = createSnapshotOwner(original);
    profileSnapshotClient.removeProfileSnapshot.mockRejectedValueOnce(new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'));
    const stageForRestore = vi.fn(async () => createStaged());
    const service = new RecoveryPointRestoreStagingService({ profileSnapshotClient, store: { stageForRestore } });
    const input = { artifactId, expectedMigrationChainIdentity: migrationChainIdentity, operationId };
    const failure = await service.stage(input).catch(error => error as Error);
    expect((failure as Error).cause).toMatchObject({ cleanupStatus: 'unverified', cause: original });
    expect(service.getPreparedRestore(operationId)).toBeUndefined();
    await expect(service.stage(input)).rejects.toThrow('UPDATE_RECOVERY_POINT_STAGING_FAILED');
    expect(() => service.claimPreparedRestore(operationId)).toThrow('PROFILE_RESTORE_BUSY');
    expect(stageForRestore).toHaveBeenCalledOnce();
    expect(profileSnapshotClient.removeProfileSnapshot).toHaveBeenCalledOnce();
  });

  it('does not bypass the Store retention result with another cleanup or retry', async () => {
    const first = new RecoveryPointCleanupError(new Error('PROFILE_SCHEMA_UNSUPPORTED'));
    const profileSnapshotClient = createSnapshotOwner();
    const stageForRestore = vi.fn().mockRejectedValueOnce(first);
    const service = new RecoveryPointRestoreStagingService({ profileSnapshotClient, store: { stageForRestore } });
    const input = { artifactId, expectedMigrationChainIdentity: migrationChainIdentity, operationId };
    const failure = await service.stage(input).catch(error => error as Error);
    expect((failure as Error).cause).toBe(first);
    await expect(service.stage(input)).rejects.toThrow('UPDATE_RECOVERY_POINT_STAGING_FAILED');
    expect(stageForRestore).toHaveBeenCalledOnce();
    expect(profileSnapshotClient.removeProfileSnapshot).not.toHaveBeenCalled();
  });

  it('rejects competing staging before awaiting the Store and keeps its first prepared owner', async () => {
    let settle!: (value: ReturnType<typeof createStaged>) => void;
    const pending = new Promise<ReturnType<typeof createStaged>>(resolve => { settle = resolve; });
    const stageForRestore = vi.fn(() => pending);
    const service = new RecoveryPointRestoreStagingService({ profileSnapshotClient: createSnapshotOwner(), store: { stageForRestore } });
    const input = { artifactId, expectedMigrationChainIdentity: migrationChainIdentity, operationId };
    const first = service.stage(input);
    try {
      await expect(service.stage(input)).rejects.toThrow('UPDATE_RECOVERY_POINT_STAGING_FAILED');
      expect(() => service.claimPreparedRestore(operationId)).toThrow('PROFILE_RESTORE_BUSY');
      expect(stageForRestore).toHaveBeenCalledTimes(1);
    } finally {
      settle(createStaged());
      await first;
    }
    const claim = service.claimPreparedRestore(operationId)!;
    claim.preserveForRecovery();
    claim.release();
    expect(service.getPreparedRestore(operationId)).toBeUndefined();
    await expect(service.stage(input)).rejects.toThrow('UPDATE_RECOVERY_POINT_STAGING_FAILED');
    expect(stageForRestore).toHaveBeenCalledTimes(1);
  });

  it('clears only the in-flight guard on a failed Store call', async () => {
    const stageForRestore = vi.fn().mockRejectedValueOnce(new Error('synthetic failure')).mockResolvedValueOnce(createStaged());
    const service = new RecoveryPointRestoreStagingService({ profileSnapshotClient: createSnapshotOwner(), store: { stageForRestore } });
    const input = { artifactId, expectedMigrationChainIdentity: migrationChainIdentity, operationId };
    await expect(service.stage(input)).rejects.toThrow('UPDATE_RECOVERY_POINT_STAGING_FAILED');
    await expect(service.stage(input)).resolves.toMatchObject({ operationId });
    expect(stageForRestore).toHaveBeenCalledTimes(2);
  });

  it('exposes only an exact prepared restore after validated staging', async () => {
    const stageForRestore = vi.fn(async () => ({
      appVersion: '0.1.0-alpha.1',
      artifactTotalByteSize: 512,
      createdAt: '2026-08-12T10:00:00.000Z',
      documentCount: 2,
      migrationChainIdentity,
      operationRoot: 'C:\\private\\staging\\operation',
      profileId: 'b'.repeat(64),
    }));
    const service = new RecoveryPointRestoreStagingService({
      profileSnapshotClient: createSnapshotOwner(),
      store: { stageForRestore },
    });

    const prepared = await service.stage({
      artifactId,
      expectedMigrationChainIdentity: migrationChainIdentity,
      operationId,
    });

    expect(stageForRestore).toHaveBeenCalledWith({
      artifactId,
      expectedMigrationChainIdentity: migrationChainIdentity,
      operationId,
    });
    expect(prepared).toEqual({
      operationId,
      summary: {
        appVersion: '0.1.0-alpha.1',
        compatibilityStatus: 'compatible',
        createdAt: '2026-08-12T10:00:00.000Z',
        databaseHealth: 'healthy',
        documentCount: 2,
        formatVersion: 1,
        profileMatchStatus: 'same',
        totalBusinessByteSize: 512,
      },
      targetDisposition: 'replaceActiveProfile',
    });
    expect(service.getPreparedRestore(operationId)).toEqual(prepared);
    expect(
      service.getPreparedRestore('33333333-3333-4333-8333-333333333333'),
    ).toBeUndefined();
  });

  it('fails closed for invalid identities and repeated staging', async () => {
    const stageForRestore = vi.fn(async () => ({
      appVersion: '0.1.0-alpha.1',
      artifactTotalByteSize: 512,
      createdAt: '2026-08-12T10:00:00.000Z',
      documentCount: 2,
      migrationChainIdentity,
      operationRoot: 'C:\\private\\staging\\operation',
      profileId: 'b'.repeat(64),
    }));
    const service = new RecoveryPointRestoreStagingService({
      profileSnapshotClient: createSnapshotOwner(),
      store: { stageForRestore },
    });

    await expect(
      service.stage({
        artifactId: 'invalid',
        expectedMigrationChainIdentity: migrationChainIdentity,
        operationId,
      }),
    ).rejects.toThrow('UPDATE_RECOVERY_POINT_STAGING_FAILED');
    expect(stageForRestore).not.toHaveBeenCalled();

    await service.stage({
      artifactId,
      expectedMigrationChainIdentity: migrationChainIdentity,
      operationId,
    });
    await expect(
      service.stage({
        artifactId,
        expectedMigrationChainIdentity: migrationChainIdentity,
        operationId,
      }),
    ).rejects.toThrow('UPDATE_RECOVERY_POINT_STAGING_FAILED');
    expect(stageForRestore).toHaveBeenCalledTimes(1);
  });

  it('preserves the internal rejected recovery point while keeping the safe error and no prepared restore', async () => {
    const original = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    const service = new RecoveryPointRestoreStagingService({
      profileSnapshotClient: createSnapshotOwner(),
      store: { stageForRestore: vi.fn().mockRejectedValueOnce(original) },
    });

    const failure: unknown = await service.stage({
      artifactId,
      expectedMigrationChainIdentity: migrationChainIdentity,
      operationId,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: 'UPDATE_RECOVERY_POINT_STAGING_FAILED',
    });
    expect((failure as Error).cause).toBe(original);
    expect(service.getPreparedRestore(operationId)).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain(original.message);
  });
});

function createSnapshotOwner(postUseError?: Error) {
  return {
    async withInspectionOperation<T>(use: () => Promise<T>): Promise<T> { return use(); },
    async withProfileSnapshot<T>(_operationId: string, use: (receipt: ProfileInspectionReceipt) => Promise<T>): Promise<T> {
      const result = await use({
        artifactCount: 2, artifactIdentity: 'e'.repeat(64), artifactTotalByteSize: 512, databaseHealth: 'healthy',
        migrationChainIdentity, profileId: 'b'.repeat(64), migrationPolicy: 'restoreCompatible',
        database: { byteSize: 1, sha256: 'c'.repeat(64) }, artifactCatalog: { byteSize: 1, sha256: 'd'.repeat(64) },
      });
      if (postUseError !== undefined) throw postUseError;
      return result;
    },
    removeProfileSnapshot: vi.fn(async (_operationId: string) => {}),
  };
}

function createStaged() {
  return {
    appVersion: '0.1.0-alpha.1', artifactTotalByteSize: 512,
    createdAt: '2026-08-12T10:00:00.000Z', documentCount: 2,
    migrationChainIdentity, operationRoot: 'C:\\private\\staging\\operation', profileId: 'b'.repeat(64),
  };
}

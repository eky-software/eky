import { describe, expect, it, vi } from 'vitest';

import { RecoveryPointRestoreStagingService } from './recoveryPointRestoreStagingService.js';

const artifactId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const migrationChainIdentity = 'a'.repeat(64);

describe('RecoveryPointRestoreStagingService', () => {
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
});

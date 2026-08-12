import { rm } from 'node:fs/promises';

import type { RecoveryPointStore } from '../recoveryPoint/recoveryPointStore.js';
import type { PreparedProfileRestore } from './profileRestoreStagingService.js';

const artifactIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/;

interface RecoveryPointRestoreStagingServiceDependencies {
  store: Pick<RecoveryPointStore, 'stageForRestore'>;
}

export class RecoveryPointRestoreStagingService {
  private preparedRestore: PreparedProfileRestore | undefined;

  constructor(
    private readonly dependencies: RecoveryPointRestoreStagingServiceDependencies,
  ) {}

  async stage(input: {
    artifactId: string;
    expectedMigrationChainIdentity: string;
    operationId: string;
  }): Promise<PreparedProfileRestore> {
    if (
      this.preparedRestore !== undefined ||
      !artifactIdPattern.test(input.artifactId) ||
      !sha256Pattern.test(input.expectedMigrationChainIdentity) ||
      !artifactIdPattern.test(input.operationId)
    ) {
      throw new Error('UPDATE_RECOVERY_POINT_STAGING_FAILED');
    }

    let operationRoot: string | undefined;
    try {
      const staged = await this.dependencies.store.stageForRestore({
        artifactId: input.artifactId,
        expectedMigrationChainIdentity:
          input.expectedMigrationChainIdentity,
        operationId: input.operationId,
      });
      operationRoot = staged.operationRoot;
      const prepared: PreparedProfileRestore = {
        operationId: input.operationId,
        summary: {
          appVersion: staged.appVersion,
          compatibilityStatus: 'compatible',
          createdAt: staged.createdAt,
          databaseHealth: 'healthy',
          documentCount: staged.documentCount,
          formatVersion: 1,
          profileMatchStatus: 'same',
          totalBusinessByteSize: staged.artifactTotalByteSize,
        },
        targetDisposition: 'replaceActiveProfile',
      };
      this.preparedRestore = prepared;
      return prepared;
    } catch {
      if (operationRoot !== undefined) {
        await rm(operationRoot, { force: true, recursive: true }).catch(
          () => undefined,
        );
      }
      throw new Error('UPDATE_RECOVERY_POINT_STAGING_FAILED');
    }
  }

  getPreparedRestore(
    operationId: string,
  ): PreparedProfileRestore | undefined {
    return this.preparedRestore?.operationId === operationId
      ? this.preparedRestore
      : undefined;
  }
}

import { join } from 'node:path';

import type { RecoveryPointStore } from './recoveryPointStore.js';
import {
  recoveryPointRotationJournalFileName,
  RecoveryPointRotationJournalStore,
} from './recoveryPointRotationJournalStore.js';
import {
  planRecoveryPointRetention,
  recoveryPointDiskBudgetBytes,
} from './recoveryPointRetention.js';

const profileIdPattern = /^[a-f0-9]{64}$/;

export interface RecoveryPointRotationResult {
  budgetExceededAfterRotation: boolean;
  deletedCount: number;
  retainedByteSize: number;
}

export class RecoveryPointRotationService {
  constructor(
    private readonly dependencies: {
      diskBudgetBytes?: number;
      recoveryRoot: string;
      store: Pick<RecoveryPointStore, 'list' | 'remove'>;
    },
  ) {}

  async maintain(
    profileId: string,
    activeProtectedArtifactIds: readonly string[] = [],
  ): Promise<RecoveryPointRotationResult> {
    assertProfileId(profileId);
    const journalStore = this.createJournalStore(profileId);
    await this.resume(profileId, journalStore);
    const points = await this.dependencies.store.list(profileId);
    const plan = planRecoveryPointRetention(points, {
      activeProtectedArtifactIds,
      diskBudgetBytes:
        this.dependencies.diskBudgetBytes ??
        recoveryPointDiskBudgetBytes,
    });
    if (plan.deleteArtifactIds.length === 0) {
      return {
        budgetExceededAfterRotation:
          plan.budgetExceededAfterRotation,
        deletedCount: 0,
        retainedByteSize: plan.retainedByteSize,
      };
    }

    await journalStore.write({
      formatVersion: 1,
      pendingArtifactIds: plan.deleteArtifactIds,
      revision: 1,
    });
    await this.resume(profileId, journalStore);
    return {
      budgetExceededAfterRotation: plan.budgetExceededAfterRotation,
      deletedCount: plan.deleteArtifactIds.length,
      retainedByteSize: plan.retainedByteSize,
    };
  }

  async resumePending(profileId: string): Promise<number> {
    assertProfileId(profileId);
    return this.resume(profileId, this.createJournalStore(profileId));
  }

  private createJournalStore(
    profileId: string,
  ): RecoveryPointRotationJournalStore {
    return new RecoveryPointRotationJournalStore(
      join(
        this.dependencies.recoveryRoot,
        profileId,
        recoveryPointRotationJournalFileName,
      ),
    );
  }

  private async resume(
    profileId: string,
    journalStore: RecoveryPointRotationJournalStore,
  ): Promise<number> {
    let journal = await journalStore.read();
    if (journal === undefined) {
      return 0;
    }
    const originalCount = journal.pendingArtifactIds.length;
    while (journal.pendingArtifactIds.length > 0) {
      const [artifactId, ...remaining] = journal.pendingArtifactIds;
      await this.dependencies.store.remove(profileId, artifactId!);
      if (remaining.length === 0) {
        await journalStore.clear();
        return originalCount;
      }
      journal = {
        formatVersion: 1,
        pendingArtifactIds: remaining,
        revision: journal.revision + 1,
      };
      await journalStore.write(journal);
    }
    await journalStore.clear();
    return originalCount;
  }
}

function assertProfileId(profileId: string): void {
  if (!profileIdPattern.test(profileId)) {
    throw new Error('RECOVERY_POINT_ROTATION_INVALID');
  }
}

import type {
  LocalUpdatePackageCache,
  LocalUpdatePackageSummary,
} from './localUpdatePackageCache.js';
import type { UpdateJournal } from './updateJournal.js';
import type { UpdateJournalStore } from './updateJournalStore.js';

interface LocalUpdateCacheMaintenanceDependencies {
  cache: Pick<
    LocalUpdatePackageCache,
    'discardCandidate' | 'repairCurrentRegistration'
  >;
  journalStore: Pick<UpdateJournalStore, 'read'>;
}

export class LocalUpdateCacheMaintenanceError extends Error {
  constructor() {
    super('The local update cache could not be maintained safely.');
    this.name = 'LocalUpdateCacheMaintenanceError';
  }
}

export class LocalUpdateCacheMaintenance {
  private activeOperation = false;

  constructor(
    private readonly dependencies: LocalUpdateCacheMaintenanceDependencies,
  ) {}

  discardCandidate(): Promise<void> {
    return this.runExclusive(async () => {
      await this.assertNoUnresolvedUpdate();
      await this.dependencies.cache.discardCandidate();
    });
  }

  repairCurrentRegistration(
    manifestPath: string,
  ): Promise<Readonly<LocalUpdatePackageSummary>> {
    return this.runExclusive(async () => {
      await this.assertNoUnresolvedUpdate();
      return this.dependencies.cache.repairCurrentRegistration({
        manifestPath,
      });
    });
  }

  private async assertNoUnresolvedUpdate(): Promise<void> {
    const journal = await this.dependencies.journalStore.read();
    if (journal !== undefined && !isResolvedJournal(journal)) {
      throw new LocalUpdateCacheMaintenanceError();
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeOperation) {
      throw new LocalUpdateCacheMaintenanceError();
    }
    this.activeOperation = true;
    try {
      return await operation();
    } catch (error) {
      if (error instanceof LocalUpdateCacheMaintenanceError) {
        throw error;
      }
      throw new LocalUpdateCacheMaintenanceError();
    } finally {
      this.activeOperation = false;
    }
  }
}

function isResolvedJournal(journal: Readonly<UpdateJournal>): boolean {
  return (
    journal.state === 'accepted' ||
    journal.state === 'installerNotApplied' ||
    journal.state === 'rolledBack'
  );
}

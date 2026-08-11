import type { AcceptedBuildMetadataStore } from './acceptedBuildMetadataStore.js';
import type { UpdateJournalStore } from './updateJournalStore.js';

interface StateStore<T> {
  clear(): Promise<void>;
  read(): Promise<Readonly<T> | undefined>;
  write(value: Readonly<T>): Promise<void>;
}

export interface LegacyLocalUpdateStateStores {
  acceptedBuild: {
    current: Pick<AcceptedBuildMetadataStore, 'read' | 'write'>;
    legacy: Pick<AcceptedBuildMetadataStore, 'clear' | 'read'>;
  };
  journal: {
    current: Pick<UpdateJournalStore, 'read' | 'write'>;
    legacy: Pick<UpdateJournalStore, 'clear' | 'read'>;
  };
}

export async function migrateLegacyLocalUpdateState(
  stores: LegacyLocalUpdateStateStores,
): Promise<void> {
  await migrateStateValue(
    stores.acceptedBuild.current,
    stores.acceptedBuild.legacy,
  );
  await migrateStateValue(stores.journal.current, stores.journal.legacy);
}

async function migrateStateValue<T>(
  current: Pick<StateStore<T>, 'read' | 'write'>,
  legacy: Pick<StateStore<T>, 'clear' | 'read'>,
): Promise<void> {
  const currentValue = await current.read();
  const legacyValue = await legacy.read();

  if (currentValue !== undefined) {
    if (
      legacyValue !== undefined &&
      serialize(currentValue) !== serialize(legacyValue)
    ) {
      throw new Error('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT');
    }
    if (legacyValue !== undefined) {
      await legacy.clear();
    }
    return;
  }

  if (legacyValue === undefined) {
    return;
  }

  await current.write(legacyValue);
  const verified = await current.read();
  if (verified === undefined || serialize(verified) !== serialize(legacyValue)) {
    throw new Error('LOCAL_UPDATE_STATE_MIGRATION_FAILED');
  }
  await legacy.clear();
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

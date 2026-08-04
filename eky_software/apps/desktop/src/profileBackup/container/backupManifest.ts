import type { BackupContainerEntryDescriptor } from './backupContainerEntry.js';

export interface BackupManifest {
  appVersion: string;
  createdAtEpochMilliseconds: bigint;
  entries: readonly BackupContainerEntryDescriptor[];
  migrationChainIdentity: string;
  profileId: string;
}

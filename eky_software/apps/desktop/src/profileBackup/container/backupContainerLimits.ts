export const maximumBackupContainerBytes = 32n * 1024n * 1024n * 1024n;
export const maximumBackupCiphertextBytes =
  maximumBackupContainerBytes - 64n - 16n;
export const maximumBackupEntryBytes = 24n * 1024n * 1024n * 1024n;
export const maximumBackupEntryCount = 100_010;
export const maximumBackupPathBytes = 1_024;
export const maximumManifestBytes = 64 * 1024 * 1024;
export const maximumManifestTextBytes = 1_024;
export const backupStreamChunkBytes = 64 * 1024;

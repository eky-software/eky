export interface BackupKdfProfile {
  blockSize: number;
  cost: number;
  id: number;
  keyLength: 32;
  maxmem: number;
  parallelization: number;
}

export const portableBackupKdfProfile: BackupKdfProfile = Object.freeze({
  blockSize: 8,
  cost: 131_072,
  id: 1,
  keyLength: 32,
  maxmem: 256 * 1024 * 1024,
  parallelization: 1,
});

export function getBackupKdfProfile(
  profileId: number,
): BackupKdfProfile | undefined {
  return profileId === portableBackupKdfProfile.id
    ? portableBackupKdfProfile
    : undefined;
}

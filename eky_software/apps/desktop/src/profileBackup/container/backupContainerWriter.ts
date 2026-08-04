import type { BackupManifest } from './backupManifest.js';
import {
  encryptBackupPayload,
  type EncryptBackupPayloadResult,
} from './encryptBackupPayload.js';
import {
  prepareBackupPayload,
  type BackupPayloadSourceEntry,
} from './prepareBackupPayload.js';

export type BackupContainerSourceEntry = BackupPayloadSourceEntry;

export async function writeBackupContainer(input: {
  destinationPath: string;
  entries: readonly BackupContainerSourceEntry[];
  manifest: Omit<BackupManifest, 'entries'>;
  nonce?: Buffer;
  password: string;
  salt?: Buffer;
}): Promise<
  EncryptBackupPayloadResult & {
    manifest: BackupManifest;
  }
> {
  const payload = await prepareBackupPayload({
    entries: input.entries,
    manifest: input.manifest,
  });
  const encrypted = await encryptBackupPayload({
    destinationPath: input.destinationPath,
    ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
    password: input.password,
    plaintext: payload.plaintext,
    plaintextLength: payload.plaintextLength,
    ...(input.salt === undefined ? {} : { salt: input.salt }),
  });

  return { ...encrypted, manifest: payload.manifest };
}

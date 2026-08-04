import { promises as fileSystem } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { readDecryptedBackupPayload } from '../container/backupContainerReader.js';
import { extractBackupPayload } from '../container/extractBackupPayload.js';
import type { ProfileSnapshotBrokerClient } from '../profileSnapshotBrokerClient.js';
import { decryptRecoveryPointPayload } from './decryptRecoveryPointPayload.js';
import { RecoveryPointKeyEnvelopeStore } from './recoveryPointKeyEnvelopeStore.js';
import type { RecoveryPointKeyProtector } from './recoveryPointKeyProtector.js';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const profileIdPattern = /^[a-f0-9]{64}$/;

interface ProfileSnapshotValidator {
  validateProfileSnapshot(operationId: string): ReturnType<
    ProfileSnapshotBrokerClient['validateProfileSnapshot']
  >;
}

export interface RecoveryPointInspection {
  appVersion: string;
  createdAt: string;
  documentCount: number;
  migrationChainIdentity: string;
  profileId: string;
}

export async function inspectRecoveryPoint(input: {
  artifactId: string;
  containerPath: string;
  expectedProfileId: string;
  keyEnvelopePath: string;
  keyProtector: RecoveryPointKeyProtector;
  operationId: string;
  quarantineRoot: string;
  stagingRoot: string;
  validator: ProfileSnapshotValidator;
}): Promise<RecoveryPointInspection> {
  if (
    !operationIdPattern.test(input.operationId) ||
    !profileIdPattern.test(input.expectedProfileId) ||
    !isAbsolute(input.containerPath) ||
    !isAbsolute(input.keyEnvelopePath) ||
    !isAbsolute(input.quarantineRoot) ||
    !isAbsolute(input.stagingRoot)
  ) {
    throw new Error('RECOVERY_POINT_INSPECTION_UNAVAILABLE');
  }

  const quarantinePath = join(
    input.quarantineRoot,
    `${input.operationId}.recovery-payload`,
  );
  const operationRoot = join(input.stagingRoot, input.operationId);
  const envelopeStore = new RecoveryPointKeyEnvelopeStore(
    input.artifactId,
    input.keyEnvelopePath,
  );
  let dataKey: Buffer | undefined;
  let decrypted = false;
  let extracted = false;

  try {
    const protectedKey = await envelopeStore.read();
    const unprotected = await input.keyProtector.unprotect(protectedKey);
    dataKey = unprotected.dataKey;
    await decryptRecoveryPointPayload({
      containerPath: input.containerPath,
      dataKey,
      quarantinePath,
    });
    decrypted = true;
    const parsed = await readDecryptedBackupPayload(quarantinePath);
    await extractBackupPayload({
      operationRoot,
      parsedPayload: parsed,
      payloadPath: quarantinePath,
    });
    extracted = true;

    const validation = await input.validator.validateProfileSnapshot(
      input.operationId,
    );
    if (
      parsed.manifest.profileId !== input.expectedProfileId ||
      validation.profileId !== parsed.manifest.profileId ||
      validation.migrationChainIdentity !==
        parsed.manifest.migrationChainIdentity ||
      validation.databaseHealth !== 'healthy'
    ) {
      throw new Error('RECOVERY_POINT_CONTENT_INVALID');
    }

    if (unprotected.shouldReEncrypt) {
      await envelopeStore.write(
        await input.keyProtector.protect(dataKey),
      );
    }

    return {
      appVersion: parsed.manifest.appVersion,
      createdAt: new Date(
        Number(parsed.manifest.createdAtEpochMilliseconds),
      ).toISOString(),
      documentCount: validation.artifactCount,
      migrationChainIdentity:
        parsed.manifest.migrationChainIdentity,
      profileId: parsed.manifest.profileId,
    };
  } finally {
    dataKey?.fill(0);
    if (extracted) {
      await fileSystem
        .rm(operationRoot, { force: true, recursive: true })
        .catch(() => undefined);
    }
    if (decrypted) {
      await fileSystem
        .rm(quarantinePath, { force: true })
        .catch(() => undefined);
    }
  }
}

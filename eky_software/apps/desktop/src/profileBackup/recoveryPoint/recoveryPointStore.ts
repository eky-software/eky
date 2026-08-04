import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  link,
  mkdir,
  realpath,
  rm,
  stat,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type { BackupManifest } from '../container/backupManifest.js';
import {
  prepareBackupPayload,
  type BackupPayloadSourceEntry,
} from '../container/prepareBackupPayload.js';
import type { ProfileSnapshotBrokerClient } from '../profileSnapshotBrokerClient.js';
import { encryptRecoveryPointPayload } from './encryptRecoveryPointPayload.js';
import { inspectRecoveryPoint } from './inspectRecoveryPoint.js';
import {
  recoveryPointIndexFileName,
  RecoveryPointIndexStore,
  type RecoveryPointIndexEntry,
  type RecoveryPointKind,
} from './recoveryPointIndexStore.js';
import { RecoveryPointKeyEnvelopeStore } from './recoveryPointKeyEnvelopeStore.js';
import type { RecoveryPointKeyProtector } from './recoveryPointKeyProtector.js';
import { recoveryPointDataKeyLength } from './recoveryPointContainerHeader.js';

const profileIdPattern = /^[a-f0-9]{64}$/;
const artifactIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recoveryPointExtension = '.ekyrecovery';

interface RecoveryPointStoreDependencies {
  artifactIdFactory?(): string;
  inspectionOperationIdFactory?(): string;
  keyProtector: RecoveryPointKeyProtector;
  quarantineRoot: string;
  recoveryRoot: string;
  stagingRoot: string;
  validator: Pick<
    ProfileSnapshotBrokerClient,
    'validateProfileSnapshot'
  >;
}

export class RecoveryPointStore {
  constructor(
    private readonly dependencies: RecoveryPointStoreDependencies,
  ) {
    if (
      !isAbsolute(dependencies.recoveryRoot) ||
      !isAbsolute(dependencies.quarantineRoot) ||
      !isAbsolute(dependencies.stagingRoot)
    ) {
      throw new Error('RECOVERY_POINT_STORE_UNAVAILABLE');
    }
  }

  async create(input: {
    entries: readonly BackupPayloadSourceEntry[];
    kind: RecoveryPointKind;
    manifest: Omit<BackupManifest, 'entries'>;
    validatedAt: string;
  }): Promise<RecoveryPointIndexEntry> {
    const profileId = input.manifest.profileId;
    if (
      !profileIdPattern.test(profileId) ||
      !isIsoDate(input.validatedAt)
    ) {
      throw new Error('RECOVERY_POINT_INPUT_INVALID');
    }

    const artifactId =
      this.dependencies.artifactIdFactory?.() ?? randomUUID();
    const inspectionOperationId =
      this.dependencies.inspectionOperationIdFactory?.() ??
      randomUUID();
    if (
      !artifactIdPattern.test(artifactId) ||
      !artifactIdPattern.test(inspectionOperationId)
    ) {
      throw new Error('RECOVERY_POINT_INPUT_INVALID');
    }

    const profileRoot = join(
      this.dependencies.recoveryRoot,
      profileId,
    );
    await ensurePrivateDirectory(this.dependencies.recoveryRoot);
    await ensurePrivateDirectory(profileRoot);
    const indexStore = new RecoveryPointIndexStore(
      join(profileRoot, recoveryPointIndexFileName),
    );
    const currentIndex = await indexStore.read();
    if (
      currentIndex.points.some(
        (point) => point.artifactId === artifactId,
      )
    ) {
      throw new Error('RECOVERY_POINT_ALREADY_EXISTS');
    }

    const containerPath = join(
      profileRoot,
      `${artifactId}${recoveryPointExtension}`,
    );
    const temporaryContainerPath = `${containerPath}.next`;
    const keyEnvelopePath = join(
      profileRoot,
      `${artifactId}.key.json`,
    );
    const keyEnvelopeStore = new RecoveryPointKeyEnvelopeStore(
      artifactId,
      keyEnvelopePath,
    );
    const dataKey = randomBytes(recoveryPointDataKeyLength);
    let finalCreated = false;
    let keyCreated = false;
    let indexed = false;

    try {
      const payload = await prepareBackupPayload({
        entries: input.entries,
        manifest: input.manifest,
      });
      const encrypted = await encryptRecoveryPointPayload({
        dataKey,
        destinationPath: temporaryContainerPath,
        plaintext: payload.plaintext,
        plaintextLength: payload.plaintextLength,
      });
      await keyEnvelopeStore.write(
        await this.dependencies.keyProtector.protect(dataKey),
      );
      keyCreated = true;
      await link(temporaryContainerPath, containerPath);
      finalCreated = true;
      await rm(temporaryContainerPath, { force: true });

      const inspection = await inspectRecoveryPoint({
        artifactId,
        containerPath,
        expectedProfileId: profileId,
        keyEnvelopePath,
        keyProtector: this.dependencies.keyProtector,
        operationId: inspectionOperationId,
        quarantineRoot: this.dependencies.quarantineRoot,
        stagingRoot: this.dependencies.stagingRoot,
        validator: this.dependencies.validator,
      });
      if (
        inspection.createdAt !==
          new Date(
            Number(input.manifest.createdAtEpochMilliseconds),
          ).toISOString() ||
        inspection.migrationChainIdentity !==
          input.manifest.migrationChainIdentity
      ) {
        throw new Error('RECOVERY_POINT_SELF_INSPECTION_FAILED');
      }

      const fileMetadata = await stat(containerPath);
      if (
        !fileMetadata.isFile() ||
        fileMetadata.isSymbolicLink() ||
        fileMetadata.nlink !== 1
      ) {
        throw new Error('RECOVERY_POINT_FILE_INVALID');
      }
      const point: RecoveryPointIndexEntry = {
        artifactId,
        byteSize: Number(encrypted.byteLength),
        createdAt: inspection.createdAt,
        kind: input.kind,
        state: 'validatedGood',
        validatedAt: input.validatedAt,
      };
      await indexStore.write({
        formatVersion: 1,
        points: [...currentIndex.points, point],
        revision: currentIndex.revision + 1,
      });
      indexed = true;
      return point;
    } finally {
      dataKey.fill(0);
      await rm(temporaryContainerPath, { force: true }).catch(
        () => undefined,
      );
      if (!indexed) {
        if (finalCreated) {
          await rm(containerPath, { force: true }).catch(
            () => undefined,
          );
        }
        if (keyCreated) {
          await keyEnvelopeStore.remove().catch(() => undefined);
        }
      }
    }
  }

  async list(profileId: string): Promise<
    readonly RecoveryPointIndexEntry[]
  > {
    if (!profileIdPattern.test(profileId)) {
      throw new Error('RECOVERY_POINT_INPUT_INVALID');
    }
    const profileRoot = join(
      this.dependencies.recoveryRoot,
      profileId,
    );
    await ensurePrivateDirectory(this.dependencies.recoveryRoot);
    await ensurePrivateDirectory(profileRoot);
    return (
      await new RecoveryPointIndexStore(
        join(profileRoot, recoveryPointIndexFileName),
      ).read()
    ).points;
  }

  async remove(
    profileId: string,
    artifactId: string,
  ): Promise<void> {
    if (
      !profileIdPattern.test(profileId) ||
      !artifactIdPattern.test(artifactId)
    ) {
      throw new Error('RECOVERY_POINT_INPUT_INVALID');
    }
    const profileRoot = join(
      this.dependencies.recoveryRoot,
      profileId,
    );
    const indexStore = new RecoveryPointIndexStore(
      join(profileRoot, recoveryPointIndexFileName),
    );
    const currentIndex = await indexStore.read();
    if (
      !currentIndex.points.some(
        (point) => point.artifactId === artifactId,
      )
    ) {
      return;
    }
    await Promise.all([
      rm(
        join(
          profileRoot,
          `${artifactId}${recoveryPointExtension}`,
        ),
        { force: true },
      ),
      new RecoveryPointKeyEnvelopeStore(
        artifactId,
        join(profileRoot, `${artifactId}.key.json`),
      ).remove(),
    ]);
    await indexStore.write({
      formatVersion: 1,
      points: currentIndex.points.filter(
        (point) => point.artifactId !== artifactId,
      ),
      revision: currentIndex.revision + 1,
    });
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw new Error('RECOVERY_POINT_STORE_UNAVAILABLE');
  }
  const real = await realpath(path);
  if (!pathsAreEqual(real, path)) {
    throw new Error('RECOVERY_POINT_STORE_UNAVAILABLE');
  }
  await chmod(path, 0o700);
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}

function isIsoDate(value: string): boolean {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

export const recoveryPointFileExtension = recoveryPointExtension;

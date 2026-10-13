import { promises as fileSystem } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPortableProfileBackupFileName,
  ensurePortableProfileBackupExtension,
  PortableProfileBackupError,
  PortableProfileBackupService,
} from './portableProfileBackup.js';
import { createProfileBackupSourceEntries } from './createProfileBackupSourceEntries.js';
import type { ProfileInspectionReceipt } from '../runtime/profileInspectionMessages.js';
import { createProfileSnapshotArtifactIdentity } from '../runtime/profileInspectionArtifactIdentity.js';

const password = 'Synthetic backup password 2026!';
const migrationChainIdentity = 'a'.repeat(64);
const profileId = 'b'.repeat(64);
const roots: string[] = [];

type RecordSuccessfulBackup = (input: {
  appVersion: string;
  backupFormatVersion: 1;
  completedAt: string;
  validationStatus: 'validated';
}) => Promise<void>;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('portable profile backup', () => {
  it('creates, self-inspects and reports a portable encrypted backup', async () => {
    const fixture = await createFixture();

    const summary = await fixture.service.create({
      destinationPath: fixture.destinationPath,
      password,
    });

    expect(summary).toMatchObject({
      databaseHealth: 'healthy',
      documentCount: 0,
      profileMatchStatus: 'same',
    });
    expect(
      (await readFile(fixture.destinationPath)).subarray(0, 8).toString(),
    ).toBe('EKYBKP01');
    expect(fixture.beginMaintenance).toHaveBeenCalledTimes(1);
    expect(fixture.endMaintenance).toHaveBeenCalledTimes(1);
    expect(fixture.recordSuccessfulBackup).toHaveBeenCalledWith({
      appVersion: '0.1.0-alpha.1',
      backupFormatVersion: 1,
      completedAt: '2026-08-04T12:00:00.000Z',
      validationStatus: 'validated',
    });
    expect(fixture.service.getStatus()).toEqual({
      latestSuccessfulPortableBackupAt: '2026-08-04T12:00:00.000Z',
      operationState: 'idle',
    });
    await expect(
      access(join(fixture.stagingRoot, firstOperationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('BACKUP-WRITER-001 @critical never overwrites an existing destination', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.destinationPath, 'existing backup');

    await expect(
      fixture.service.create({
        destinationPath: fixture.destinationPath,
        password,
      }),
    ).rejects.toMatchObject({
      code: 'PROFILE_BACKUP_DESTINATION_INVALID',
    });

    await expect(readFile(fixture.destinationPath, 'utf8')).resolves.toBe(
      'existing backup',
    );
    expect(fixture.beginMaintenance).not.toHaveBeenCalled();
  });

  it('removes the final artifact and releases maintenance when self-inspection fails', async () => {
    const fixture = await createFixture({
      validationByOperationId: {
        [inspectionOperationId]: createValidation({ artifactCount: 1 }),
      },
    });

    await expect(
      fixture.service.create({
        destinationPath: fixture.destinationPath,
        password,
      }),
    ).rejects.toThrow();

    await expect(access(fixture.destinationPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(fixture.endMaintenance).toHaveBeenCalledTimes(1);
    expect(fixture.service.getStatus()).toMatchObject({
      operationState: 'idle',
    });
  });

  it.each([
    'PROFILE_SCHEMA_UNSUPPORTED',
    'synthetic private snapshot detail',
  ])('preserves the internal snapshot failure through the create error: %s', async (causeCode) => {
    const fixture = await createFixture();
    const original = new Error(causeCode);
    fixture.validateProfileSnapshot.mockRejectedValueOnce(original);

    const failure: unknown = await fixture.service.create({
      destinationPath: fixture.destinationPath,
      password,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'PROFILE_BACKUP_CREATE_FAILED',
      message: 'PROFILE_BACKUP_CREATE_FAILED',
    });
    expect((failure as Error).cause).toBe(original);
    expect(JSON.stringify(failure)).not.toContain(causeCode);
    expect(fixture.service.getStatus()).toEqual({
      lastSafeErrorCode: 'PROFILE_BACKUP_CREATE_FAILED',
      operationState: 'idle',
    });
    expect(fixture.endMaintenance).toHaveBeenCalledTimes(1);
  });

  it('keeps create-source failure and cleanup uncertainty separate without losing the first cause', async () => {
    const fixture = await createFixture();
    const original = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    fixture.validateProfileSnapshot.mockRejectedValueOnce(original);
    fixture.removeProfileSnapshot.mockRejectedValueOnce(new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'));
    const error = await fixture.service.create({ destinationPath: fixture.destinationPath, password })
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'PROFILE_BACKUP_CREATE_FAILED', cleanupStatus: 'unverified' });
    expect((error as Error).cause).toBe(original);
    expect(JSON.stringify(error)).not.toContain(original.message);
    expect(fixture.removeProfileSnapshot).toHaveBeenCalledOnce();
    await expect(access(join(fixture.stagingRoot, firstOperationId))).resolves.toBeUndefined();
  });

  it('does not repeat uncertain source removal or mark a completed container successful', async () => {
    const fixture = await createFixture();
    const original = new Error('synthetic private source cleanup detail');
    const remove = fixture.removeProfileSnapshot.getMockImplementation()!;
    fixture.removeProfileSnapshot.mockImplementation(async operationId => {
      if (operationId === firstOperationId) throw original;
      await remove(operationId);
    });
    const error = await fixture.service.create({ destinationPath: fixture.destinationPath, password })
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'PROFILE_BACKUP_CREATE_FAILED', cleanupStatus: 'unverified' });
    expect((error as Error).cause).toBe(original);
    expect(fixture.removeProfileSnapshot.mock.calls.filter(([id]) => id === firstOperationId)).toHaveLength(1);
    expect(fixture.recordSuccessfulBackup).not.toHaveBeenCalled();
    expect(fixture.service.getStatus()).not.toHaveProperty('latestSuccessfulPortableBackupAt');
    await expect(access(fixture.destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(fixture.stagingRoot, firstOperationId))).resolves.toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(original.message);
  });

  it('preserves the inspection cleanup exception through the safe inspection error', async () => {
    const fixture = await createFixture();
    await fixture.service.create({ destinationPath: fixture.destinationPath, password });
    const original = new Error('synthetic private cleanup detail');
    const remove = fileSystem.rm;
    const cleanup = vi.spyOn(fileSystem, 'rm').mockImplementation(async (path, options) => {
      if (path === join(fixture.stagingRoot, repeatedInspectionOperationId)) {
        throw original;
      }
      await remove(path, options);
    });
    try {
      const failure: unknown = await fixture.service.inspect({
        containerPath: fixture.destinationPath,
        password,
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: 'BACKUP_INSPECTION_UNAVAILABLE',
        message: 'BACKUP_INSPECTION_UNAVAILABLE',
        cleanupStatus: 'unverified',
      });
      expect(((failure as Error).cause as Error).cause).toBe(original);
      expect(fixture.service.getStatus()).toMatchObject({
        lastSafeErrorCode: 'BACKUP_INSPECTION_UNAVAILABLE',
        operationState: 'idle',
      });
      expect(JSON.stringify(failure)).not.toContain(original.message);
    } finally {
      cleanup.mockRestore();
    }
  });

  it('rejects forbidden destinations and concurrent operations', async () => {
    const fixture = await createFixture({
      forbiddenRoots: [],
      waitForSnapshot: true,
    });
    const createPromise = fixture.service.create({
      destinationPath: fixture.destinationPath,
      password,
    });
    await fixture.snapshotStarted;

    await expect(
      fixture.service.inspect({
        containerPath: fixture.destinationPath,
        password,
      }),
    ).rejects.toEqual(
      new PortableProfileBackupError('PROFILE_BACKUP_BUSY'),
    );

    fixture.releaseSnapshot();
    await createPromise;

    const forbiddenFixture = await createFixture();
    await expect(
      forbiddenFixture.service.create({
        destinationPath: join(
          forbiddenFixture.stagingRoot,
          'forbidden.ekybackup',
        ),
        password,
      }),
    ).rejects.toMatchObject({
      code: 'PROFILE_BACKUP_DESTINATION_INVALID',
    });
  });

  it('uses a non-identifying filename and appends only the expected extension', () => {
    expect(
      createPortableProfileBackupFileName(
        new Date('2026-08-04T12:00:00.000Z'),
      ),
    ).toBe('Eky-varmuuskopio-2026-08-04.ekybackup');
    expect(ensurePortableProfileBackupExtension('backup')).toBe(
      'backup.ekybackup',
    );
    expect(ensurePortableProfileBackupExtension('backup.EKYBACKUP')).toBe(
      'backup.EKYBACKUP',
    );
  });

  it('restores the latest successful timestamp without storing a destination path', async () => {
    const fixture = await createFixture({
      initialLatestSuccessfulPortableBackupAt:
        '2026-07-01T10:00:00.000Z',
    });

    expect(fixture.service.getStatus()).toEqual({
      latestSuccessfulPortableBackupAt: '2026-07-01T10:00:00.000Z',
      operationState: 'idle',
    });
  });

  it('keeps a validated backup successful if safe status persistence is unavailable', async () => {
    const fixture = await createFixture({
      recordSuccessfulBackup: vi.fn(async () => {
        throw new Error('synthetic status persistence failure');
      }),
    });

    await expect(
      fixture.service.create({
        destinationPath: fixture.destinationPath,
        password,
      }),
    ).resolves.toMatchObject({ databaseHealth: 'healthy' });
    await expect(readFile(fixture.destinationPath)).resolves.toBeDefined();
  });
});

const firstOperationId = '11111111-1111-4111-8111-111111111111';
const inspectionOperationId = '22222222-2222-4222-8222-222222222222';
const temporaryOperationId = '33333333-3333-4333-8333-333333333333';
const repeatedInspectionOperationId = '44444444-4444-4444-8444-444444444444';

async function createFixture(options: {
  forbiddenRoots?: readonly string[];
  initialLatestSuccessfulPortableBackupAt?: string;
  recordSuccessfulBackup?: RecordSuccessfulBackup;
  validationByOperationId?: Record<
    string,
    ReturnType<typeof createValidation>
  >;
  waitForSnapshot?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-portable-backup-'));
  roots.push(root);
  const stagingRoot = join(root, 'staging');
  const quarantineRoot = join(root, 'quarantine');
  const destinationDirectory = join(root, 'destination');
  await Promise.all([
    mkdir(stagingRoot, { mode: 0o700 }),
    mkdir(quarantineRoot, { mode: 0o700 }),
    mkdir(destinationDirectory),
  ]);
  const beginMaintenance = vi.fn(async () => 'busy' as const);
  const endMaintenance = vi.fn(async () => 'normal' as const);
  let releaseSnapshot: () => void = () => {};
  let markSnapshotStarted: () => void = () => {};
  const snapshotStarted = new Promise<void>((resolve) => {
    markSnapshotStarted = () => resolve();
  });
  const snapshotRelease = new Promise<void>((resolve) => {
    releaseSnapshot = () => resolve();
  });
  const createProfileSnapshot = vi.fn(async (operationId: string) => {
    const operationRoot = join(stagingRoot, operationId);
    await mkdir(operationRoot, { mode: 0o700 });
    await writeFile(join(operationRoot, 'profile.sqlite'), 'sqlite');
    await writeFile(
      join(operationRoot, 'snapshot-catalog-v1.json'),
      '{"artifacts":[]}',
    );
    markSnapshotStarted();
    if (options.waitForSnapshot) {
      await snapshotRelease;
    }
    return {
      artifactCatalog: {
        artifactCount: 0,
        artifactTotalByteSize: 0,
        catalogByteSize: 16,
        logicalPath: 'snapshot-catalog-v1.json' as const,
        sha256: 'c'.repeat(64),
      },
      database: {
        databaseByteSize: 6,
        logicalPath: 'profile.sqlite' as const,
        sha256: 'd'.repeat(64),
        totalPages: 1,
      },
      type: 'profileSnapshot' as const,
    };
  });
  const validateProfileSnapshot = vi.fn(async (operationId: string) =>
    options.validationByOperationId?.[operationId] ??
      createValidation(),
  );
  const operationIds = [
    firstOperationId,
    inspectionOperationId,
    temporaryOperationId,
    repeatedInspectionOperationId,
  ];
  const recordSuccessfulBackup: RecordSuccessfulBackup =
    options.recordSuccessfulBackup ?? vi.fn(async () => undefined);
  const removeProfileSnapshot = vi.fn(async (operationId: string) => {
    await fileSystem.rm(join(stagingRoot, operationId), { force: true, recursive: true });
  });
  const service = new PortableProfileBackupService({
    appVersion: '0.1.0-alpha.1',
    forbiddenRoots: options.forbiddenRoots ?? [stagingRoot],
    ...(options.initialLatestSuccessfulPortableBackupAt === undefined
      ? {}
      : {
          initialLatestSuccessfulPortableBackupAt:
            options.initialLatestSuccessfulPortableBackupAt,
        }),
    now: () => new Date('2026-08-04T12:00:00.000Z'),
    operationIdFactory: () => operationIds.shift()!,
    profileSnapshotClient: {
      beginMaintenance,
      createProfileSnapshot,
      endMaintenance,
      validateProfileSnapshot,
      withInspectionOperation: operation => operation(),
      async withProfileSnapshot<T>(operationId: string, use: (receipt: ProfileInspectionReceipt) => Promise<T>) {
        const entries = await createProfileBackupSourceEntries(join(stagingRoot, operationId));
        const database = entries.find(entry => entry.type === 'database')!;
        const artifactCatalog = entries.find(entry => entry.type === 'artifactCatalog')!;
        const artifacts = entries.filter(entry => entry.type === 'businessArtifact');
        return use({ artifactCount: artifacts.length,
          artifactIdentity: createProfileSnapshotArtifactIdentity(artifacts.map(entry => ({
            logicalPath: entry.logicalPath, byteSize: Number(entry.contentLength), sha256: entry.sha256,
          }))),
          artifactTotalByteSize: Number(artifacts.reduce((sum, entry) => sum + entry.contentLength, 0n)),
          databaseHealth: 'healthy', migrationChainIdentity, profileId,
          migrationPolicy: 'restoreCompatible',
          database: { byteSize: Number(database.contentLength), sha256: database.sha256 },
          artifactCatalog: { byteSize: Number(artifactCatalog.contentLength), sha256: artifactCatalog.sha256 } });
      },
      removeProfileSnapshot,
    },
    quarantineRoot,
    recordSuccessfulBackup,
    stagingRoot,
  });

  return {
    beginMaintenance,
    destinationPath: join(destinationDirectory, 'backup.ekybackup'),
    endMaintenance,
    quarantineRoot,
    recordSuccessfulBackup,
    releaseSnapshot,
    removeProfileSnapshot,
    service,
    snapshotStarted,
    stagingRoot,
    validateProfileSnapshot,
  };
}

function createValidation(overrides: {
  artifactCount?: number;
} = {}) {
  return {
    activeProfileIsEmpty: false,
    artifactCount: overrides.artifactCount ?? 0,
    artifactTotalByteSize: 0,
    databaseHealth: 'healthy' as const,
    migrationChainIdentity,
    profileId,
    profileMatchesActive: true,
    type: 'profileSnapshotValidation' as const,
  };
}

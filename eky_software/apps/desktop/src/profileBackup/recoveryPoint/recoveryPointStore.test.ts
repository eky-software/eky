import { promises as fileSystem } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProfileBackupSourceEntries } from '../createProfileBackupSourceEntries.js';
import type { ProfileInspectionReceipt } from '../../runtime/profileInspectionMessages.js';
import { readProfileInspectionFailureCause } from '../../runtime/profileInspectionFailure.js';
import { validateWorkspaceBackupImportOperationId } from '../../workspaces/import/workspaceBackupImportOperationId.js';
import { WorkspaceActivationMigrationRecoveryPoint } from '../../workspaces/update/workspaceActivationMigrationRecoveryPoint.js';
import { RecoveryPointKeyProtector } from './recoveryPointKeyProtector.js';
import {
  recoveryPointFileExtension,
  RecoveryPointStore,
} from './recoveryPointStore.js';

const roots: string[] = [];
const artifactId = '11111111-1111-4111-8111-111111111111';
const inspectionOperationId =
  '22222222-2222-4222-8222-222222222222';
const restoreOperationId =
  '33333333-3333-4333-8333-333333333333';
const profileId = 'a'.repeat(64);
const migrationChainIdentity = 'b'.repeat(64);
const snapshotCreatedAt = '2026-04-05T12:00:00.000Z';

afterEach(async ({ task }) => {
  vi.restoreAllMocks();
  if (task.result?.state !== 'pass') { roots.splice(0); return; }
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('recovery point store', () => {
  it('retains quarantine when guarded snapshot removal fails despite valid binding authority', async () => {
    const fixture = await createFixture();
    await createPoint(fixture, 'preUpdate');
    fixture.remove.mockClear();
    const primary = new Error('SYNTHETIC_VALIDATION_FAILED');
    fixture.validate.mockRejectedValueOnce(primary);
    fixture.remove.mockRejectedValueOnce(new Error('SYNTHETIC_SNAPSHOT_CLOSE_FAILED'));
    const removals = vi.spyOn(fileSystem, 'rm');
    await expect(fixture.store.stageForRestore({
      artifactId, expectedMigrationChainIdentity: migrationChainIdentity, operationId: restoreOperationId,
      cleanupAuthority: { assertOwned: async () => {}, assertCurrent: () => {} },
    })).rejects.toMatchObject({ cleanupStatus: 'unverified', cause: primary });
    expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(restoreOperationId);
    const quarantinePath = join(fixture.quarantineRoot, `${restoreOperationId}.recovery-payload`);
    expect(removals.mock.calls.map(([path]) => String(path))).not.toContain(quarantinePath);
    expect(removals.mock.calls.map(([path]) => String(path))).not.toContain(join(fixture.stagingRoot, restoreOperationId));
    expect(await readFile(join(fixture.stagingRoot, restoreOperationId, 'profile.sqlite'), 'utf8'))
      .toBe('synthetic-sqlite-profile');
    const quarantine = await readFile(quarantinePath);
    expect(quarantine.includes(Buffer.from('synthetic-sqlite-profile'))).toBe(true);
  });

  it.each([
    ['decrypt', 'destination'], ['decrypt', 'source'],
    ['extract', 'destination'], ['extract', 'source'],
  ] as const)('retains guarded evidence through materialization and migration fallback after %s %s close loss', async (phase, target) => {
    const fixture = await createFixture();
    const point = await createPoint(fixture, 'preUpdate');
    fixture.remove.mockClear();
    fixture.validate.mockClear();
    const container = await readFile(fixture.containerPath);
    const envelope = await readFile(fixture.keyEnvelopePath);
    const quarantinePath = join(fixture.quarantineRoot, `${restoreOperationId}.recovery-payload`);
    const operationRoot = join(fixture.stagingRoot, restoreOperationId);
    const primary = new Error('SYNTHETIC_SYNC_FAILED');
    const closeError = new Error('SYNTHETIC_CLOSE_FAILED');
    const open = fileSystem.open.bind(fileSystem);
    const removals = vi.spyOn(fileSystem, 'rm');
    let temporaryPath = '';
    let closeCalls = 0;
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      const path = String(args[0]);
      const writer = args[1] === 'wx' && (phase === 'decrypt'
        ? path === quarantinePath : path.startsWith(operationRoot) && path.endsWith('.next'));
      const reader = args[1] === 'r' && path === (phase === 'decrypt' ? fixture.containerPath : quarantinePath);
      if (writer) {
        temporaryPath = path;
        vi.spyOn(handle, 'sync').mockRejectedValueOnce(primary);
      }
      if (target === 'destination' ? writer : reader) {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          await close();
          // The payload parser closes its reader before extraction starts.
          if (temporaryPath !== '') {
            closeCalls++;
            throw closeError;
          }
        });
      }
      return handle;
    });
    const fallback = vi.fn(async () => { await rm(operationRoot, { force: true, recursive: true }); });
    const recovery = new WorkspaceActivationMigrationRecoveryPoint(
      { createPreMigration: async () => point }, fixture.store,
      { assertOperationRoot: async () => {}, removeOperationRoot: fallback });
    const error = await recovery.createAndStage({
      expectedMigrationChainIdentity: migrationChainIdentity, expectedProfileId: profileId,
      operationId: validateWorkspaceBackupImportOperationId(restoreOperationId),
      cleanupAuthority: { assertOwned: async () => {}, assertCurrent: () => {} },
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({ cause: { cleanupStatus: 'unverified', cause: { errors: [primary, closeError] } } });
    expect(closeCalls).toBe(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(fixture.remove).not.toHaveBeenCalled();
    expect(fixture.validate).not.toHaveBeenCalled();
    expect(removals).not.toHaveBeenCalled();
    const quarantine = await readFile(quarantinePath);
    expect(quarantine.includes(Buffer.from('synthetic-sqlite-profile'))).toBe(true);
    if (phase === 'extract') {
      expect(await readFile(temporaryPath, 'utf8')).toBe('synthetic-sqlite-profile');
    }
    expect(await readFile(fixture.containerPath)).toEqual(container);
    expect(await readFile(fixture.keyEnvelopePath)).toEqual(envelope);
  });

  it('binds restored staging cleanup and preserves plaintext when that owner is lost', async () => {
    const f = await createFixture();
    await createPoint(f, 'preUpdate');
    f.remove.mockClear();
    const primary = new Error('SYNTHETIC_VALIDATION_FAILED');
    let current = true;
    const assertCurrent = () => { if (!current) throw new Error('SYNTHETIC_AUTHORITY_LOST'); };
    f.validate.mockImplementationOnce(async () => { current = false; throw primary; });
    const error = await f.store.stageForRestore({ artifactId, expectedMigrationChainIdentity: migrationChainIdentity,
      operationId: restoreOperationId, cleanupAuthority: { assertOwned: async () => assertCurrent(), assertCurrent } })
      .catch(error => error);
    expect(error).toMatchObject({ cleanupStatus: 'unverified', cause: primary });
    expect(f.remove).not.toHaveBeenCalled();
    expect(await readFile(join(f.stagingRoot, restoreOperationId, 'profile.sqlite'), 'utf8'))
      .toBe('synthetic-sqlite-profile');
    expect((await readFile(join(f.quarantineRoot, `${restoreOperationId}.recovery-payload`))).byteLength).toBeGreaterThan(0);
    expect(await readFile(f.containerPath)).toBeDefined();
  });

  it('keeps exact restored bytes with a valid cleanup authority and removes only quarantine', async () => {
    const f = await createFixture();
    await createPoint(f, 'preUpdate');
    f.remove.mockClear();
    const authority = { assertOwned: vi.fn(async () => {}), assertCurrent: vi.fn(() => {}) };
    await f.store.stageForRestore({ artifactId, expectedMigrationChainIdentity: migrationChainIdentity,
      operationId: restoreOperationId, cleanupAuthority: authority });
    expect(f.validate).toHaveBeenLastCalledWith(restoreOperationId, undefined, expect.objectContaining({
      assertOwned: expect.any(Function), assertCurrent: expect.any(Function),
    }));
    expect(f.remove).not.toHaveBeenCalled();
    expect(await readFile(join(f.stagingRoot, restoreOperationId, 'profile.sqlite'), 'utf8'))
      .toBe('synthetic-sqlite-profile');
    await expect(readFile(join(f.quarantineRoot, `${restoreOperationId}.recovery-payload`)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses the required ownership scope and removes self-inspection staging once', async () => {
    const fixture = await createFixture();
    await createPoint(fixture);
    expect(fixture.ownershipCalls).toEqual(['entered', 'validated', 'used', 'left', 'removed']);
    expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(inspectionOperationId);
    await expect(readdir(fixture.stagingRoot)).resolves.toEqual([]);
  });

  it('does not decrypt or validate when inspection admission is closed', async () => {
    const fixture = await createFixture();
    fixture.validator.withInspectionOperation = async () => {
      throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    };
    await expect(createPoint(fixture)).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    expect(fixture.decrypt).not.toHaveBeenCalled();
    expect(fixture.validate).not.toHaveBeenCalled();
    expect(fixture.remove).not.toHaveBeenCalled();
    await expect(fixture.store.list(profileId)).resolves.toEqual([]);
  });

  it('preserves the first validation cause and all encrypted evidence when cleanup is unverified', async () => {
    const fixture = await createFixture();
    const primary = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    fixture.validate.mockRejectedValueOnce(primary);
    fixture.remove.mockRejectedValueOnce(new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'));
    const error = await createPoint(fixture).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ cleanupStatus: 'unverified', cause: primary });
    expect(readProfileInspectionFailureCause(error)).toBe('PROFILE_SCHEMA_UNSUPPORTED');
    expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(inspectionOperationId);
    expect(fixture.withSnapshot).not.toHaveBeenCalled();
    await expect(readFile(join(fixture.stagingRoot, inspectionOperationId, 'profile.sqlite'), 'utf8'))
      .resolves.toBe('synthetic-sqlite-profile');
    await expect(readFile(fixture.containerPath)).resolves.toBeInstanceOf(Buffer);
    await expect(readFile(fixture.keyEnvelopePath)).resolves.toBeInstanceOf(Buffer);
    await expect(fixture.store.list(profileId)).resolves.toEqual([]);
  });

  it('removes rejected staging only through its owner after a settled validation failure', async () => {
    const fixture = await createFixture();
    const primary = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    fixture.validate.mockRejectedValueOnce(primary);
    await expect(createPoint(fixture)).rejects.toBe(primary);
    expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(inspectionOperationId);
    await expect(readdir(fixture.stagingRoot)).resolves.toEqual([]);
    await expect(readFile(fixture.containerPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(fixture.keyEnvelopePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not index a valid inspection when its final owned removal fails', async () => {
    const fixture = await createFixture();
    fixture.remove.mockRejectedValueOnce(new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'));
    await expect(createPoint(fixture)).rejects.toMatchObject({ cleanupStatus: 'unverified' });
    expect(fixture.remove).toHaveBeenCalledTimes(1);
    await expect(readFile(fixture.containerPath)).resolves.toBeInstanceOf(Buffer);
    await expect(readFile(fixture.keyEnvelopePath)).resolves.toBeInstanceOf(Buffer);
    await expect(fixture.store.list(profileId)).resolves.toEqual([]);
  });

  it('keeps a restored staging root reserved for the activation owner', async () => {
    const fixture = await createFixture();
    await createPoint(fixture, 'preUpdate');
    fixture.remove.mockClear();
    const staged = await fixture.store.stageForRestore({ artifactId, expectedMigrationChainIdentity: migrationChainIdentity,
      operationId: restoreOperationId });
    expect(fixture.withSnapshot).toHaveBeenLastCalledWith(restoreOperationId, expect.any(Function));
    expect(fixture.remove).not.toHaveBeenCalled();
    await expect(readFile(join(staged.operationRoot, 'profile.sqlite'), 'utf8')).resolves.toBe('synthetic-sqlite-profile');
  });

  it('retains invalid restored content when its owned cleanup is uncertain', async () => {
    const fixture = await createFixture();
    await createPoint(fixture, 'preUpdate');
    fixture.remove.mockClear();
    fixture.remove.mockRejectedValueOnce(new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'));
    const error = await fixture.store.stageForRestore({ artifactId, expectedMigrationChainIdentity: 'c'.repeat(64),
      operationId: restoreOperationId }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'RECOVERY_POINT_RESTORE_CONTENT_INVALID', cleanupStatus: 'unverified' });
    expect((error as Error).cause).toMatchObject({ message: 'RECOVERY_POINT_RESTORE_CONTENT_INVALID' });
    expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(restoreOperationId);
    await expect(readFile(join(fixture.stagingRoot, restoreOperationId, 'profile.sqlite'), 'utf8'))
      .resolves.toBe('synthetic-sqlite-profile');
  });

  it('does not use content after a fresh ownership check rejects the validated receipt', async () => {
    const fixture = await createFixture();
    fixture.withSnapshot.mockRejectedValueOnce(new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'));
    await expect(createPoint(fixture)).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(inspectionOperationId);
    await expect(fixture.store.list(profileId)).resolves.toEqual([]);
  });

  it('forwards the update owner only to the independent self-inspection', async () => {
    const fixture = await createFixture();
    await fixture.store.create({
      entries: fixture.entries, kind: 'preUpdate',
      manifest: { appVersion: '0.2.81', createdAtEpochMilliseconds: BigInt(Date.parse(snapshotCreatedAt)),
        migrationChainIdentity, profileId },
      validatedAt: snapshotCreatedAt, updateMaintenanceOperationId: restoreOperationId,
    });
    expect(fixture.validate).toHaveBeenCalledExactlyOnceWith(inspectionOperationId, restoreOperationId);
  });

  it('requires the existing update assertion port before creating an update-owned inspection', async () => {
    const fixture = await createFixture({ omitUpdateAssertion: true });
    await expect(fixture.store.create({
      entries: fixture.entries, kind: 'preUpdate',
      manifest: { appVersion: '0.2.81', createdAtEpochMilliseconds: BigInt(Date.parse(snapshotCreatedAt)),
        migrationChainIdentity, profileId },
      validatedAt: snapshotCreatedAt, updateMaintenanceOperationId: restoreOperationId,
    })).rejects.toThrow('RECOVERY_POINT_INSPECTION_UNAVAILABLE');
    expect(fixture.encrypt).not.toHaveBeenCalled();
    expect(fixture.validate).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'preUpdate', owner: '../other', inspection: inspectionOperationId },
    { kind: 'manual', owner: restoreOperationId, inspection: inspectionOperationId },
    { kind: 'preUpdate', owner: restoreOperationId, inspection: restoreOperationId },
  ] as const)('rejects invalid update inspection context before publishing or validation (%j)', async ({ kind, owner, inspection }) => {
    const fixture = await createFixture({ inspectionOperationId: inspection });
    await expect(fixture.store.create({
      entries: fixture.entries, kind,
      manifest: { appVersion: '0.2.81', createdAtEpochMilliseconds: BigInt(Date.parse(snapshotCreatedAt)),
        migrationChainIdentity, profileId },
      validatedAt: snapshotCreatedAt, updateMaintenanceOperationId: owner,
    })).rejects.toThrow('RECOVERY_POINT_INPUT_INVALID');
    expect(fixture.validate).not.toHaveBeenCalled();
    expect(fixture.encrypt).not.toHaveBeenCalled();
    await expect(fixture.store.list(profileId)).resolves.toEqual([]);
  });

  it('creates, self-validates, indexes and removes an encrypted point', async () => {
    const fixture = await createFixture();
    const point = await fixture.store.create({
      entries: fixture.entries,
      kind: 'manual',
      manifest: {
        appVersion: '0.1.0-alpha.1',
        createdAtEpochMilliseconds: BigInt(
          Date.parse(snapshotCreatedAt),
        ),
        migrationChainIdentity,
        profileId,
      },
      validatedAt: '2026-08-04T12:01:00.000Z',
    });

    expect(point).toEqual({
      artifactId,
      byteSize: expect.any(Number),
      createdAt: snapshotCreatedAt,
      kind: 'manual',
      state: 'validatedGood',
      validatedAt: '2026-08-04T12:01:00.000Z',
    });
    await expect(fixture.store.list(profileId)).resolves.toEqual([
      point,
    ]);
    const container = await readFile(
      join(
        fixture.recoveryRoot,
        profileId,
        `${artifactId}${recoveryPointFileExtension}`,
      ),
    );
    expect(container.subarray(0, 8).toString()).toBe('EKYRCV01');
    expect(container.toString('utf8')).not.toContain(
      'synthetic-sqlite-profile',
    );
    expect(container.toString('utf8')).not.toContain(profileId);
    expect(fixture.encrypt).toHaveBeenCalledTimes(1);
    expect(fixture.decrypt).toHaveBeenCalledTimes(1);

    await fixture.store.remove(profileId, artifactId);
    await expect(fixture.store.list(profileId)).resolves.toEqual([]);
  });

  it('fails closed and leaves no indexed point when key protection is unavailable', async () => {
    const fixture = await createFixture({
      failKeyProtection: true,
    });

    await expect(
      fixture.store.create({
        entries: fixture.entries,
        kind: 'daily',
        manifest: {
          appVersion: '0.1.0-alpha.1',
          createdAtEpochMilliseconds: BigInt(
            Date.parse(snapshotCreatedAt),
          ),
          migrationChainIdentity,
          profileId,
        },
        validatedAt: '2026-08-04T12:01:00.000Z',
      }),
    ).rejects.toThrow();
    await expect(fixture.store.list(profileId)).resolves.toEqual([]);
  });

  it('stages only the exact validated pre-update point for restore', async () => {
    const fixture = await createFixture();
    await fixture.store.create({
      entries: fixture.entries,
      kind: 'preUpdate',
      manifest: {
        appVersion: '0.1.0-alpha.1',
        createdAtEpochMilliseconds: BigInt(
          Date.parse(snapshotCreatedAt),
        ),
        migrationChainIdentity,
        profileId,
      },
      validatedAt: '2026-08-04T12:01:00.000Z',
    });

    const staged = await fixture.store.stageForRestore({
      artifactId,
      expectedMigrationChainIdentity: migrationChainIdentity,
      operationId: restoreOperationId,
    });

    expect(staged).toMatchObject({
      appVersion: '0.1.0-alpha.1',
      documentCount: 0,
      migrationChainIdentity,
      profileId,
      profileMatchesActive: true,
    });
    await expect(
      readFile(join(staged.operationRoot, 'profile.sqlite'), 'utf8'),
    ).resolves.toBe('synthetic-sqlite-profile');
  });

  it('rejects a non-pre-update point as an update rollback source', async () => {
    const fixture = await createFixture();
    await fixture.store.create({
      entries: fixture.entries,
      kind: 'manual',
      manifest: {
        appVersion: '0.1.0-alpha.1',
        createdAtEpochMilliseconds: BigInt(
          Date.parse(snapshotCreatedAt),
        ),
        migrationChainIdentity,
        profileId,
      },
      validatedAt: '2026-08-04T12:01:00.000Z',
    });

    await expect(
      fixture.store.stageForRestore({
        artifactId,
        expectedMigrationChainIdentity: migrationChainIdentity,
        operationId: restoreOperationId,
      }),
    ).rejects.toThrow('RECOVERY_POINT_RESTORE_SOURCE_INVALID');
  });
});

async function createFixture(options: {
  failKeyProtection?: boolean;
  inspectionOperationId?: string;
  omitUpdateAssertion?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-recovery-store-'));
  roots.push(root);
  const recoveryRoot = join(root, 'runtime', 'recovery-points');
  const stagingRoot = join(root, 'runtime', 'staging');
  const quarantineRoot = join(root, 'runtime', 'quarantine');
  const sourceRoot = join(root, 'snapshot');
  await Promise.all([
    mkdir(stagingRoot, { mode: 0o700, recursive: true }),
    mkdir(quarantineRoot, { mode: 0o700, recursive: true }),
    mkdir(sourceRoot, { mode: 0o700, recursive: true }),
  ]);
  await writeFile(
    join(sourceRoot, 'profile.sqlite'),
    'synthetic-sqlite-profile',
  );
  await writeFile(
    join(sourceRoot, 'snapshot-catalog-v1.json'),
    '{"artifacts":[]}',
  );
  const entries = await createProfileBackupSourceEntries(sourceRoot);
  let protectedKey = '';
  const encrypt = vi.fn(async (value: string) => {
    if (options.failKeyProtection) {
      throw new Error('safeStorage unavailable');
    }
    protectedKey = value;
    return Uint8Array.from(Buffer.from(`protected:${value}`));
  });
  const decrypt = vi.fn(async () => ({
    shouldReEncrypt: false,
    value: protectedKey,
  }));
  const keyProtector = new RecoveryPointKeyProtector({
    decrypt,
    encrypt,
  });
  const ownershipCalls: string[] = [];
  const validate = vi.fn(async (_operationId: string, _updateMaintenanceOperationId?: string) => {
    ownershipCalls.push('validated');
    return {
    activeProfileIsEmpty: false,
    artifactCount: 0,
    artifactTotalByteSize: 0,
    databaseHealth: 'healthy' as const,
    migrationChainIdentity,
    profileId,
    profileMatchesActive: true,
    type: 'profileSnapshotValidation' as const,
    };
  });
  const withSnapshot = vi.fn(async (_operationId: string, _use: (receipt: ProfileInspectionReceipt) => Promise<unknown>) => {});
  const remove = vi.fn(async (operationId: string) => {
    ownershipCalls.push('removed');
    await rm(join(stagingRoot, operationId), { force: true, recursive: true });
  });
  const validator = {
    validateProfileSnapshot: validate,
    async withProfileSnapshot<T>(operationId: string, use: (receipt: ProfileInspectionReceipt) => Promise<T>) {
      await withSnapshot(operationId, use);
      ownershipCalls.push('used');
      return use({ artifactCount: 0, artifactIdentity: 'e'.repeat(64), artifactTotalByteSize: 0, databaseHealth: 'healthy',
        migrationChainIdentity, profileId, migrationPolicy: 'restoreCompatible',
        database: { byteSize: 1, sha256: 'c'.repeat(64) }, artifactCatalog: { byteSize: 1, sha256: 'd'.repeat(64) } });
    },
    removeProfileSnapshot: remove,
    async withInspectionOperation<T>(operation: () => Promise<T>) {
      ownershipCalls.push('entered');
      try { return await operation(); }
      finally { ownershipCalls.push('left'); }
    },
    ...(options.omitUpdateAssertion ? {} : { assertUpdateMaintenance: async () => 'busy' as const }),
  };
  const store = new RecoveryPointStore({
    artifactIdFactory: () => artifactId,
    inspectionOperationIdFactory: () => options.inspectionOperationId ?? inspectionOperationId,
    keyProtector,
    quarantineRoot,
    recoveryRoot,
    stagingRoot,
    validator,
  });

  return {
    decrypt,
    encrypt,
    entries,
    containerPath: join(recoveryRoot, profileId, `${artifactId}${recoveryPointFileExtension}`),
    keyEnvelopePath: join(recoveryRoot, profileId, `${artifactId}.key.json`),
    ownershipCalls,
    recoveryRoot,
    quarantineRoot,
    stagingRoot,
    store,
    remove,
    validate,
    validator,
    withSnapshot,
  };
}

function createPoint(fixture: Awaited<ReturnType<typeof createFixture>>, kind: 'manual' | 'preUpdate' = 'manual') {
  return fixture.store.create({ entries: fixture.entries, kind,
    manifest: { appVersion: '0.2.81', createdAtEpochMilliseconds: BigInt(Date.parse(snapshotCreatedAt)),
      migrationChainIdentity, profileId }, validatedAt: snapshotCreatedAt });
}

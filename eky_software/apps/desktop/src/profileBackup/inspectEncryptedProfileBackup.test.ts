import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  backupContainerHeaderLength,
} from './container/backupContainerConstants.js';
import {
  writeBackupContainer,
  type BackupContainerSourceEntry,
} from './container/backupContainerWriter.js';
import {
  inspectEncryptedProfileBackup,
  inspectEncryptedProfileBackupContent,
} from './inspectEncryptedProfileBackup.js';
import { profileInspectionProtocolVersion } from '../runtime/profileInspectionMessages.js';
import type { ProfileSnapshotInspectionEvidence } from './profileSnapshotInspectionClient.js';

const password = 'Eky inspector test password 2026!';
const profileId = 'd'.repeat(64);
const migrationChainIdentity = 'c'.repeat(64);
const temporaryDirectories: string[] = [];

afterEach(async ({ task }) => {
  vi.restoreAllMocks();
  if (task.result?.state !== 'pass') { temporaryDirectories.splice(0); return; }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fileSystem.rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('encrypted profile backup inspector', () => {
  it('returns full main-only evidence only after the existing final staging cleanup settles', async () => {
    const fixture = await createFixture();
    await writeFixture(fixture);
    const originalIdentity = await fileSystem.lstat(fixture.containerPath, { bigint: true });
    const remove = fixture.validator.removeProfileSnapshot.bind(fixture.validator);
    const entered = deferred();
    const allowCleanup = deferred();
    const cleanup = vi.spyOn(fixture.validator, 'removeProfileSnapshot').mockImplementationOnce(async id => {
      entered.resolve(); await allowCleanup.promise; await remove(id);
    });
    const published = vi.fn();
    const pending = inspectEncryptedProfileBackupContent({ ...fixture, validator: fixture.validator })
      .then(value => { published(value); return value; });
    try {
      await entered.promise;
      expect(published).not.toHaveBeenCalled();
      expect(await fileSystem.stat(join(fixture.stagingRoot, fixture.operationId))).toBeDefined();
    } finally { allowCleanup.resolve(); await Promise.allSettled([pending]); }
    const result = await pending;
    expect(result.identity).toBe(fixture.validator.evidence.identity);
    expect(result.receipt).toEqual(fixture.validator.evidence.receipt);
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.database)).toBe(true);
    expect(Object.isFrozen(result.receipt.artifactCatalog)).toBe(true);
    expect(originalIdentity).toMatchObject(result.authenticatedFileIdentity);
    expect(result.summary).not.toHaveProperty('identity');
    expect(result.summary).not.toHaveProperty('receipt');
    expect(result.summary).not.toHaveProperty('authenticatedFileIdentity');
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(fixture.operationId);
    await expect(fileSystem.readdir(fixture.stagingRoot)).resolves.toEqual([]);
    await expect(fileSystem.readdir(fixture.quarantineRoot)).resolves.toEqual([]);
  });

  it('fails closed before staging when the main-only evidence port is missing', async () => {
    const fixture = await createFixture();
    await writeFixture(fixture);
    const remove = vi.spyOn(fixture.validator, 'removeProfileSnapshot');
    const validator = { validateProfileSnapshot: fixture.validator.validateProfileSnapshot.bind(fixture.validator),
      removeProfileSnapshot: remove };
    await expect(inspectEncryptedProfileBackupContent({ ...fixture,
      validator: validator as unknown as Parameters<typeof inspectEncryptedProfileBackupContent>[0]['validator'] }))
      .rejects.toMatchObject({ code: 'BACKUP_INSPECTION_UNAVAILABLE' });
    expect(fixture.validator.operationIds).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
    await expect(fileSystem.readdir(fixture.stagingRoot)).resolves.toEqual([]);
  });

  it('publishes no content evidence after the evidence consumer loses authority', async () => {
    const fixture = await createFixture();
    await writeFixture(fixture);
    const first = new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    fixture.validator.assertCurrent.mockRejectedValueOnce(first);
    const published = vi.fn();
    await expect(inspectEncryptedProfileBackupContent(fixture).then(published)).rejects.toBe(first);
    expect(published).not.toHaveBeenCalled();
    await expect(fileSystem.readdir(fixture.stagingRoot)).resolves.toEqual([]);
  });

  it('preserves content evidence privately and does not retry an uncertain final cleanup', async () => {
    const fixture = await createFixture();
    await writeFixture(fixture);
    const cleanup = vi.spyOn(fixture.validator, 'removeProfileSnapshot')
      .mockRejectedValueOnce(new Error('synthetic cleanup unavailable'));
    const published = vi.fn();
    await expect(inspectEncryptedProfileBackupContent(fixture).then(published))
      .rejects.toMatchObject({ code: 'BACKUP_INSPECTION_UNAVAILABLE', cleanupStatus: 'unverified' });
    expect(published).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(await fileSystem.stat(join(fixture.stagingRoot, fixture.operationId))).toBeDefined();
  });

  it('returns only a safe summary after authentication and backend validation', async () => {
    const fixture = await createFixture();
    await writeFixture(fixture);

    await expect(
      inspectEncryptedProfileBackup({
        containerPath: fixture.containerPath,
        operationId: fixture.operationId,
        password,
        quarantineRoot: fixture.quarantineRoot,
        stagingRoot: fixture.stagingRoot,
        validator: fixture.validator,
      }),
    ).resolves.toEqual({
      appVersion: '0.1.0-alpha.1',
      compatibilityStatus: 'compatible',
      createdAt: '2026-04-04T00:00:00.000Z',
      databaseHealth: 'healthy',
      documentCount: 1,
      formatVersion: 1,
      profileMatchStatus: 'same',
      totalBusinessByteSize: 30,
    });
    expect(fixture.validator.operationIds).toEqual([
      fixture.operationId,
    ]);
    await expect(
      fileSystem.stat(
        join(fixture.stagingRoot, fixture.operationId),
      ),
    ).rejects.toThrow();
    await expect(
      fileSystem.stat(
        join(fixture.quarantineRoot, `${fixture.operationId}.payload`),
      ),
    ).rejects.toThrow();
  });

  it.each([
    ['wrong password', async (fixture: Fixture) => {
      fixture.password = 'A different valid backup password!';
    }],
    ['header bit flip', async (fixture: Fixture) => {
      await mutateByte(fixture.containerPath, 0);
    }],
    ['ciphertext bit flip', async (fixture: Fixture) => {
      await mutateByte(
        fixture.containerPath,
        backupContainerHeaderLength + 8,
      );
    }],
    ['tag bit flip', async (fixture: Fixture) => {
      const metadata = await fileSystem.stat(fixture.containerPath);
      await mutateByte(fixture.containerPath, metadata.size - 1);
    }],
  ])(
    'uses the same safe error and leaves no plaintext for %s',
    async (_name, mutate) => {
      const fixture = await createFixture();
      await writeFixture(fixture);
      await mutate(fixture);

      await expect(
        inspectEncryptedProfileBackup({
          containerPath: fixture.containerPath,
          operationId: fixture.operationId,
          password: fixture.password,
          quarantineRoot: fixture.quarantineRoot,
          stagingRoot: fixture.stagingRoot,
          validator: fixture.validator,
        }),
      ).rejects.toMatchObject({
        code: 'BACKUP_AUTHENTICATION_FAILED',
      });
      expect(fixture.validator.operationIds).toEqual([]);
      await expect(
        fileSystem.readdir(fixture.quarantineRoot),
      ).resolves.toEqual([]);
      await expect(
        fileSystem.readdir(fixture.stagingRoot),
      ).resolves.toEqual([]);
    },
  );

  it('rejects a structurally valid authenticated payload missing the database', async () => {
    const fixture = await createFixture();
    fixture.entries = fixture.entries.filter(
      (entry) => entry.type !== 'database',
    );
    await writeFixture(fixture);

    await expect(
      inspectEncryptedProfileBackup({
        containerPath: fixture.containerPath,
        operationId: fixture.operationId,
        password,
        quarantineRoot: fixture.quarantineRoot,
        stagingRoot: fixture.stagingRoot,
        validator: fixture.validator,
      }),
    ).rejects.toMatchObject({
      code: 'BACKUP_CONTENT_INVALID',
    });
    expect(fixture.validator.operationIds).toEqual([]);
  });

  it('rejects a manifest identity mismatch after backend validation', async () => {
    const fixture = await createFixture();
    fixture.validator.profileId = 'e'.repeat(64);
    await writeFixture(fixture);

    await expect(
      inspectEncryptedProfileBackup({
        containerPath: fixture.containerPath,
        operationId: fixture.operationId,
        password,
        quarantineRoot: fixture.quarantineRoot,
        stagingRoot: fixture.stagingRoot,
        validator: fixture.validator,
      }),
    ).rejects.toMatchObject({
      code: 'BACKUP_CONTENT_INVALID',
    });
  });

  it('preserves the first content cause when owned cleanup independently fails', async () => {
    const fixture = await createFixture();
    await writeFixture(fixture);
    const original = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    vi.spyOn(fixture.validator, 'validateProfileSnapshot').mockRejectedValueOnce(original);
    vi.spyOn(fixture.validator, 'removeProfileSnapshot').mockRejectedValueOnce(new Error('cleanup unavailable'));
    const error = await inspectEncryptedProfileBackup({
      containerPath: fixture.containerPath, operationId: fixture.operationId, password,
      quarantineRoot: fixture.quarantineRoot, stagingRoot: fixture.stagingRoot, validator: fixture.validator,
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'BACKUP_CONTENT_INVALID', cleanupStatus: 'unverified' });
    expect(((error as Error).cause as Error).cause).toBe(original);
    expect(JSON.stringify(error)).not.toContain(original.message);
    await expect(fileSystem.stat(join(fixture.stagingRoot, fixture.operationId))).resolves.toBeDefined();
  });

  it.each([
    'PROFILE_SCHEMA_UNSUPPORTED',
    'PROFILE_INSPECTION_LIMIT_EXCEEDED',
    'PROFILE_INSPECTION_TIMEOUT',
    'PROFILE_INSPECTION_PROTOCOL_INVALID',
    'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
    'synthetic private inspection detail',
  ])('preserves the internal inspection cause without changing the content error: %s', async (causeCode) => {
    const fixture = await createFixture();
    await writeFixture(fixture);
    const original = new Error(causeCode);
    vi.spyOn(fixture.validator, 'validateProfileSnapshot')
      .mockRejectedValueOnce(original);

    const failure: unknown = await inspectEncryptedProfileBackup({
      containerPath: fixture.containerPath,
      operationId: fixture.operationId,
      password,
      quarantineRoot: fixture.quarantineRoot,
      stagingRoot: fixture.stagingRoot,
      validator: fixture.validator,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'BACKUP_CONTENT_INVALID',
      message: 'BACKUP_CONTENT_INVALID',
    });
    expect((failure as Error).cause).toBe(original);
    expect(Object.keys(failure as Error)).not.toContain('cause');
    expect(JSON.stringify(failure)).not.toContain(causeCode);
  });
});

interface Fixture {
  containerPath: string;
  entries: BackupContainerSourceEntry[];
  operationId: string;
  password: string;
  quarantineRoot: string;
  stagingRoot: string;
  validator: FakeValidator;
}

async function createFixture(): Promise<Fixture> {
  const root = await fileSystem.mkdtemp(
    join(tmpdir(), 'eky-backup-inspector-'),
  );
  temporaryDirectories.push(root);
  const sourceRoot = join(root, 'source');
  const quarantineRoot = join(root, 'quarantine');
  const stagingRoot = join(root, 'staging');
  await Promise.all(
    [sourceRoot, quarantineRoot, stagingRoot].map((path) =>
      fileSystem.mkdir(path, { mode: 0o700 }),
    ),
  );

  const databasePath = join(sourceRoot, 'profile.sqlite');
  const catalogPath = join(sourceRoot, 'snapshot-catalog-v1.json');
  const invoicePath = join(sourceRoot, 'invoice.pdf');
  await fileSystem.writeFile(databasePath, 'synthetic sqlite');
  await fileSystem.writeFile(
    catalogPath,
    '{"artifacts":[],"formatVersion":1}\n',
  );
  await fileSystem.writeFile(
    invoicePath,
    '%PDF-1.7\nsynthetic invoice\n%%EOF',
  );

  return {
    containerPath: join(root, 'backup.ekybackup'),
    entries: [
      await createEntry(databasePath, 'profile.sqlite', 'database'),
      await createEntry(
        catalogPath,
        'snapshot-catalog-v1.json',
        'artifactCatalog',
      ),
      await createEntry(
        invoicePath,
        `artifacts/invoicing/invoice-documents/${'a'.repeat(64)}.pdf`,
        'businessArtifact',
      ),
    ],
    operationId: randomUUID(),
    password,
    quarantineRoot,
    stagingRoot,
    validator: new FakeValidator(stagingRoot),
  };
}

async function createEntry(
  sourcePath: string,
  logicalPath: string,
  type: BackupContainerSourceEntry['type'],
): Promise<BackupContainerSourceEntry> {
  const content = await fileSystem.readFile(sourcePath);
  return {
    contentLength: BigInt(content.byteLength),
    logicalPath,
    sha256: createHash('sha256').update(content).digest('hex'),
    sourcePath,
    type,
  };
}

async function writeFixture(fixture: Fixture): Promise<void> {
  await writeBackupContainer({
    destinationPath: fixture.containerPath,
    entries: fixture.entries,
    manifest: {
      appVersion: '0.1.0-alpha.1',
      createdAtEpochMilliseconds: 1_775_260_800_000n,
      migrationChainIdentity,
      profileId,
    },
    password,
  });
}

async function mutateByte(path: string, offset: number): Promise<void> {
  const content = await fileSystem.readFile(path);
  content[offset] = content[offset]! ^ 0x01;
  await fileSystem.chmod(path, 0o600);
  await fileSystem.writeFile(path, content);
}

class FakeValidator {
  constructor(private readonly stagingRoot: string) {}
  operationIds: string[] = [];
  profileId = 'd'.repeat(64);
  assertCurrent = vi.fn(async () => {});
  evidence!: ProfileSnapshotInspectionEvidence;

  async withProfileSnapshotEvidence<T>(operationId: string, use: (
    evidence: ProfileSnapshotInspectionEvidence, assertCurrent: () => Promise<void>,
  ) => Promise<T>): Promise<T> {
    this.evidence = Object.freeze({
      identity: Object.freeze({ protocolVersion: profileInspectionProtocolVersion, operationId,
        generationId: randomUUID(), runtimeSession: randomBytes(32).toString('base64url') }),
      receipt: Object.freeze({ artifactCount: 1, artifactTotalByteSize: 30, artifactIdentity: 'a'.repeat(64),
        databaseHealth: 'healthy' as const, migrationChainIdentity, profileId: this.profileId,
        migrationPolicy: 'restoreCompatible' as const,
        database: Object.freeze({ byteSize: 16, sha256: 'b'.repeat(64) }),
        artifactCatalog: Object.freeze({ byteSize: 35, sha256: 'c'.repeat(64) }) }),
    });
    return use(this.evidence, this.assertCurrent);
  }

  async removeProfileSnapshot(operationId: string) {
    await fileSystem.rm(join(this.stagingRoot, operationId), { force: true, recursive: true });
  }

  async validateProfileSnapshot(operationId: string) {
    this.operationIds.push(operationId);
    return {
      activeProfileIsEmpty: false,
      artifactCount: 1,
      artifactTotalByteSize: 30,
      databaseHealth: 'healthy' as const,
      migrationChainIdentity,
      profileId: this.profileId,
      profileMatchesActive: true,
      type: 'profileSnapshotValidation' as const,
    };
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(fulfill => { resolve = fulfill; });
  return { promise, resolve };
}

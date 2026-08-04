import { createHash, randomUUID } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  backupContainerHeaderLength,
} from './container/backupContainerConstants.js';
import {
  writeBackupContainer,
  type BackupContainerSourceEntry,
} from './container/backupContainerWriter.js';
import {
  inspectEncryptedProfileBackup,
} from './inspectEncryptedProfileBackup.js';

const password = 'Eky inspector test password 2026!';
const profileId = 'd'.repeat(64);
const migrationChainIdentity = 'c'.repeat(64);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fileSystem.rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('encrypted profile backup inspector', () => {
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
    validator: new FakeValidator(),
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
  operationIds: string[] = [];
  profileId = 'd'.repeat(64);

  async validateProfileSnapshot(operationId: string) {
    this.operationIds.push(operationId);
    return {
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

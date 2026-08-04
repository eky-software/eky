import { createHash } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  backupAuthenticationTagLength,
  backupContainerHeaderLength,
} from './backupContainerConstants.js';
import { readDecryptedBackupPayload } from './backupContainerReader.js';
import {
  writeBackupContainer,
  type BackupContainerSourceEntry,
} from './backupContainerWriter.js';
import { decryptBackupPayload } from './decryptBackupPayload.js';

const password = 'Eky test backup password 2026!';
const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const nonce = Buffer.from('101112131415161718191a1b', 'hex');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fileSystem.rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('encrypted backup container', () => {
  it('writes, authenticates and parses a deterministic complete payload', async () => {
    const fixture = await createFixture();

    const written = await writeBackupContainer({
      destinationPath: fixture.containerPath,
      entries: fixture.entries,
      manifest: fixture.manifest,
      nonce,
      password,
      salt,
    });
    const decrypted = await decryptBackupPayload({
      containerPath: fixture.containerPath,
      password,
      quarantinePath: fixture.quarantinePath,
    });
    const parsed = await readDecryptedBackupPayload(
      fixture.quarantinePath,
    );

    expect(decrypted.plaintextByteLength).toBe(
      written.header.ciphertextLength,
    );
    expect(parsed.manifest).toEqual(written.manifest);
    expect(parsed.entries.map(({ logicalPath, type }) => ({
      logicalPath,
      type,
    }))).toEqual([
      { logicalPath: 'manifest.bin', type: 'manifest' },
      {
        logicalPath: 'artifacts/snapshot-catalog-v1.json',
        type: 'artifactCatalog',
      },
      { logicalPath: 'database/eky.sqlite', type: 'database' },
      {
        logicalPath: 'invoices/invoice-1/approved-invoice.pdf',
        type: 'businessArtifact',
      },
    ]);

    const container = await fileSystem.readFile(fixture.containerPath);
    expect(createHash('sha256').update(container).digest('hex')).toBe(
      '643026f00d280a3179b1c102ef442b6710ebb9c42539663665ce809531f38b71',
    );
  });

  it.each([
    ['header', 20],
    ['ciphertext', backupContainerHeaderLength + 5],
    ['authentication tag', -1],
  ])(
    'rejects a %s bit flip and removes only its own quarantine',
    async (_name, requestedOffset) => {
      const fixture = await createFixture();
      await writeFixture(fixture);
      const container = await fileSystem.readFile(fixture.containerPath);
      const offset =
        requestedOffset < 0
          ? container.byteLength + requestedOffset
          : requestedOffset;
      container[offset] = container[offset]! ^ 0x01;
      await fileSystem.chmod(fixture.containerPath, 0o600);
      await fileSystem.writeFile(fixture.containerPath, container);

      await expect(
        decryptBackupPayload({
          containerPath: fixture.containerPath,
          password,
          quarantinePath: fixture.quarantinePath,
        }),
      ).rejects.toThrow();
      await expect(fileSystem.stat(fixture.quarantinePath)).rejects.toThrow();
    },
  );

  it('uses the same safe authentication error for a wrong password or modified tag', async () => {
    const wrongPasswordFixture = await createFixture();
    await writeFixture(wrongPasswordFixture);

    await expect(
      decryptBackupPayload({
        containerPath: wrongPasswordFixture.containerPath,
        password: 'A different valid backup password!',
        quarantinePath: wrongPasswordFixture.quarantinePath,
      }),
    ).rejects.toThrow('BACKUP_AUTHENTICATION_FAILED');

    const tagFixture = await createFixture();
    await writeFixture(tagFixture);
    const container = await fileSystem.readFile(tagFixture.containerPath);
    container[container.byteLength - 1] =
      container[container.byteLength - 1]! ^ 0x01;
    await fileSystem.chmod(tagFixture.containerPath, 0o600);
    await fileSystem.writeFile(tagFixture.containerPath, container);

    await expect(
      decryptBackupPayload({
        containerPath: tagFixture.containerPath,
        password,
        quarantinePath: tagFixture.quarantinePath,
      }),
    ).rejects.toThrow('BACKUP_AUTHENTICATION_FAILED');
  });

  it.each([
    ['header', 20],
    ['ciphertext', backupContainerHeaderLength + 1],
    ['tag', backupAuthenticationTagLength - 1],
  ])('rejects truncation in the %s', async (_name, bytesToKeep) => {
    const fixture = await createFixture();
    await writeFixture(fixture);
    const container = await fileSystem.readFile(fixture.containerPath);
    const truncated =
      _name === 'tag'
        ? container.subarray(
            0,
            container.byteLength -
              backupAuthenticationTagLength +
              bytesToKeep,
          )
        : container.subarray(0, bytesToKeep);
    await fileSystem.chmod(fixture.containerPath, 0o600);
    await fileSystem.writeFile(fixture.containerPath, truncated);

    await expect(
      decryptBackupPayload({
        containerPath: fixture.containerPath,
        password,
        quarantinePath: fixture.quarantinePath,
      }),
    ).rejects.toThrow();
  });

  it('rejects trailing bytes before KDF work', async () => {
    const fixture = await createFixture();
    await writeFixture(fixture);
    await fileSystem.chmod(fixture.containerPath, 0o600);
    await fileSystem.appendFile(fixture.containerPath, Buffer.of(0));

    await expect(
      decryptBackupPayload({
        containerPath: fixture.containerPath,
        password,
        quarantinePath: fixture.quarantinePath,
      }),
    ).rejects.toThrow('BACKUP_CONTAINER_LENGTH_INVALID');
  });

  it('never overwrites or removes an existing destination or quarantine file', async () => {
    const fixture = await createFixture();
    await fileSystem.writeFile(fixture.containerPath, 'existing backup');

    await expect(writeFixture(fixture)).rejects.toThrow();
    expect(await fileSystem.readFile(fixture.containerPath, 'utf8')).toBe(
      'existing backup',
    );

    await fileSystem.rm(fixture.containerPath);
    await writeFixture(fixture);
    await fileSystem.writeFile(
      fixture.quarantinePath,
      'existing quarantine',
    );
    await expect(
      decryptBackupPayload({
        containerPath: fixture.containerPath,
        password,
        quarantinePath: fixture.quarantinePath,
      }),
    ).rejects.toThrow();
    expect(await fileSystem.readFile(fixture.quarantinePath, 'utf8')).toBe(
      'existing quarantine',
    );
  });
});

interface Fixture {
  containerPath: string;
  entries: BackupContainerSourceEntry[];
  manifest: {
    appVersion: string;
    createdAtEpochMilliseconds: bigint;
    migrationChainIdentity: string;
    profileId: string;
  };
  quarantinePath: string;
}

async function createFixture(): Promise<Fixture> {
  const directory = await fileSystem.mkdtemp(
    join(tmpdir(), 'eky-backup-container-'),
  );
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'eky.sqlite');
  const catalogPath = join(directory, 'snapshot-catalog-v1.json');
  const invoicePath = join(directory, 'approved-invoice.pdf');
  await fileSystem.writeFile(databasePath, 'synthetic sqlite snapshot');
  await fileSystem.writeFile(catalogPath, '{"version":1}');
  await fileSystem.writeFile(
    invoicePath,
    '%PDF-1.7\nsynthetic invoice\n%%EOF',
  );

  return {
    containerPath: join(directory, 'backup.ekybackup'),
    entries: [
      await createEntry(
        databasePath,
        'database/eky.sqlite',
        'database',
      ),
      await createEntry(
        invoicePath,
        'invoices/invoice-1/approved-invoice.pdf',
        'businessArtifact',
      ),
      await createEntry(
        catalogPath,
        'artifacts/snapshot-catalog-v1.json',
        'artifactCatalog',
      ),
    ],
    manifest: {
      appVersion: '0.1.0-alpha.1',
      createdAtEpochMilliseconds: 1_775_252_800_000n,
      migrationChainIdentity: 'migration-chain-v1',
      profileId: 'local-default',
    },
    quarantinePath: join(directory, 'payload.quarantine'),
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
    manifest: fixture.manifest,
    nonce,
    password,
    salt,
  });
}

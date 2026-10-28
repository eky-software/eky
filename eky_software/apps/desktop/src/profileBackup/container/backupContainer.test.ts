import { createHash } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(async ({ task }) => {
  vi.restoreAllMocks();
  if (task.result?.state !== 'pass') { temporaryDirectories.splice(0); return; }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fileSystem.rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('encrypted backup container', () => {
  it('BACKUP-CONTAINER-001 @security writes, authenticates and parses a deterministic complete payload', async () => {
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
    expect(await fileSystem.lstat(fixture.containerPath, { bigint: true })).toMatchObject(decrypted.authenticatedFileIdentity);
    expect(Object.isFrozen(decrypted.authenticatedFileIdentity)).toBe(true);
    expect(createHash('sha256').update(container).digest('hex')).toBe(
      '643026f00d280a3179b1c102ef442b6710ebb9c42539663665ce809531f38b71',
    );
  });

  it('keeps the authenticated handle identity when the source path is replaced during finalization', async () => {
    const fixture = await createFixture();
    await writeFixture(fixture);
    const original = await fileSystem.lstat(fixture.containerPath, { bigint: true });
    const bytes = await fileSystem.readFile(fixture.containerPath);
    const retainedPath = `${fixture.containerPath}.original`;
    const chmod = fileSystem.chmod;
    const change = vi.spyOn(fileSystem, 'chmod').mockImplementation(async (path, mode) => {
      if (path === fixture.quarantinePath) {
        await fileSystem.rename(fixture.containerPath, retainedPath);
        await fileSystem.writeFile(fixture.containerPath, bytes, { flag: 'wx' });
      }
      await chmod(path, mode);
    });
    try {
      const result = await decryptBackupPayload({ containerPath: fixture.containerPath, password,
        quarantinePath: fixture.quarantinePath });
      expect(original).toMatchObject(result.authenticatedFileIdentity);
      expect(result.containerSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(await fileSystem.lstat(fixture.containerPath, { bigint: true })).not.toMatchObject(result.authenticatedFileIdentity);
      expect(await fileSystem.readFile(retainedPath)).toEqual(bytes);
    } finally { change.mockRestore(); }
  });

  it('does not return authenticated evidence before the actual source reader closes', async () => {
    const fixture = await createFixture();
    await writeFixture(fixture);
    const open = fileSystem.open;
    const closing = deferred();
    const allowClose = deferred();
    let closeCompleted = false;
    const intercept = vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === fixture.containerPath) {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          closing.resolve(); await allowClose.promise; await close(); closeCompleted = true;
        };
      }
      return handle;
    });
    let returned = false;
    const pending = decryptBackupPayload({ containerPath: fixture.containerPath, password,
      quarantinePath: fixture.quarantinePath }).then(value => { returned = true; return value; });
    try {
      await closing.promise;
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(returned).toBe(false);
      expect(closeCompleted).toBe(false);
    } finally {
      allowClose.resolve();
      await Promise.allSettled([pending]);
      intercept.mockRestore();
    }
    expect((await pending).authenticatedFileIdentity).toMatchObject({ ino: expect.any(BigInt) });
    expect(returned).toBe(true);
    expect(closeCompleted).toBe(true);
  });

  it('rejects authenticated bytes if the open file changes before its final identity check', async () => {
    const fixture = await createFixture();
    await writeFixture(fixture);
    const open = fileSystem.open;
    const intercept = vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === fixture.containerPath) {
        const stat = handle.stat.bind(handle);
        let reads = 0;
        handle.stat = (async (...statArgs: Parameters<typeof stat>) => {
          if (++reads === 2) {
            await fileSystem.chmod(fixture.containerPath, 0o600);
            await fileSystem.appendFile(fixture.containerPath, Buffer.of(0));
          }
          return stat(...statArgs);
        }) as typeof handle.stat;
      }
      return handle;
    });
    try {
      await expect(decryptBackupPayload({ containerPath: fixture.containerPath, password,
        quarantinePath: fixture.quarantinePath })).rejects.toThrow('BACKUP_CONTAINER_FILE_CHANGED');
      await expect(fileSystem.stat(fixture.quarantinePath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { intercept.mockRestore(); }
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

  it('BACKUP-AUTH-001 @security uses the same safe authentication error for a wrong password or modified tag', async () => {
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(fulfill => { resolve = fulfill; });
  return { promise, resolve };
}

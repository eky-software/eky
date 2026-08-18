import { createHash } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  writeBackupContainer,
  type BackupContainerSourceEntry,
} from '../../profileBackup/container/backupContainerWriter.js';
import { decryptBackupPayload } from '../../profileBackup/container/decryptBackupPayload.js';
import { WorkspaceBackupContainerAdapter } from './workspaceBackupContainerAdapter.js';
import { WorkspaceBackupPlaintextQuarantine } from './workspaceBackupPlaintextQuarantine.js';

const password = 'synthetic W3 backup password';
const migrationChainIdentity = 'b'.repeat(64);
const profileId = 'a'.repeat(64);
const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots
      .splice(0)
      .map((root) => fileSystem.rm(root, { force: true, recursive: true })),
  );
});

describe('WorkspaceBackupContainerAdapter', () => {
  it('authenticates and extracts an existing v1 backup through the format owner', async () => {
    const fixture = await createFixture();
    const inspection = await fixture.adapter.inspect({
      containerPath: fixture.containerPath,
      password,
    });

    expect(inspection).toMatchObject({
      appVersion: '0.2.6',
      migrationChainIdentity,
      profileId,
    });
    expect(inspection.containerSha256).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      fixture.adapter.stage({
        containerPath: fixture.containerPath,
        password,
        expectedContainerSha256: inspection.containerSha256,
        expectedMigrationChainIdentity: inspection.migrationChainIdentity,
        expectedProfileId: inspection.profileId,
        importStagingRoot: fixture.importStagingRoot,
      }),
    ).resolves.toEqual(inspection);
    await expect(
      fileSystem.readFile(join(fixture.importStagingRoot, 'profile.sqlite')),
    ).resolves.toEqual(fixture.databaseBytes);
    await expect(
      fileSystem.readFile(
        join(fixture.importStagingRoot, 'snapshot-catalog-v1.json'),
        'utf8',
      ),
    ).resolves.toBe('{"artifacts":[],"formatVersion":1}\n');
    await expect(fileSystem.readdir(fixture.quarantineRoot)).resolves.toEqual(
      [],
    );
  });

  it('rejects a wrong password without retaining plaintext or staging data', async () => {
    const fixture = await createFixture();

    await expect(
      fixture.adapter.inspect({
        containerPath: fixture.containerPath,
        password: 'wrong synthetic password',
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_BACKUP_FAILED',
      stage: 'backupPreflight',
    });
    await expect(fileSystem.readdir(fixture.quarantineRoot)).resolves.toEqual(
      [],
    );
    await expect(fileSystem.lstat(fixture.importStagingRoot)).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  });

  it('recovers a complete plaintext payload left on disk by abrupt termination', async () => {
    const fixture = await createFixture();
    const sourceBytes = await fileSystem.readFile(fixture.containerPath);
    const quarantinePath = await fixture.plaintextQuarantine.createPayloadPath();

    await decryptBackupPayload({
      containerPath: fixture.containerPath,
      password,
      quarantinePath,
    });
    await expect(fileSystem.readFile(quarantinePath)).resolves.not.toHaveLength(0);

    await expect(
      fixture.plaintextQuarantine.recoverStalePayloads(),
    ).resolves.toBeUndefined();
    await expect(fileSystem.readdir(fixture.quarantineRoot)).resolves.toEqual(
      [],
    );
    await expect(fileSystem.readFile(fixture.containerPath)).resolves.toEqual(
      sourceBytes,
    );
  });

  it('rejects a container changed between preflight and staging', async () => {
    const fixture = await createFixture();
    const inspection = await fixture.adapter.inspect({
      containerPath: fixture.containerPath,
      password,
    });
    await fileSystem.rm(fixture.containerPath);
    await writeFixture(
      fixture.containerPath,
      fixture.sourceRoot,
      Buffer.from('different synthetic sqlite'),
    );

    await expect(
      fixture.adapter.stage({
        containerPath: fixture.containerPath,
        password,
        expectedContainerSha256: inspection.containerSha256,
        expectedMigrationChainIdentity: inspection.migrationChainIdentity,
        expectedProfileId: inspection.profileId,
        importStagingRoot: fixture.importStagingRoot,
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_BACKUP_FAILED',
      stage: 'backupStage',
    });
    await expect(fileSystem.lstat(fixture.importStagingRoot)).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  });

  it('rejects a pre-existing staging root instead of merging files into it', async () => {
    const fixture = await createFixture();
    const inspection = await fixture.adapter.inspect({
      containerPath: fixture.containerPath,
      password,
    });
    await fileSystem.mkdir(fixture.importStagingRoot, { mode: 0o700 });
    await fileSystem.writeFile(
      join(fixture.importStagingRoot, 'sentinel.txt'),
      'must remain untouched',
    );

    await expect(
      fixture.adapter.stage({
        containerPath: fixture.containerPath,
        password,
        expectedContainerSha256: inspection.containerSha256,
        expectedMigrationChainIdentity: inspection.migrationChainIdentity,
        expectedProfileId: inspection.profileId,
        importStagingRoot: fixture.importStagingRoot,
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_BACKUP_FAILED',
      stage: 'backupStage',
    });
    await expect(
      fileSystem.readFile(
        join(fixture.importStagingRoot, 'sentinel.txt'),
        'utf8',
      ),
    ).resolves.toBe('must remain untouched');
  });

  it('rejects non-absolute source and staging paths before reading data', async () => {
    const fixture = await createFixture();

    await expect(
      fixture.adapter.inspect({ containerPath: 'backup.ekybackup', password }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_INVALID',
      stage: 'inputValidation',
    });
    await expect(
      fixture.adapter.stage({
        containerPath: fixture.containerPath,
        password,
        expectedContainerSha256: 'd'.repeat(64),
        expectedMigrationChainIdentity: migrationChainIdentity,
        expectedProfileId: profileId,
        importStagingRoot: 'relative-staging',
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_INVALID',
      stage: 'inputValidation',
    });
  });
});

async function createFixture() {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'eky-w3-container-'));
  cleanupRoots.push(root);
  const sourceRoot = join(root, 'source');
  const quarantineRoot = join(
    root,
    'workspace-operations',
    'workspace-import-plaintext-quarantine',
  );
  const importParent = join(root, 'candidate');
  const importStagingRoot = join(importParent, 'import-staging');
  await Promise.all([
    fileSystem.mkdir(sourceRoot, { mode: 0o700 }),
    fileSystem.mkdir(importParent, { mode: 0o700 }),
  ]);
  const containerPath = join(root, 'backup.ekybackup');
  const databaseBytes = Buffer.from('synthetic sqlite');
  await writeFixture(containerPath, sourceRoot, databaseBytes);
  const plaintextQuarantine = new WorkspaceBackupPlaintextQuarantine({
    userDataRoot: root,
  });
  return {
    adapter: new WorkspaceBackupContainerAdapter({
      plaintextQuarantine,
    }),
    containerPath,
    databaseBytes,
    importStagingRoot,
    plaintextQuarantine,
    quarantineRoot,
    sourceRoot,
  };
}

async function writeFixture(
  containerPath: string,
  sourceRoot: string,
  databaseBytes: Buffer,
): Promise<void> {
  const databasePath = join(sourceRoot, 'profile.sqlite');
  const catalogPath = join(sourceRoot, 'snapshot-catalog-v1.json');
  await fileSystem.writeFile(databasePath, databaseBytes);
  await fileSystem.writeFile(
    catalogPath,
    '{"artifacts":[],"formatVersion":1}\n',
  );
  const entries = [
    await createEntry(databasePath, 'profile.sqlite', 'database'),
    await createEntry(
      catalogPath,
      'snapshot-catalog-v1.json',
      'artifactCatalog',
    ),
  ];
  await writeBackupContainer({
    destinationPath: containerPath,
    entries,
    manifest: {
      appVersion: '0.2.6',
      createdAtEpochMilliseconds: 1_787_130_000_000n,
      migrationChainIdentity,
      profileId,
    },
    password,
  });
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

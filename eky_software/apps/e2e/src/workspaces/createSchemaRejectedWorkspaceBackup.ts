import { chmod, copyFile, lstat, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { createDatabaseConnection } from '../../../backend/src/database/connection/createDatabaseConnection.js';
import { inspectSqliteProfileDatabase } from '../../../backend/src/runtime/profileSnapshot/inspectSqliteProfileDatabase.js';
import { readDecryptedBackupPayload } from '../../../desktop/src/profileBackup/container/backupContainerReader.js';
import { writeBackupContainer } from '../../../desktop/src/profileBackup/container/backupContainerWriter.js';
import { decryptBackupPayload } from '../../../desktop/src/profileBackup/container/decryptBackupPayload.js';
import { extractBackupPayload } from '../../../desktop/src/profileBackup/container/extractBackupPayload.js';
import { createProfileBackupSourceEntries } from '../../../desktop/src/profileBackup/createProfileBackupSourceEntries.js';
import { assertPathUnderRoot } from '../environment/assertE2eSafetyBoundary.js';
import { expect } from '../fixtures/isolatedElectronTest.js';
import type { ElectronWorkspaceBackupFixture } from './createElectronWorkspaceBackupFixture.js';
import { sha256File, workspaceBackupMigrationsDirectory } from './workspaceBackupSystemTestSupport.js';

export async function createSchemaRejectedWorkspaceBackup(input: {
  readonly fixture: Readonly<ElectronWorkspaceBackupFixture>;
  readonly preparationRoot: string;
  readonly runRoot: string;
}): Promise<{
  readonly backupSha256: string;
  readonly modifiedDatabasePath: string;
  readonly modifiedDatabaseSha256: string;
}> {
  assertPathUnderRoot(input.fixture.backupPath, input.runRoot);
  assertPathUnderRoot(input.fixture.sourceDatabaseFilePath, input.runRoot);
  assertPathUnderRoot(dirname(input.preparationRoot), input.runRoot);
  const backupMetadata = await lstat(input.fixture.backupPath);
  if (!backupMetadata.isFile() || backupMetadata.isSymbolicLink() || backupMetadata.nlink !== 1) {
    throw new Error('SCHEMA_FIXTURE_BACKUP_NOT_OWNED');
  }
  expect(await sha256File(input.fixture.backupPath)).toBe(input.fixture.backupSha256);
  await mkdir(input.preparationRoot, { mode: 0o700 });
  assertPathUnderRoot(input.preparationRoot, input.runRoot);

  const payloadPath = join(input.preparationRoot, 'original-payload.bin');
  await decryptBackupPayload({
    containerPath: input.fixture.backupPath,
    password: input.fixture.password,
    quarantinePath: payloadPath,
  });
  const parsed = await readDecryptedBackupPayload(payloadPath);
  const operationRoot = join(input.preparationRoot, 'owned-copy');
  await extractBackupPayload({ operationRoot, parsedPayload: parsed, payloadPath });
  const databasePath = join(operationRoot, 'profile.sqlite');
  expect(inspectSqliteProfileDatabase(databasePath, workspaceBackupMigrationsDirectory).profileId)
    .toBe(input.fixture.profileId);

  // Mutate only the extracted copy, never the source or active profile.
  await chmod(databasePath, 0o600);
  const database = createDatabaseConnection({ databaseFilePath: databasePath, fileMustExist: true });
  try {
    database.exec('CREATE VIEW synthetic_unapproved_view AS SELECT 1 AS marker');
  } finally {
    database.close();
  }
  expect(() => inspectSqliteProfileDatabase(databasePath, workspaceBackupMigrationsDirectory))
    .toThrow('PROFILE_SCHEMA_UNSUPPORTED');
  const modifiedDatabaseSha256 = await sha256File(databasePath);
  const modifiedBackupPath = join(input.preparationRoot, 'schema-modified.ekybackup');
  await writeBackupContainer({
    destinationPath: modifiedBackupPath,
    entries: await createProfileBackupSourceEntries(operationRoot),
    manifest: {
      appVersion: parsed.manifest.appVersion,
      createdAtEpochMilliseconds: parsed.manifest.createdAtEpochMilliseconds,
      migrationChainIdentity: parsed.manifest.migrationChainIdentity,
      profileId: parsed.manifest.profileId,
    },
    password: input.fixture.password,
  });
  const verifiedPayloadPath = join(input.preparationRoot, 'verified-payload.bin');
  await decryptBackupPayload({
    containerPath: modifiedBackupPath,
    password: input.fixture.password,
    quarantinePath: verifiedPayloadPath,
  });
  const verified = await readDecryptedBackupPayload(verifiedPayloadPath);
  const modifiedDatabaseMetadata = await lstat(databasePath);
  expect(verified.manifest).toEqual({
    ...parsed.manifest,
    entries: parsed.manifest.entries.map((entry) => entry.logicalPath === 'profile.sqlite' ? {
      ...entry,
      contentLength: BigInt(modifiedDatabaseMetadata.size),
      sha256: modifiedDatabaseSha256,
    } : entry),
  });
  await chmod(input.fixture.backupPath, 0o600);
  await copyFile(modifiedBackupPath, input.fixture.backupPath);
  return {
    backupSha256: await sha256File(input.fixture.backupPath),
    modifiedDatabasePath: databasePath,
    modifiedDatabaseSha256,
  };
}

import { createHash } from 'node:crypto';
import {
  createReadStream,
  readdirSync,
  promises as fileSystem,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import Database from 'better-sqlite3';

import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import type { ProfileMaintenanceState } from '../profileMaintenance/profileMaintenanceState.js';
import type {
  CreateSqliteProfileSnapshotInput,
  ProfileSnapshotService,
  SqliteProfileSnapshotMetadata,
} from './profileSnapshotTypes.js';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const migrationFileNamePattern = /^\d{3}_[A-Za-z0-9_]+\.sql$/;
const maximumSqliteSnapshotBytes = 20 * 1024 * 1024 * 1024;
const sqliteSnapshotLogicalPath = 'profile.sqlite';
const sqliteSnapshotTimeoutMilliseconds = 2 * 60_000;

interface SqliteProfileSnapshotDependencies {
  backupDatabase(
    destinationFilePath: string,
    options: {
      progress(info: {
        remainingPages: number;
        totalPages: number;
      }): number;
    },
  ): Promise<{ remainingPages: number; totalPages: number }>;
  maintenanceState: ProfileMaintenanceState;
  migrationsDirectory: string;
  now?: () => number;
  stagingRoot: string;
}

export class SqliteProfileSnapshotService implements ProfileSnapshotService {
  private readonly now: () => number;
  private readonly stagingRoot: string;

  constructor(
    private readonly dependencies: SqliteProfileSnapshotDependencies,
  ) {
    if (!isAbsolute(dependencies.stagingRoot)) {
      throw new Error('Profile snapshot staging root must be absolute.');
    }
    this.stagingRoot = resolve(dependencies.stagingRoot);
    this.now = dependencies.now ?? Date.now;
  }

  async createSqliteSnapshot(
    input: CreateSqliteProfileSnapshotInput,
  ): Promise<SqliteProfileSnapshotMetadata> {
    if (
      !operationIdPattern.test(input.operationId) ||
      !this.dependencies.maintenanceState.isActiveOperation(input.operationId)
    ) {
      throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
    }

    const operationRoot = join(this.stagingRoot, input.operationId);
    const destinationFilePath = join(
      operationRoot,
      sqliteSnapshotLogicalPath,
    );
    assertContainedPath(this.stagingRoot, operationRoot);
    assertContainedPath(operationRoot, destinationFilePath);
    await assertPrivateStagingRoot(this.stagingRoot);

    let operationRootCreated = false;

    try {
      throwIfCancelled(input.signal);
      await fileSystem.mkdir(operationRoot, { mode: 0o700 });
      operationRootCreated = true;
      await assertPrivateOperationRoot(operationRoot);
      await assertPathMissing(destinationFilePath);

      const deadline =
        this.now() + sqliteSnapshotTimeoutMilliseconds;
      const backupMetadata = await this.dependencies.backupDatabase(
        destinationFilePath,
        {
          progress: (progress) => {
            if (input.signal.aborted || this.now() > deadline) {
              throw new Error('PROFILE_SNAPSHOT_CANCELLED');
            }
            return progress.remainingPages > 0 ? 100 : 0;
          },
        },
      );

      throwIfCancelled(input.signal);
      const snapshotFile = await fileSystem.lstat(destinationFilePath);

      if (
        !snapshotFile.isFile() ||
        snapshotFile.isSymbolicLink() ||
        snapshotFile.size < 1 ||
        snapshotFile.size > maximumSqliteSnapshotBytes
      ) {
        throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
      }

      verifySqliteSnapshot(
        destinationFilePath,
        this.dependencies.migrationsDirectory,
      );
      await syncFile(destinationFilePath);
      const sha256 = await calculateSha256(destinationFilePath);
      await fileSystem.chmod(destinationFilePath, 0o400);

      if (
        !Number.isSafeInteger(backupMetadata.totalPages) ||
        backupMetadata.totalPages < 1
      ) {
        throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
      }

      return {
        databaseByteSize: snapshotFile.size,
        logicalPath: sqliteSnapshotLogicalPath,
        sha256,
        totalPages: backupMetadata.totalPages,
      };
    } catch {
      if (operationRootCreated) {
        await fileSystem.rm(operationRoot, {
          force: true,
          recursive: true,
        }).catch(() => undefined);
      }
      throw new Error('PROFILE_SNAPSHOT_DATABASE_FAILED');
    }
  }
}

export function createSqliteProfileSnapshotService(input: {
  database: DatabaseConnection;
  maintenanceState: ProfileMaintenanceState;
  migrationsDirectory: string;
  stagingRoot: string;
}): SqliteProfileSnapshotService {
  return new SqliteProfileSnapshotService({
    backupDatabase: (destinationFilePath, options) =>
      input.database.backup(destinationFilePath, options),
    maintenanceState: input.maintenanceState,
    migrationsDirectory: input.migrationsDirectory,
    stagingRoot: input.stagingRoot,
  });
}

function verifySqliteSnapshot(
  databaseFilePath: string,
  migrationsDirectory: string,
): void {
  const snapshot = new Database(databaseFilePath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    const integrityResult: unknown = snapshot.pragma('integrity_check', {
      simple: true,
    });
    const foreignKeyRows = snapshot.pragma('foreign_key_check') as unknown[];

    if (integrityResult !== 'ok' || foreignKeyRows.length !== 0) {
      throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
    }

    const expectedMigrations = readExpectedMigrationNames(
      migrationsDirectory,
    );
    const appliedMigrations = snapshot
      .prepare<[], { name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name',
      )
      .all()
      .map(({ name }) => name);

    if (
      appliedMigrations.length !== expectedMigrations.length ||
      appliedMigrations.some(
        (migration, index) => migration !== expectedMigrations[index],
      )
    ) {
      throw new Error('PROFILE_SNAPSHOT_MIGRATIONS_INVALID');
    }
  } finally {
    snapshot.close();
  }
}

function readExpectedMigrationNames(migrationsDirectory: string): string[] {
  if (!isAbsolute(migrationsDirectory)) {
    throw new Error('PROFILE_SNAPSHOT_MIGRATIONS_INVALID');
  }

  return readdirSync(migrationsDirectory)
    .filter((fileName: string) => fileName.endsWith('.sql'))
    .sort()
    .map((fileName: string) => {
      if (!migrationFileNamePattern.test(fileName)) {
        throw new Error('PROFILE_SNAPSHOT_MIGRATIONS_INVALID');
      }
      return fileName;
    });
}

async function assertPrivateStagingRoot(stagingRoot: string): Promise<void> {
  const root = await fileSystem.lstat(stagingRoot);

  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error('PROFILE_SNAPSHOT_STAGING_INVALID');
  }
  if (process.platform !== 'win32' && (root.mode & 0o077) !== 0) {
    throw new Error('PROFILE_SNAPSHOT_STAGING_INVALID');
  }

  const realRoot = await fileSystem.realpath(stagingRoot);

  if (!pathsAreEqual(resolve(realRoot), stagingRoot)) {
    throw new Error('PROFILE_SNAPSHOT_STAGING_INVALID');
  }
}

async function assertPrivateOperationRoot(
  operationRoot: string,
): Promise<void> {
  const root = await fileSystem.lstat(operationRoot);

  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    (process.platform !== 'win32' && (root.mode & 0o077) !== 0)
  ) {
    throw new Error('PROFILE_SNAPSHOT_STAGING_INVALID');
  }

  const realRoot = await fileSystem.realpath(operationRoot);

  if (!pathsAreEqual(resolve(realRoot), resolve(operationRoot))) {
    throw new Error('PROFILE_SNAPSHOT_STAGING_INVALID');
  }
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await fileSystem.lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  throw new Error('PROFILE_SNAPSHOT_DESTINATION_EXISTS');
}

function assertContainedPath(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);

  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('PROFILE_SNAPSHOT_PATH_INVALID');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

async function calculateSha256(path: string): Promise<string> {
  const hash = createHash('sha256');

  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }

  return hash.digest('hex');
}

async function syncFile(path: string): Promise<void> {
  const file = await fileSystem.open(path, 'r+');

  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('PROFILE_SNAPSHOT_CANCELLED');
  }
}
